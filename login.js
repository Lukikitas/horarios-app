import { firebaseConfig } from './src/config.js';

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

function showPopup(message, type = 'info') {
  const existing = document.getElementById('login-popup');
  if (existing) existing.remove();

  const colorByType = {
    success: '#166534',
    error: '#991b1b',
    warning: '#92400e',
    info: '#1d4ed8',
  };

  const popup = document.createElement('div');
  popup.id = 'login-popup';
  popup.style.position = 'fixed';
  popup.style.top = '16px';
  popup.style.left = '50%';
  popup.style.transform = 'translateX(-50%)';
  popup.style.zIndex = '4000';
  popup.style.maxWidth = '92vw';
  popup.style.padding = '12px 16px';
  popup.style.borderRadius = '10px';
  popup.style.background = '#fff';
  popup.style.color = colorByType[type] || colorByType.info;
  popup.style.border = `1px solid ${colorByType[type] || colorByType.info}`;
  popup.style.boxShadow = '0 10px 30px rgba(0,0,0,.15)';
  popup.style.fontWeight = '600';
  popup.textContent = message;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 3800);
}

function getLoginErrorMessage(errorCode) {
  const map = {
    'auth/invalid-email': 'El email ingresado no es válido.',
    'auth/user-disabled': 'Tu cuenta está deshabilitada. Contactá al administrador.',
    'auth/user-not-found': 'Email o contraseña incorrectos.',
    'auth/wrong-password': 'Email o contraseña incorrectos.',
    'auth/invalid-credential': 'Email o contraseña incorrectos.',
    'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos e intentá nuevamente.',
  };
  return map[errorCode] || 'No se pudo iniciar sesión. Verificá tus datos.';
}

document.addEventListener('DOMContentLoaded', () => {
  const loginButton = document.getElementById('login');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');

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
        showPopup('Usuario sin permisos para acceder al sistema.', 'error');
        await auth.signOut();
        return;
      }

      const profile = userDoc.data() || {};
      const role = profile.role || (await user.getIdTokenResult())?.claims?.role;
      if (role === 'manager' || role === 'admin') {
        window.location.href = 'manager.html';
        return;
      }

      showPopup('Esta aplicación está habilitada únicamente para managers.', 'warning');
      await auth.signOut();
    } catch (error) {
      console.error('Error al validar sesión:', error);
      showPopup('Error al validar tu sesión. Intentá nuevamente.', 'error');
      await auth.signOut();
    }
  });

  loginButton?.addEventListener('click', async () => {
    const email = emailInput?.value.trim() || '';
    const password = passwordInput?.value || '';

    if (!email || !password) {
      showPopup('Por favor ingresá email y contraseña.', 'warning');
      return;
    }

    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
      console.error('Login failed:', error);
      showPopup(getLoginErrorMessage(error.code), 'error');
    }
  });

  passwordInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loginButton?.click();
  });

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
});
