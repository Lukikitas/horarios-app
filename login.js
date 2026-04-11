import { firebaseConfig } from './src/config.js';

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const TOAST_MS = { error: 8000, warning: 5500, success: 4200, info: 4000 };

function clearLoginAlert(alertEl) {
  if (!alertEl) return;
  alertEl.textContent = '';
  alertEl.className = 'login-alert login-alert--hidden';
  alertEl.hidden = true;
}

function setLoginAlert(alertEl, message, type) {
  if (!alertEl) return;
  alertEl.hidden = false;
  alertEl.className = `login-alert login-alert--${type}`;
  alertEl.textContent = message;
}

function pulseLoginCard(loginCard) {
  if (!loginCard) return;
  loginCard.classList.add('login-card--pulse');
  window.setTimeout(() => loginCard.classList.remove('login-card--pulse'), 450);
}

function showPopup(message, type = 'info') {
  const existing = document.getElementById('login-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'login-popup';
  popup.className = `login-toast login-toast--${type}`;
  popup.setAttribute('role', 'status');
  popup.textContent = message;
  document.body.appendChild(popup);
  const ms = TOAST_MS[type] ?? TOAST_MS.info;
  setTimeout(() => popup.remove(), ms);
}

function getLoginErrorMessage(errorCode) {
  const map = {
    'auth/invalid-email': 'El email no tiene un formato válido.',
    'auth/user-disabled': 'Tu cuenta está deshabilitada. Contactá al administrador.',
    'auth/user-not-found': 'Email o contraseña incorrectos. Revisá los datos e intentá de nuevo.',
    'auth/wrong-password': 'Email o contraseña incorrectos. Revisá los datos e intentá de nuevo.',
    'auth/invalid-credential': 'Email o contraseña incorrectos. Revisá los datos e intentá de nuevo.',
    'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos e intentá nuevamente.',
  };
  return map[errorCode] || 'No se pudo iniciar sesión. Verificá email y contraseña e intentá de nuevo.';
}

document.addEventListener('DOMContentLoaded', () => {
  const loginButton = document.getElementById('login');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const loginAlert = document.getElementById('login-alert');
  const loginCard = document.querySelector('.login-card');
  const loginLogo = document.getElementById('login-logo');

  const forgotModal = document.getElementById('forgot-password-modal');
  const forgotBtn = document.getElementById('btn-forgot-password');
  const forgotClose = document.getElementById('forgot-password-close');
  const forgotSend = document.getElementById('forgot-password-send');
  const forgotEmail = document.getElementById('forgot-password-email');

  auth.onAuthStateChanged(async (user) => {
    if (!user) return;
    try {
      const userDoc = await db.collection('users').doc(user.uid).get();
      if (!userDoc.exists) {
        setLoginAlert(loginAlert, 'No tenés permisos para acceder al sistema.', 'error');
        showPopup('Usuario sin permisos para acceder al sistema.', 'error');
        pulseLoginCard(loginCard);
        await auth.signOut();
        return;
      }

      const profile = userDoc.data() || {};
      const role = profile.role || (await user.getIdTokenResult())?.claims?.role;
      if (role === 'manager' || role === 'admin') {
        window.location.href = 'manager.html';
        return;
      }

      setLoginAlert(loginAlert, 'Esta aplicación es solo para cuentas de manager.', 'warning');
      showPopup('Esta aplicación está habilitada únicamente para managers.', 'warning');
      pulseLoginCard(loginCard);
      await auth.signOut();
    } catch (error) {
      console.error('Error al validar sesión:', error);
      setLoginAlert(loginAlert, 'No pudimos validar tu sesión. Intentá de nuevo.', 'error');
      showPopup('Error al validar tu sesión. Intentá nuevamente.', 'error');
      pulseLoginCard(loginCard);
      await auth.signOut();
    }
  });

  const clearAlertOnEdit = () => clearLoginAlert(loginAlert);
  emailInput?.addEventListener('input', clearAlertOnEdit);
  passwordInput?.addEventListener('input', clearAlertOnEdit);

  loginButton?.addEventListener('click', async () => {
    const email = emailInput?.value.trim() || '';
    const password = passwordInput?.value || '';

    if (!email || !password) {
      setLoginAlert(loginAlert, 'Completá el email y la contraseña para continuar.', 'warning');
      showPopup('Por favor ingresá email y contraseña.', 'warning');
      pulseLoginCard(loginCard);
      return;
    }

    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
      console.error('Login failed:', error);
      const msg = getLoginErrorMessage(error.code);
      setLoginAlert(loginAlert, msg, 'error');
      showPopup(msg, 'error');
      pulseLoginCard(loginCard);
    }
  });

  const onEnterLogin = (event) => {
    if (event.key === 'Enter') loginButton?.click();
  };
  emailInput?.addEventListener('keydown', onEnterLogin);
  passwordInput?.addEventListener('keydown', onEnterLogin);

  forgotBtn?.addEventListener('click', () => {
    if (forgotEmail && emailInput?.value) forgotEmail.value = emailInput.value.trim();
    if (forgotModal) forgotModal.style.display = 'flex';
  });

  forgotClose?.addEventListener('click', () => {
    if (forgotModal) forgotModal.style.display = 'none';
  });

  forgotModal?.addEventListener('click', (event) => {
    if (event.target === forgotModal) forgotModal.style.display = 'none';
  });

  forgotSend?.addEventListener('click', async () => {
    const email = forgotEmail?.value.trim() || '';
    if (!email) {
      showPopup('Ingresá un email para recuperar tu contraseña.', 'warning');
      return;
    }

    try {
      try {
        await auth.sendPasswordResetEmail(email, {
          url: `${window.location.origin}/reset-password.html`,
          handleCodeInApp: false,
        });
      } catch (error) {
        if (error?.code === 'auth/unauthorized-continue-uri') {
          // Fallback: send reset email without custom continue URL (Firebase hosted reset page).
          await auth.sendPasswordResetEmail(email);
          showPopup('Tu dominio no está habilitado en Firebase. Se enviará el enlace estándar de recuperación.', 'warning');
        } else {
          throw error;
        }
      }
      showPopup('Si el email está registrado, enviamos un enlace de recuperación.', 'success');
      if (forgotModal) forgotModal.style.display = 'none';
    } catch (error) {
      console.error('Error al enviar reset password:', error);
      const resetErrors = {
        'auth/invalid-email': 'El email ingresado no es válido.',
        'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos e intentá nuevamente.',
      };
      showPopup(resetErrors[error.code] || 'No se pudo enviar el email de recuperación.', 'error');
    }
  });

  loginLogo?.addEventListener('error', () => {
    const src = loginLogo.getAttribute('src') || '';
    if (src.toLowerCase().endsWith('.png') && src !== 'assets/logo.png') {
      loginLogo.src = 'assets/logo.png';
    }
  });
});
