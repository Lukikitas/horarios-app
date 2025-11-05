import { firebaseConfig } from './src/config.js';

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

document.addEventListener('DOMContentLoaded', () => {
  const loginView = document.getElementById('login-view');
  const dniLoginView = document.getElementById('dni-login-view');
  const showDniLogin = document.getElementById('show-dni-login');
  const showManagerLogin = document.getElementById('show-manager-login');

  showDniLogin.addEventListener('click', () => {
    loginView.style.display = 'none';
    dniLoginView.style.display = 'block';
  });

  showManagerLogin.addEventListener('click', () => {
    dniLoginView.style.display = 'none';
    loginView.style.display = 'block';
  });

  // Redirect based on role as soon as auth state is known
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      try {
        const idTokenResult = await user.getIdTokenResult();
        const role = idTokenResult.claims.role;

        if (role === 'manager') {
          window.location.href = 'manager.html';
        } else if (role === 'employee') {
          window.location.href = 'portal/index.html';
        } else {
          // If no role, sign out and show an error
          console.error("User has no role claim.");
          auth.signOut();
        }
      } catch (error) {
        console.error("Error getting user token:", error);
        auth.signOut();
      }
    }
  });

  const loginButton = document.getElementById('login');
  loginButton.addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) {
      alert('Por favor, ingresa el email y la contraseña.');
      return;
    }

    try {
      await auth.signInWithEmailAndPassword(email, password);
      // The onAuthStateChanged listener will handle the redirect
    } catch (error) {
      console.error("Login failed:", error);
      alert(`Error al iniciar sesión: ${error.message}`);
    }
  });

  const sendLinkButton = document.getElementById('send-link');
  sendLinkButton.addEventListener('click', async () => {
    const dni = document.getElementById('dni').value.trim();
    if (!dni) {
      alert('Por favor, ingresa tu DNI.');
      return;
    }

    try {
      const doc = await db.collection("schedules").doc("main").get();
      if (!doc.exists) {
          alert("Error: No se encontró la configuración principal.");
          return;
      }
      const allEmployees = doc.data().employees || [];
      const employee = allEmployees.find(emp => emp.dni === dni);

      if (!employee) {
        alert("No se encontró ningún empleado con ese DNI.");
        return;
      }
      if (!employee.mail) {
        alert("Este empleado no tiene un email registrado. Contacta al administrador.");
        return;
      }

      const actionCodeSettings = {
        url: 'https://horarios-data.web.app/portal/index.html', // URL to redirect to after login
        handleCodeInApp: true,
      };

      await auth.sendSignInLinkToEmail(employee.mail, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', employee.mail);
      alert('Se ha enviado un enlace a tu correo electrónico para que inicies sesión.');

    } catch (error) {
      console.error("Error sending sign in email:", error);
      alert(`Error: ${error.message}`);
    }
  });
});