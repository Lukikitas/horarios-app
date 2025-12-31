import { store } from '../store/Store.js';
import { initFirebase, getAuth, getDb } from './firebase.js';
import { userDocRef } from './firestoreRefs.js';
import { showToast } from '../utils/feedback.js';

const STORAGE_KEY = 'activeStoreId';

function createSelectionUI(stores, onSelect, onLogout) {
  let overlay = document.getElementById('store-selector');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'store-selector';
    overlay.className = 'store-selector-overlay';
    overlay.innerHTML = `
      <div class="card" style="max-width:480px; width:100%;">
        <div class="card-h"><strong>Elegí tu local</strong></div>
        <div class="card-c stack" id="store-selector-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  const body = overlay.querySelector('#store-selector-body');
  body.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'stack';
  stores.forEach((storeId) => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = storeId;
    btn.addEventListener('click', () => onSelect(storeId));
    list.appendChild(btn);
  });
  body.appendChild(list);
  const cancelRow = document.createElement('div');
  cancelRow.className = 'row';
  cancelRow.style.justifyContent = 'space-between';
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'btn secondary';
  logoutBtn.textContent = 'Cerrar sesión';
  logoutBtn.addEventListener('click', onLogout);
  cancelRow.appendChild(logoutBtn);
  body.appendChild(cancelRow);
  overlay.style.display = 'flex';
}

function hideSelectionUI() {
  const overlay = document.getElementById('store-selector');
  if (overlay) overlay.style.display = 'none';
}

function showSessionBanner(onChangeStore, onLogout) {
  let banner = document.getElementById('session-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'session-banner';
    banner.className = 'session-banner';
    banner.innerHTML = `
      <div class="row" style="gap:8px; align-items:center;">
        <span class="pill" id="session-user-label"></span>
        <span class="pill pill-neutral" id="session-store-label"></span>
        <button id="change-store-btn" class="btn secondary">Cambiar local</button>
        <button id="logout-btn" class="btn secondary">Salir</button>
      </div>
    `;
    const bar = document.querySelector('.bar-inner');
    if (bar) bar.appendChild(banner); else document.body.prepend(banner);
  }
  const changeBtn = banner.querySelector('#change-store-btn');
  changeBtn.onclick = onChangeStore;
  const logoutBtn = banner.querySelector('#logout-btn');
  logoutBtn.onclick = onLogout;
  banner.style.display = 'block';

  // Inline buttons in Acciones dropdown
  const changeInline = document.getElementById('change-store-inline');
  const logoutInline = document.getElementById('logout-inline');
  if (changeInline) changeInline.onclick = onChangeStore;
  if (logoutInline) logoutInline.onclick = onLogout;
}

function updateBannerLabels() {
  const state = store.getState();
  const userLbl = document.getElementById('session-user-label');
  const storeLbl = document.getElementById('session-store-label');
  if (userLbl) userLbl.textContent = state.currentUser?.displayName || state.currentUser?.email || 'Sin usuario';
  if (storeLbl) storeLbl.textContent = state.activeStoreId ? `Local activo: ${state.activeStoreId}` : 'Sin local activo';
}

export const SessionService = {
  async requireSession() {
    initFirebase();
    const auth = getAuth();
    return new Promise((resolve, reject) => {
      auth.onAuthStateChanged(async (user) => {
        try {
          if (!user) {
            window.location.href = 'index.html';
            return;
          }
          const profileSnap = await userDocRef(user.uid).get();
          if (!profileSnap.exists) {
            console.error('Usuario sin permisos');
            showToast('Usuario sin permisos.', 'error');
            await auth.signOut();
            window.location.href = 'index.html';
            return;
          }
          const profile = profileSnap.data();
          const allowedStores = Array.isArray(profile.allowedStores) ? profile.allowedStores : [];
          const defaultStore = profile.defaultStore || null;
          const persisted = localStorage.getItem(STORAGE_KEY);
          let activeStoreId = null;
          if (persisted && allowedStores.includes(persisted)) {
            activeStoreId = persisted;
          } else if (allowedStores.length === 1) {
            activeStoreId = allowedStores[0];
          } else if (defaultStore && allowedStores.includes(defaultStore)) {
            activeStoreId = defaultStore;
          }

          store.setState({
            currentUser: {
              uid: user.uid,
              email: user.email,
              displayName: profile.displayName || user.displayName || user.email,
              role: profile.role || 'manager',
              allowedStores,
              defaultStore,
            },
            activeStoreId,
          });
          updateBannerLabels();

          const logout = async () => {
            await auth.signOut();
            localStorage.removeItem(STORAGE_KEY);
            window.location.href = 'index.html';
          };
          const handleSelect = (storeId) => {
            localStorage.setItem(STORAGE_KEY, storeId);
            store.setState({ activeStoreId: storeId, schedules: {}, employees: [] });
            hideSelectionUI();
            updateBannerLabels();
            document.dispatchEvent(new CustomEvent('store-changed', { detail: { storeId } }));
            resolve(storeId);
          };

          showSessionBanner(() => {
            createSelectionUI(allowedStores, handleSelect, logout);
          }, logout);

          if (activeStoreId) {
            resolve(activeStoreId);
          } else if (allowedStores.length > 1) {
            createSelectionUI(allowedStores, handleSelect, logout);
          } else {
            showToast('No hay locales habilitados para este usuario.', 'error');
            reject(new Error('Sin locales')); // will show overlay still
          }
        } catch (err) {
          console.error('Error cargando sesión', err);
          reject(err);
        }
      });
    });
  }
};

store.subscribe(updateBannerLabels);
