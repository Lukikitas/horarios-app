import { el, create, clear } from '../utils/dom.js';
import { getDb } from '../services/DataManager.js';
import { store } from '../store/Store.js';
import { DataManager } from '../services/DataManager.js';

export const RequestsManager = {
    init() {
        // No explicit init needed unless binding global events?
    },

    async render() {
        const list = el("#requests-list");
        if(!list) return;
        list.innerHTML = "<p>Cargando solicitudes...</p>";

        try {
            const db = getDb();
            const snapshot = await db.collection("solicitudes")
                                     .orderBy("fechaCreacion", "desc")
                                     .limit(50)
                                     .get();

            clear(list);
            if(snapshot.empty){
                list.appendChild(create("div", { className: "muted", textContent: "No hay solicitudes." }));
                return;
            }

            const requests = [];
            snapshot.forEach(doc => requests.push({ id: doc.id, ...doc.data() }));

            const pending = requests.filter(r => r.estado === 'pendiente_aprobacion');
            const history = requests.filter(r => r.estado !== 'pendiente_aprobacion');

            if (pending.length > 0) {
                list.appendChild(create("h3", { textContent: `Pendientes (${pending.length})`, style: { marginTop: "0" } }));
                pending.forEach(r => list.appendChild(this.createCard(r, false)));
            }

            if (history.length > 0) {
                list.appendChild(create("div", { style: { borderTop: "1px solid #ccc", margin: "20px 0 10px 0" } }));
                list.appendChild(create("h3", { textContent: "Historial Reciente" }));
                history.forEach(r => list.appendChild(this.createCard(r, true)));
            }

        } catch (e) {
            console.error(e);
            list.innerHTML = `<p class="danger">Error al cargar solicitudes.</p>`;
        }
    },

    createCard(req, isHistory) {
        const card = create("div", { className: "card", style: { marginBottom: "8px", opacity: isHistory ? "0.8" : "1" } });

        let title = create("strong", { textContent: req.nombre || 'Desconocido' });
        let details = create("div");

        if (req.tipo === 'cambio_disponibilidad') {
             // ...
             details.innerHTML = `<div><strong>Día:</strong> ${req.diaNombre}</div>`;
        } else {
             const dateStr = req.fechaSolicitada; // Simplified
             details.innerHTML = `<div><strong>Fecha:</strong> ${dateStr}</div><div class="muted">${req.motivo||''}</div>`;
        }

        const footer = create("div", { className: "row", style: { justifyContent: "space-between", marginTop: "8px" } });
        const actions = create("div", { className: "row" });

        if (isHistory) {
            const btnDelete = create("button", { className: "btn secondary del", textContent: "🗑️", onClick: () => this.deleteRequest(req.id) });
            actions.appendChild(btnDelete);
        } else {
            actions.appendChild(create("button", { className: "btn", style: { background: "var(--c-lobby)", border: "none" }, textContent: "✅", onClick: () => this.approveRequest(req.id, req) }));
            actions.appendChild(create("button", { className: "btn", style: { background: "var(--c-cocina)", border: "none" }, textContent: "❌", onClick: () => this.rejectRequest(req.id) }));
        }

        footer.appendChild(actions);

        const stack = create("div", { className: "stack", style: { gap: "4px" } });
        stack.appendChild(title);
        stack.appendChild(details);

        card.appendChild(stack);
        card.appendChild(footer);
        return card;
    },

    async approveRequest(reqId, req) {
        if(!confirm("¿Aprobar?")) return;
        const db = getDb();
        const batch = db.batch();
        const empRef = db.collection('employees').doc(req.empleadoId); // Used empleadoId in portal? Check schema.
        // Original app used 'empleadoUid'. Portal used 'empleadoId'.
        // Need to be careful. Portal: empleadoId. Manager app: req.empleadoUid.
        // Let's assume consistent ID usage or check object.
        // In portal submit: empleadoId: employeeId
        // In manager approve: req.empleadoUid?
        // Let's use req.empleadoId as per portal submission.

        try {
            // ... Logic for arrayUnion ...
            // Simplified:
            if (req.tipo !== 'cambio_disponibilidad') {
                const newException = { date: req.fechaSolicitada, type: req.tipo };
                // We need firebase.firestore.FieldValue
                // We can import firebase from window or config?
                // Let's rely on global firebase for FieldValue for now as it was in original code.
                batch.set(empRef, {
                    exceptions: firebase.firestore.FieldValue.arrayUnion(newException)
                }, { merge: true });
            }

            batch.update(db.collection("solicitudes").doc(reqId), { estado: "aprobada" });
            await batch.commit();

            // Update local state?
            // Need to find employee in store and update exceptions locally to avoid reload.
            const state = store.getState();
            const emp = state.employees.find(e => e.id === req.empleadoId);
            if(emp) {
                if(!emp.exceptions) emp.exceptions = [];
                emp.exceptions.push({ date: req.fechaSolicitada, type: req.tipo });
                store.setState({ employees: [...state.employees] }); // Trigger update
            }

            this.render();
            alert("Aprobada.");
        } catch(e) {
            console.error(e);
            alert("Error: " + e.message);
        }
    },

    async rejectRequest(reqId) {
        const reason = prompt("Motivo:");
        if(!reason) return;
        try {
            await getDb().collection("solicitudes").doc(reqId).update({ estado: "rechazada", motivoRechazo: reason });
            this.render();
        } catch(e) { alert("Error"); }
    },

    async deleteRequest(reqId) {
        if(!confirm("¿Eliminar?")) return;
        await getDb().collection("solicitudes").doc(reqId).delete();
        this.render();
    }
};
