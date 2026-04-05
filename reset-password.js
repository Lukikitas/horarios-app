import { firebaseConfig } from './src/config.js';

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

function showPopup(message, type = 'info') {
  const existing = document.getElementById('reset-popup');
  if (existing) existing.remove();

  const colorByType = {
    success: '#166534',
    error: '#991b1b',
    warning: '#92400e',
    info: '#1d4ed8',
  };

  const popup = document.createElement('div');
  popup.id = 'reset-popup';
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
  setTimeout(() => popup.remove(), 4000);
}

document.addEventListener('DOMContentLoaded', async () => {
  const resetBtn = document.getElementById('reset-password-btn');
  const newPasswordInput = document.getElementById('new-password');
  const confirmPasswordInput = document.getElementById('confirm-password');
  const emailLabel = document.getElementById('reset-email-label');

  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');

  if (mode !== 'resetPassword' || !oobCode) {
    emailLabel.textContent = 'Este enlace no es válido para cambiar contraseña.';
    showPopup('Enlace inválido. Solicitá uno nuevo desde el login.', 'error');
    return;
  }

  let accountEmail = '';
  try {
    accountEmail = await auth.verifyPasswordResetCode(oobCode);
    emailLabel.textContent = `Vas a actualizar la contraseña de: ${accountEmail}`;
    newPasswordInput.disabled = false;
    confirmPasswordInput.disabled = false;
    resetBtn.disabled = false;
  } catch (error) {
    console.error('Código inválido o vencido:', error);
    emailLabel.textContent = 'El enlace venció o no es válido.';
    showPopup('El enlace venció o ya fue usado. Solicitá uno nuevo.', 'error');
    return;
  }

  resetBtn.addEventListener('click', async () => {
    const newPassword = newPasswordInput.value || '';
    const confirmPassword = confirmPasswordInput.value || '';

    if (newPassword.length < 6) {
      showPopup('La nueva contraseña debe tener al menos 6 caracteres.', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      showPopup('Las contraseñas no coinciden.', 'warning');
      return;
    }

    try {
      await auth.confirmPasswordReset(oobCode, newPassword);
      showPopup('Contraseña actualizada correctamente. Ya podés iniciar sesión.', 'success');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1200);
    } catch (error) {
      console.error('Error confirmando reset:', error);
      const errMap = {
        'auth/expired-action-code': 'El enlace venció. Solicitá uno nuevo.',
        'auth/invalid-action-code': 'El enlace no es válido o ya fue utilizado.',
        'auth/weak-password': 'La contraseña es demasiado débil.',
      };
      showPopup(errMap[error.code] || 'No se pudo cambiar la contraseña.', 'error');
    }
  });
});
