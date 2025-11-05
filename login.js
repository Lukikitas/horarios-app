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
      const employeesRef = db.collection("employees");
      const querySnapshot = await employeesRef.where("dni", "==", dni).limit(1).get();

      if (querySnapshot.empty) {
        alert("No se encontró ningún empleado con ese DNI.");
        return;
      }

      const employeeDoc = querySnapshot.docs[0];
      const employee = employeeDoc.data();

      if (!employee.email) {
        alert("Este empleado no tiene un email registrado. Contacta al administrador.");
        return;
      }

      const actionCodeSettings = {
        url: window.location.href, // URL to redirect to after password reset
        handleCodeInApp: true,
      };

      await auth.sendPasswordResetEmail(employee.email, actionCodeSettings);
      alert('Se ha enviado un enlace a tu correo electrónico para que crees tu contraseña.');

    } catch (error) {
      console.error("Error sending password reset email:", error);
      alert(`Error: ${error.message}`);
    }
  });
});