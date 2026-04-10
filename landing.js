import { firebaseConfig } from './src/config.js';

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();

function setFeedback(message, type = 'info') {
  const feedback = document.getElementById('contact-form-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.remove('ok', 'error');
  if (type === 'ok') feedback.classList.add('ok');
  if (type === 'error') feedback.classList.add('error');
}

function sanitize(value) {
  return String(value || '').trim();
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contact-form');
  const submitBtn = document.getElementById('contact-submit-btn');
  if (!form || !submitBtn) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = sanitize(document.getElementById('contact-name')?.value);
    const email = sanitize(document.getElementById('contact-email')?.value).toLowerCase();
    const message = sanitize(document.getElementById('contact-message')?.value);

    if (!name || !email || !message) {
      setFeedback('Completá nombre, email y mensaje.', 'error');
      return;
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando...';
      setFeedback('');

      await db.collection('contactLeads').add({
        name,
        email,
        message,
        status: 'pending',
        source: 'landing',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      form.reset();
      setFeedback('Gracias. Recibimos tu consulta y te vamos a contactar pronto.', 'ok');
    } catch (error) {
      console.error('No se pudo enviar el contacto', error);
      setFeedback('No se pudo enviar ahora. Intentá nuevamente en unos minutos.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar consulta';
    }
  });
});
