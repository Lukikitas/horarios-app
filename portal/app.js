import { firebaseConfig, SLOTS } from '../src/config.js';

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

document.addEventListener('DOMContentLoaded', () => {
  if (auth.isSignInWithEmailLink(window.location.href)) {
    let email = window.localStorage.getItem('emailForSignIn');
    if (!email) {
      email = window.prompt('Please provide your email for confirmation');
    }
    auth.signInWithEmailLink(email, window.location.href)
      .then(async (result) => {
        window.localStorage.removeItem('emailForSignIn');
        const user = result.user;
        const idTokenResult = await user.getIdTokenResult();
        if (idTokenResult.claims.role !== 'employee') {
          window.location.href = '../index.html';
        } else {
          renderPortal(user, idTokenResult.claims.employeeId);
        }
      })
      .catch((error) => {
        console.error("Sign in with email link error:", error);
        alert(`Error al iniciar sesión: ${error.message}`);
        window.location.href = '../index.html';
      });
  } else {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        const idTokenResult = await user.getIdTokenResult();
        if (idTokenResult.claims.role !== 'employee') {
          window.location.href = '../index.html';
        } else {
          renderPortal(user, idTokenResult.claims.employeeId);
        }
      } else {
        window.location.href = '../index.html';
      }
    });
  }
});

