import { store } from '../store/Store.js';
import { initFirebase, getAuth, getDb } from './firebase.js';
import { userDocRef, storePresenceRef } from './firestoreRefs.js';
import { showToast } from '../utils/feedback.js';

const STORAGE_KEY = 'activeStoreId';
const PRESENCE_HEARTBEAT_MS = 30000;
const PRESENCE_ACTIVE_WINDOW_MS = 70000;

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
        <span class="pill" id="session-user-label"></span>
        <span class="pill pill-neutral" id="session-store-label"></span>
        <span class="pill pill-neutral" id="session-collab-indicator" style="display:none;"></span>
    `;
    const container = document.querySelector('.main-bar-right') || document.querySelector('.bar-inner') || document.body;
    container.prepend(banner);
  }
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
  if (storeLbl) {
    const activeLabel = state.storeName || state.activeStoreId;
    storeLbl.textContent = activeLabel ? `Local activo: ${activeLabel}` : 'Sin local activo';
  }
  const collabLbl = document.getElementById('session-collab-indicator');
  if (collabLbl) {
    const others = Number(state.concurrentSessions || 0);
    if (others > 0) {
      collabLbl.style.display = 'inline-flex';
      collabLbl.textContent = `En línea: +${others}`;
    } else {
      collabLbl.style.display = 'none';
      collabLbl.textContent = '';
    }
  }
}

export const SessionService = {
  _presenceSessionId: null,
  _presenceStoreId: null,
  _presenceUnsubscribe: null,
  _presenceHeartbeatTimer: null,
  _presenceStoreWatcherUnsubscribe: null,

  _createPresenceSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  },

  _stopPresence() {
    if (this._presenceHeartbeatTimer) {
      clearInterval(this._presenceHeartbeatTimer);
      this._presenceHeartbeatTimer = null;
    }
    if (this._presenceUnsubscribe) {
      try { this._presenceUnsubscribe(); } catch (_) {}
      this._presenceUnsubscribe = null;
    }
    const storeId = this._presenceStoreId;
    const sessionId = this._presenceSessionId;
    this._presenceStoreId = null;
    store.setState({ concurrentSessions: 0 });
    if (storeId && sessionId) {
      storePresenceRef(storeId).doc(sessionId).delete().catch(() => {});
    }
  },

  _startPresenceForStore(storeId) {
    const auth = getAuth();
    const currentUser = auth?.currentUser;
    if (!storeId || !currentUser) return;
    if (!this._presenceSessionId) this._presenceSessionId = this._createPresenceSessionId();
    if (this._presenceStoreId === storeId && this._presenceUnsubscribe) return;

    this._stopPresence();
    this._presenceStoreId = storeId;
    const sessionId = this._presenceSessionId;
    const presenceDoc = storePresenceRef(storeId).doc(sessionId);

    const writePresence = () => presenceDoc.set({
      uid: currentUser.uid,
      email: currentUser.email || null,
      displayName: store.getState().currentUser?.displayName || currentUser.email || 'manager',
      storeId,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});

    writePresence();
    this._presenceHeartbeatTimer = setInterval(writePresence, PRESENCE_HEARTBEAT_MS);

    this._presenceUnsubscribe = storePresenceRef(storeId).onSnapshot((snapshot) => {
      const now = Date.now();
      let activeCount = 0;
      snapshot.docs.forEach((doc) => {
        const data = doc.data() || {};
        const lastSeenMs = typeof data.lastSeen?.toDate === 'function'
          ? data.lastSeen.toDate().getTime()
          : 0;
        if (lastSeenMs && now - lastSeenMs <= PRESENCE_ACTIVE_WINDOW_MS) activeCount += 1;
      });
      const others = Math.max(0, activeCount - 1);
      if ((store.getState().concurrentSessions || 0) !== others) {
        store.setState({ concurrentSessions: others });
      }
    });
  },

  async requireSession() {
    initFirebase();
    const auth = getAuth();
    return new Promise((resolve, reject) => {
      auth.onAuthStateChanged(async (user) => {
        try {
          if (!user) {
            window.location.href = 'login.html';
            return;
          }
          const profileSnap = await userDocRef(user.uid).get();
          if (!profileSnap.exists) {
            console.error('Usuario sin permisos');
            showToast('Usuario sin permisos.', 'error');
            await auth.signOut();
            window.location.href = 'login.html';
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
            this._stopPresence();
            await auth.signOut();
            localStorage.removeItem(STORAGE_KEY);
            window.location.href = 'login.html';
          };
          const handleSelect = (storeId) => {
            localStorage.setItem(STORAGE_KEY, storeId);
            store.setState({ activeStoreId: storeId, schedules: {}, employees: [], storeName: '', schedulingRules: null, concurrentSessions: 0 });
            this._startPresenceForStore(storeId);
            hideSelectionUI();
            updateBannerLabels();
            document.dispatchEvent(new CustomEvent('store-changed', { detail: { storeId } }));
            resolve(storeId);
          };

          showSessionBanner(() => {
            createSelectionUI(allowedStores, handleSelect, logout);
          }, logout);

          if (activeStoreId) {
            this._startPresenceForStore(activeStoreId);
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

window.addEventListener('beforeunload', () => {
  SessionService._stopPresence?.();
});
