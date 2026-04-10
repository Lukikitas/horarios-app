import { firebaseConfig, ROLES } from '../config.js';
import { store } from '../store/Store.js';
import { getDb } from './firebase.js';
import { storeDoc, storeSchedulesRef, userDocRef } from './firestoreRefs.js';

const SECONDARY_APP_NAME = 'admin-user-provisioning';

function ensureAdmin() {
  const currentUser = store.getState().currentUser;
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Solo un administrador puede crear usuarios o locales.');
  }
  return currentUser;
}

function getSecondaryApp() {
  const existing = firebase.apps.find(app => app.name === SECONDARY_APP_NAME);
  return existing || firebase.initializeApp(firebaseConfig, SECONDARY_APP_NAME);
}

function cleanupStoreIds(storeIds = []) {
  return [...new Set(
    storeIds
      .map(value => String(value || '').trim())
      .filter(Boolean)
  )];
}

async function rollbackCreatedUser(authInstance) {
  try {
    if (authInstance?.currentUser) {
      await authInstance.currentUser.delete();
    }
  } catch (error) {
    console.error('No se pudo revertir el usuario creado en Auth.', error);
  } finally {
    try {
      await authInstance?.signOut();
    } catch (error) {
      console.error('No se pudo cerrar la sesión secundaria.', error);
    }
  }
}

export const AdminService = {
  async listStores() {
    ensureAdmin();
    const snapshot = await getDb().collection('stores').get();
    return snapshot.docs
      .map((doc) => ({
        id: doc.id,
        displayName: doc.data()?.displayName || doc.id,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
  },

  async createUserWithStore({
    displayName,
    email,
    password,
    role,
    storeId,
    createNewStore = false,
    storeName = '',
  }) {
    const currentUser = ensureAdmin();
    const cleanDisplayName = String(displayName || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');
    const cleanRole = role === 'admin' ? 'admin' : 'manager';
    const cleanStoreId = String(storeId || '').trim();
    const cleanStoreName = String(storeName || '').trim();

    if (!cleanDisplayName) throw new Error('Ingresá el nombre visible del usuario.');
    if (!cleanEmail) throw new Error('Ingresá un email válido.');
    if (cleanPassword.length < 6) throw new Error('La contraseña temporal debe tener al menos 6 caracteres.');
    if (!cleanStoreId) throw new Error('Seleccioná o ingresá un local.');

    const db = getDb();
    const finalAllowedStores = cleanupStoreIds([cleanStoreId]);

    if (createNewStore) {
      const existingStore = await storeDoc(cleanStoreId).get();
      if (existingStore.exists) {
        throw new Error('Ya existe un local con ese ID.');
      }
    } else {
      const existingStore = await storeDoc(cleanStoreId).get();
      if (!existingStore.exists) {
        throw new Error('El local seleccionado no existe.');
      }
    }

    const secondaryApp = getSecondaryApp();
    const secondaryAuth = secondaryApp.auth();
    let createdCredential = null;

    try {
      createdCredential = await secondaryAuth.createUserWithEmailAndPassword(cleanEmail, cleanPassword);
      const newUser = createdCredential.user;
      if (!newUser) throw new Error('No se pudo crear la cuenta en Authentication.');

      const batch = db.batch();
      const userPayload = {
        displayName: cleanDisplayName,
        allowedStores: finalAllowedStores,
        defaultStore: cleanStoreId,
        role: cleanRole,
        email: cleanEmail,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUser.uid,
      };

      batch.set(userDocRef(newUser.uid), userPayload, { merge: true });

      if (createNewStore) {
        batch.set(storeDoc(cleanStoreId), {
          displayName: cleanStoreName || cleanStoreId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: currentUser.uid,
        }, { merge: true });

        batch.set(storeSchedulesRef(cleanStoreId).doc('main'), {
          templates: {},
          projectedTickets: {},
          breaks: {},
          roles: store.getState().roles?.length ? store.getState().roles : ROLES,
          rappiCode: '',
          initializedAt: firebase.firestore.FieldValue.serverTimestamp(),
          initializedBy: currentUser.uid,
        }, { merge: true });

        const currentAllowedStores = cleanupStoreIds([
          ...(store.getState().currentUser?.allowedStores || []),
          cleanStoreId,
        ]);

        batch.set(userDocRef(currentUser.uid), {
          allowedStores: currentAllowedStores,
        }, { merge: true });
      }

      await batch.commit();

      if (createNewStore) {
        const currentProfile = store.getState().currentUser || {};
        store.setState({
          currentUser: {
            ...currentProfile,
            allowedStores: cleanupStoreIds([...(currentProfile.allowedStores || []), cleanStoreId]),
          },
        });
      }

      await secondaryAuth.signOut();

      return {
        uid: newUser.uid,
        email: cleanEmail,
        storeId: cleanStoreId,
        createdStore: createNewStore,
      };
    } catch (error) {
      if (createdCredential?.user) {
        await rollbackCreatedUser(secondaryAuth);
      }
      throw error;
    }
  },
};
