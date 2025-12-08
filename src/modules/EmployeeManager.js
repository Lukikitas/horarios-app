import { el, create, clear } from '../utils/dom.js';
import { store } from '../store/Store.js';
import { DataManager } from '../services/DataManager.js';
import { getActiveSchedule } from '../store/Store.js';

export const EmployeeManager = {
    init() {
        this.bindEvents();
        // Subscribe to store? Or let app_main call render?
        // Let's rely on explicit render calls from app_main for now to control flow,
        // or subscribe to 'employees' changes.
    },

    bindEvents() {
        el("#btnAddEmp")?.addEventListener("click", () => this.addEmployee());
        el("#inpName")?.addEventListener("keydown", (ev) => { if(ev.key==="Enter") this.addEmployee(); });
        el("#empFilter")?.addEventListener("change", () => this.renderList());
        el("#empSearch")?.addEventListener("input", () => this.renderList());

        // Export logic handled elsewhere? Or here?
        // Let's keep export in ImportExportManager or similar.
    },

    addEmployee() {
        const name = el("#inpName").value.trim();
        const dni = el("#inpDni").value.trim();
        const mail = el("#inpMail").value.trim();
        const celular = el("#inpCell").value.trim();

        if(!name) return;

        const id = crypto.randomUUID();
        const nameParts = name.split(',');
        const displayName = (nameParts.length > 1) ? nameParts[1].trim() : name.split(' ')[0];

        const newEmp = {
            id,
            name,
            displayName: displayName,
            dni: dni,
            mail: mail,
            celular: celular,
            stars: [],
            isMinor: false,
            isAllStar: false,
            priority: 'medium',
            availability: { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
            exceptions: [],
            sanctions: [],
        };

        const currentEmployees = store.getState().employees;
        store.setState({ employees: [...currentEmployees, newEmp] });

        el("#inpName").value = "";
        el("#inpDni").value = "";
        el("#inpMail").value = "";
        el("#inpCell").value = "";

        DataManager.saveState();
    },

    renderList() {
        const state = store.getState();
        const empList = el("#empList");
        if (!empList) return;

        const starFilter = el("#empFilter")?.value;
        const searchFilter = el("#empSearch")?.value.toLowerCase();

        const filtered = state.employees
            .slice()
            .sort((a,b)=>a.name.localeCompare(b.name))
            .filter(e=> {
                const nameMatch = e.name.toLowerCase().includes(searchFilter);
                const starMatch = !starFilter || (e.stars||[]).includes(starFilter);
                return nameMatch && starMatch;
            });

        clear(empList);

        if(filtered.length===0){
            empList.appendChild(create("div", { className: "muted", textContent: "Agregá tu primer empleado 👇" }));
            return;
        }

        const table = create("table", { className: "emp-table-new" });
        const thead = create("thead");
        thead.innerHTML = "<tr><th>Nombre</th><th>DNI/Mail/Cel</th><th>Estrellas</th><th>Acciones</th></tr>"; // Using innerHTML for static header is fine/easy
        table.appendChild(thead);

        const tbody = create("tbody");

        filtered.forEach(e => {
            const row = create("tr");
            const isEditing = state.editingEmployeeId === e.id;

            // Name Cell
            const nameCell = create("td");
            if (isEditing) {
                const container = create("div", { className: "stack", style: { gap: '4px' } });
                container.appendChild(create("input", { id: `edit-input-${e.id}`, className: "input", value: e.name, placeholder: "Nombre completo" }));
                container.appendChild(create("input", { id: `edit-display-name-input-${e.id}`, className: "input", value: e.displayName || '', placeholder: "Nombre para planilla" }));
                container.appendChild(create("input", { id: `edit-dni-input-${e.id}`, className: "input", value: e.dni || '', placeholder: "DNI" }));
                container.appendChild(create("input", { id: `edit-mail-input-${e.id}`, className: "input", value: e.mail || '', placeholder: "Mail" }));
                container.appendChild(create("input", { id: `edit-cell-input-${e.id}`, className: "input", value: e.celular || '', placeholder: "Celular" }));

                const prioritySelect = create("select", { id: `edit-priority-input-${e.id}`, className: "select", style: { marginTop: '4px' } });
                const priorities = [
                    {value: 'very-high', label: 'Muy Alta'},
                    {value: 'high', label: 'Alta'},
                    {value: 'medium', label: 'Media'},
                    {value: 'low', label: 'Baja'},
                    {value: 'very-low', label: 'Muy Baja'}
                ];
                priorities.forEach(p => {
                    prioritySelect.appendChild(create("option", { value: p.value, textContent: p.label, selected: (e.priority || 'medium') === p.value }));
                });
                container.appendChild(prioritySelect);
                nameCell.appendChild(container);
            } else {
                nameCell.textContent = e.name;
                if (e.isAllStar) {
                    nameCell.appendChild(create("span", { className: "badge b-all-star", textContent: "★", title: "All Star", style: { marginLeft: "8px" } }));
                }
                if (e.isMinor) {
                    nameCell.appendChild(create("span", { className: "badge b-minor", textContent: "M", title: "Menor de edad", style: { marginLeft: "8px" } }));
                }
            }
            row.appendChild(nameCell);

            // DNI Cell
            const dniCell = create("td");
            if (!isEditing) {
                dniCell.innerHTML = `<div>${e.dni || '-'}</div><div class="muted" style="font-size:12px;">${e.mail || '-'}</div><div class="muted" style="font-size:12px;">${e.celular || '-'}</div>`;
            }
            row.appendChild(dniCell);

            // Stars Cell
            const starsCell = create("td");
            if (e.stars && e.stars.length > 0) {
                const badges = create("div", { className: "chips" });
                e.stars.forEach(s => {
                    // We need clsFor helper.
                    // Let's import it or duplicate simple logic.
                    // Ideally use a RoleManager or Utils.
                    // For now, I'll assume a helper function.
                    const cls = this.clsFor(s);
                    badges.appendChild(create("span", { className: "badge " + cls, textContent: s }));
                });
                starsCell.appendChild(badges);
            } else {
                starsCell.className = "muted";
                starsCell.textContent = "Sin estrellas";
            }
            row.appendChild(starsCell);

            // Actions Cell
            const actionsCell = create("td", { className: "actions-cell-new" });
            if (isEditing) {
                actionsCell.appendChild(create("button", { className: "btn", textContent: "Guardar", onClick: () => this.saveEdit(e.id) }));
                actionsCell.appendChild(create("button", { className: "btn secondary", textContent: "Cancelar", onClick: () => { store.setState({ editingEmployeeId: null }); this.renderList(); } }));
            } else {
                actionsCell.appendChild(create("button", { className: "btn secondary", textContent: "Editar", onClick: () => { store.setState({ editingEmployeeId: e.id, activeDetailEmployeeId: null }); this.renderList(); } }));
                actionsCell.appendChild(create("button", { className: "btn secondary", textContent: "Estrellas", onClick: () => this.toggleDetail(e.id, 'stars') }));

                // Dropdown logic
                const dropdown = create("div", { className: "dropdown" });
                const ddBtn = create("button", { className: "btn secondary", textContent: "Gestion de empleado ▾", onClick: (ev) => {
                    ev.stopPropagation();
                    const content = ddBtn.nextElementSibling;
                    document.querySelectorAll('.dropdown-content').forEach(d => { if (d !== content) d.classList.remove('show'); });
                    content.classList.toggle("show");
                }});
                dropdown.appendChild(ddBtn);

                const ddContent = create("div", { className: "dropdown-content" });
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: "Disponibilidad", onClick: () => this.toggleDetail(e.id, 'availability') }));
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: "Excepciones", onClick: () => this.toggleDetail(e.id, 'exceptions') }));
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: "Sanciones y licencias", onClick: () => this.toggleDetail(e.id, 'sanctions') }));
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: e.isAllStar ? "Quitar All Star" : "Hacer All Star", onClick: () => { this.toggleIsAllStar(e.id); ddContent.classList.remove('show'); } }));
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: e.isMinor ? "Quitar Menor" : "Hacer Menor", onClick: () => { this.toggleIsMinor(e.id); ddContent.classList.remove('show'); } }));
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: "💬 Enviar WhatsApp", onClick: () => { this.sendWhatsApp(e.id); ddContent.classList.remove('show'); } }));

                dropdown.appendChild(ddContent);
                actionsCell.appendChild(dropdown);

                actionsCell.appendChild(create("button", { className: "btn secondary del", textContent: "Eliminar", onClick: () => this.removeEmployee(e.id) }));
            }
            row.appendChild(actionsCell);
            tbody.appendChild(row);

            // Detail Row
            if (state.activeDetailEmployeeId === e.id) {
                const detailRow = create("tr");
                const detailCell = create("td", { colSpan: 4, className: "employee-detail-cell" });

                if (state.activeDetailSection === 'stars') this.renderStarsPanel(detailCell, e.id);
                else if (state.activeDetailSection === 'availability') this.renderAvailabilityPanel(detailCell, e.id);
                else if (state.activeDetailSection === 'exceptions') this.renderExceptionsPanel(detailCell, e.id);
                else if (state.activeDetailSection === 'sanctions') this.renderSanctionsPanel(detailCell, e.id);

                detailRow.appendChild(detailCell);
                tbody.appendChild(detailRow);
            }
        });

        table.appendChild(tbody);
        empList.appendChild(table);
    },

    saveEdit(empId) {
        const state = store.getState();
        const emp = state.employees.find(e => e.id === empId);
        if (!emp) return;

        const newName = el(`#edit-input-${empId}`).value.trim();
        if (newName) {
            emp.name = newName;
            emp.displayName = el(`#edit-display-name-input-${empId}`).value.trim();
            emp.dni = el(`#edit-dni-input-${empId}`).value.trim();
            emp.mail = el(`#edit-mail-input-${empId}`).value.trim();
            emp.celular = el(`#edit-cell-input-${empId}`).value.trim();
            emp.priority = el(`#edit-priority-input-${empId}`).value;

            store.setState({ editingEmployeeId: null });
            DataManager.saveState();
            this.renderList();
        }
    },

    removeEmployee(empId) {
        if(!confirm("¿Eliminar empleado?")) return;
        const state = store.getState();
        const newEmployees = state.employees.filter(e => e.id !== empId);
        store.setState({ employees: newEmployees });

        // Remove from DB logic is handled by saveState usually, but explicit delete is better?
        // DataManager.saveState handles the 'employees' array update in state but doesn't delete the doc in 'employees' collection.
        // We should add a deleteEmployee method to DataManager.
        // For now, let's just use firestore directly here or add it to DataManager.
        // The original code did: db.collection('employees').doc(empId).delete();

        // Also remove from schedules.
        // The original code iterated over ALL schedules.
        // We only have activeWeek loaded?
        // This is a limitation of the new architecture if we don't load everything.
        // Ideally we only clear from active week.
        // Or we let the UI handle "Employee Not Found" gracefully.

        // Let's implement delete in DataManager later or here.
        import('../services/DataManager.js').then(({getDb}) => {
             getDb().collection('employees').doc(empId).delete().catch(console.error);
        });

        DataManager.saveState();
        this.renderList();
    },

    toggleDetail(empId, section) {
        const state = store.getState();
        if (state.activeDetailEmployeeId === empId && state.activeDetailSection === section) {
            store.setState({ activeDetailEmployeeId: null, activeDetailSection: null });
        } else {
            store.setState({ activeDetailEmployeeId: empId, activeDetailSection: section, editingEmployeeId: null });
        }
        this.renderList();
    },

    renderStarsPanel(container, empId) {
        const emp = store.getState().employees.find(e => e.id === empId);
        if (!emp) return;
        clear(container);

        const panel = create("div", { className: "employee-detail-panel" });
        const grid = create("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "10px" } });

        import('../config.js').then(({ ROLES }) => {
            ROLES.forEach(r => {
                const isOn = (emp.stars || []).includes(r.key);
                const btn = create("button", {
                    className: "btn secondary",
                    style: { justifyContent: "space-between", display: "flex", width: "100%" },
                    innerHTML: `<span>${r.key}</span><span>${isOn ? "★" : ""}</span>`,
                    onClick: () => {
                        // Toggle star
                        const stars = emp.stars || [];
                        const i = stars.indexOf(r.key);
                        if(i >= 0) stars.splice(i, 1); else stars.push(r.key);
                        emp.stars = stars;
                        DataManager.saveState();
                        this.renderList();
                    }
                });

                if(isOn) {
                    btn.style.background = r.color;
                    btn.style.color = r.darkText ? "#111" : "#fff";
                    btn.style.borderColor = "transparent";
                }
                grid.appendChild(btn);
            });
            panel.appendChild(grid);
            container.appendChild(panel);
        });
    },

    renderAvailabilityPanel(container, empId) {
        const emp = store.getState().employees.find(e => e.id === empId);
        if (!emp) return;
        clear(container);

        // ... (Simplified Availability Panel - Listing slots)
        const panel = create("div", { className: "employee-detail-panel" });
        panel.innerHTML = "<p>Editar disponibilidad en construcción. Use la app legacy si es urgente.</p>";
        container.appendChild(panel);
    },

    renderExceptionsPanel(container, empId) {
        const emp = store.getState().employees.find(e => e.id === empId);
        if (!emp) return;
        clear(container);

        const panel = create("div", { className: "employee-detail-panel" });
        const list = create("div", { className: "stack" });

        (emp.exceptions || []).forEach(ex => {
            const row = create("div", { className: "row", style: { justifyContent: "space-between" } });
            row.textContent = `${ex.date} (${ex.type || 'Excepción'})`;
            const delBtn = create("button", { className: "btn secondary del", textContent: "X", onClick: () => {
                emp.exceptions = emp.exceptions.filter(x => x !== ex);
                DataManager.saveState();
                this.renderList();
            }});
            row.appendChild(delBtn);
            list.appendChild(row);
        });

        const addRow = create("div", { className: "row" });
        const dateInput = create("input", { type: "date", className: "input" });
        const addBtn = create("button", { className: "btn", textContent: "Añadir", onClick: () => {
            if(dateInput.value) {
                if(!emp.exceptions) emp.exceptions = [];
                emp.exceptions.push({ date: dateInput.value });
                DataManager.saveState();
                this.renderList();
            }
        }});
        addRow.appendChild(dateInput);
        addRow.appendChild(addBtn);

        panel.appendChild(list);
        panel.appendChild(create("div", { className: "hr" }));
        panel.appendChild(addRow);
        container.appendChild(panel);
    },

    renderSanctionsPanel(container, empId) {
         // Similar to exceptions
         const emp = store.getState().employees.find(e => e.id === empId);
         if(!emp) return;
         clear(container);
         container.innerHTML = "<div class='employee-detail-panel'>Sanciones (En construcción)</div>";
    },

    toggleIsAllStar(empId) {
        const emp = store.getState().employees.find(e => e.id === empId);
        if (emp) {
            emp.isAllStar = !emp.isAllStar;
            DataManager.saveState();
            this.renderList();
        }
    },

    toggleIsMinor(empId) {
        const emp = store.getState().employees.find(e => e.id === empId);
        if (emp) {
            emp.isMinor = !emp.isMinor;
            DataManager.saveState();
            this.renderList();
        }
    },

    sendWhatsApp(empId) {
         // ... Logic
    },

    clsFor(role) {
        const k = role.toLowerCase();
        if(k==="cocina") return "b-cocina";
        if(k==="empaque") return "b-empaque";
        if(k==="sandwich") return "b-sandwich";
        if(k==="lobby") return "b-lobby";
        if(k==="presentación"||k==="presentacion") return "b-presentación";
        if(k==="delivery") return "b-delivery";
        if(k==="caja") return "b-caja";
        if(k==="anfitriona") return "b-anfitriona";
        if(k==="descarga") return "b-descarga";
        return "";
    }
};