function renderPortal(user, employeeId) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card" style="width: 800px;">
      <div class="card-h">
        <strong>Portal de Empleado</strong>
        <button id="logout" class="btn secondary">Cerrar Sesión</button>
      </div>
      <div class="card-c">
        <div id="portal-nav" class="row" style="margin-bottom: 16px;">
          <button id="nav-schedule" class="btn main-menu-btn">Mis Horarios</button>
          <button id="nav-requests" class="btn secondary main-menu-btn">Mis Solicitudes</button>
          <button id="nav-new-request" class="btn secondary main-menu-btn">Solicitar Día Libre</button>
        </div>
        <div id="portal-content"></div>
      </div>
    </div>
  `;

  const navSchedule = document.getElementById('nav-schedule');
  const navRequests = document.getElementById('nav-requests');
  const navNewRequest = document.getElementById('nav-new-request');
  const portalContent = document.getElementById('portal-content');

  navSchedule.addEventListener('click', () => {
    setActiveNav(navSchedule);
    renderMySchedule(employeeId);
  });
  navRequests.addEventListener('click', () => {
    setActiveNav(navRequests);
    renderMyRequests(employeeId);
  });
  navNewRequest.addEventListener('click', () => {
    setActiveNav(navNewRequest);
    renderNewRequestForm(employeeId);
  });

  document.getElementById('logout').addEventListener('click', () => {
    auth.signOut();
  });

  // Initial render
  renderMySchedule(employeeId);
}

function setActiveNav(activeButton) {
  const buttons = document.querySelectorAll('#portal-nav .btn');
  buttons.forEach(button => {
    button.classList.remove('main-menu-btn');
    button.classList.add('secondary');
  });
  activeButton.classList.remove('secondary');
  activeButton.classList.add('main-menu-btn');
}

async function renderMySchedule(employeeId) {
  const portalContent = document.getElementById('portal-content');
  portalContent.innerHTML = '<h3>Mis Horarios</h3><p>Cargando...</p>';

  try {
    const shiftsRef = db.collection("shifts");
    const querySnapshot = await shiftsRef.where("employeeId", "==", employeeId).orderBy("date", "desc").get();

    if (querySnapshot.empty) {
      portalContent.innerHTML = '<h3>Mis Horarios</h3><p>No tienes horarios asignados.</p>';
      return;
    }

    let scheduleHtml = '<h3>Mis Horarios</h3><div class="stack">';
    querySnapshot.forEach(doc => {
      const shift = doc.data();
      const shiftDate = new Date(shift.date + 'T00:00:00');
      const formattedDate = shiftDate.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      // Assuming SLOTS are defined somewhere accessible
      const startTime = SLOTS[shift.startSlot].label;
      const endTime = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : '??';

      scheduleHtml += `
        <div class="card">
          <div class="card-c">
            <strong>${formattedDate}</strong>: ${startTime} - ${endTime}
          </div>
        </div>
      `;
    });
    scheduleHtml += '</div>';
    portalContent.innerHTML = scheduleHtml;

  } catch (error) {
    console.error("Error fetching schedule:", error);
    portalContent.innerHTML = '<h3>Mis Horarios</h3><p>Error al cargar los horarios.</p>';
  }
}

async function renderMyRequests(employeeId) {
  const portalContent = document.getElementById('portal-content');
  portalContent.innerHTML = '<h3>Mis Solicitudes</h3><p>Cargando...</p>';

  try {
    const requestsRef = db.collection("requests");
    const querySnapshot = await requestsRef.where("employeeId", "==", employeeId).orderBy("createdAt", "desc").get();

    if (querySnapshot.empty) {
      portalContent.innerHTML = '<h3>Mis Solicitudes</h3><p>No has realizado ninguna solicitud.</p>';
      return;
    }

    let requestsHtml = '<h3>Mis Solicitudes</h3><div class="stack">';
    querySnapshot.forEach(doc => {
      const request = doc.data();
      const requestId = doc.id;
      const requestDate = new Date(request.date + 'T00:00:00');
      const formattedDate = requestDate.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      requestsHtml += `
        <div class="card">
          <div class="card-c row" style="justify-content: space-between;">
            <div>
              <strong>${formattedDate}</strong>
              <p class="muted">${request.reason || 'Sin motivo'}</p>
            </div>
            <div class="row">
              <span class="badge status-${request.status.toLowerCase()}">${request.status}</span>
              ${request.status === 'PENDING' ? `<button class="btn secondary del cancel-request" data-id="${requestId}">Cancelar</button>` : ''}
            </div>
          </div>
        </div>
      `;
    });
    requestsHtml += '</div>';
    portalContent.innerHTML = requestsHtml;

    document.querySelectorAll('.cancel-request').forEach(button => {
      button.addEventListener('click', async (e) => {
        const requestId = e.target.dataset.id;
        if (confirm('¿Estás seguro de que quieres cancelar esta solicitud?')) {
          await db.collection('requests').doc(requestId).update({ status: 'CANCELLED' });
          renderMyRequests(employeeId);
        }
      });
    });

  } catch (error) {
    console.error("Error fetching requests:", error);
    portalContent.innerHTML = '<h3>Mis Solicitudes</h3><p>Error al cargar las solicitudes.</p>';
  }
}

function renderNewRequestForm(employeeId) {
  const portalContent = document.getElementById('portal-content');
  portalContent.innerHTML = `
    <h3>Solicitar Día Libre</h3>
    <div class="stack">
      <label for="request-date">Fecha</label>
      <input type="date" id="request-date" class="input">
      <label for="request-reason">Motivo (opcional)</label>
      <textarea id="request-reason" class="input" rows="3"></textarea>
      <button id="submit-request" class="btn" style="align-self: flex-end;">Enviar Solicitud</button>
    </div>
  `;
  document.getElementById('submit-request').addEventListener('click', () => submitNewRequest(employeeId));
}

async function submitNewRequest(employeeId) {
    const date = document.getElementById('request-date').value;
    const reason = document.getElementById('request-reason').value;

    if (!date) {
        alert('Por favor, selecciona una fecha.');
        return;
    }

    try {
        await db.collection('requests').add({
            employeeId: employeeId,
            type: 'timeOff',
            date: date,
            reason: reason,
            status: 'PENDING',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert('Solicitud enviada con éxito.');
        setActiveNav(document.getElementById('nav-requests'));
        renderMyRequests(employeeId);
    } catch (error) {
        console.error("Error creating request:", error);
        alert('Hubo un error al enviar tu solicitud.');
    }
}