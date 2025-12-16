import { el, create, clear } from '../utils/dom.js';
import { store } from '../store/Store.js';
import { DataManager } from '../services/DataManager.js';
import { getActiveSchedule } from '../store/Store.js';
import { ROLES } from '../config.js';
import { storeEmployeesRef, legacyEmployeesRef } from '../services/firestoreRefs.js';

const EXPORT_FIELD_CONFIG = {
    name: { label: 'Nombre completo', getter: (e) => e.name || '' },
    displayName: { label: 'Nombre para planilla', getter: (e) => e.displayName || '' },
    dni: { label: 'DNI', getter: (e) => e.dni || '' },
    mail: { label: 'Mail', getter: (e) => e.mail || '' },
    celular: { label: 'Celular', getter: (e) => e.celular || '' },
    stars: { label: 'Roles/Estrellas', getter: (e) => (e.stars || []).join(', ') || 'Sin roles' },
    allStar: { label: 'All Star', getter: (e) => e.isAllStar ? 'Sí' : 'No' },
    minor: { label: 'Menor', getter: (e) => e.isMinor ? 'Sí' : 'No' },
    availability: { label: 'Disponibilidad (resumen)', getter: (e, ctx) => ctx.getAvailabilitySummary(e) },
    exceptions: { label: 'Excepciones', getter: (e) => `${(e.exceptions || []).length}` },
    sanctions: { label: 'Licencias / sanciones', getter: (e) => `${(e.sanctions || []).length}` },
    priority: { label: 'Prioridad', getter: (e, ctx) => ctx.priorityLabel(e.priority) }
};

export const EmployeeManager = {
    init() {
        this.roleSignature = '';
        this.populateRoleFilter();
        this.bindEvents();
        store.subscribe((state) => this.handleStoreUpdate(state));
    },

    bindEvents() {
        el("#btnAddEmp")?.addEventListener("click", () => this.addEmployee());
        el("#inpName")?.addEventListener("keydown", (ev) => { if(ev.key==="Enter") this.addEmployee(); });
        el("#empFilter")?.addEventListener("change", () => this.renderList());
        el("#empSearch")?.addEventListener("input", () => this.renderList());
        el("#empSort")?.addEventListener("change", () => this.renderList());
        el("#btn-clear-emp-filters")?.addEventListener("click", () => this.resetFilters());
        el("#fileImportExcel")?.addEventListener("change", (ev) => this.importFromExcel(ev));
        el("#btn-export-employees-excel")?.addEventListener("click", () => this.exportSelected("excel"));
        el("#btn-export-employees-pdf")?.addEventListener("click", () => this.exportSelected("pdf"));
        el("#btn-select-all-fields")?.addEventListener("click", () => this.toggleExportFields(true));
        el("#btn-clear-fields")?.addEventListener("click", () => this.toggleExportFields(false));
        this.bindExportDropdown();

        ["#filterAllStarOnly", "#filterMinorOnly", "#filterSanctionsOnly", "#filterAvailabilityOnly"].forEach(sel => {
            el(sel)?.addEventListener("change", () => this.renderList());
        });
    },

    bindExportDropdown() {
        const btn = el('#btn-export-fields-menu');
        const dropdown = el('#export-fields-dropdown');
        if (!btn || !dropdown) return;

        const hide = () => dropdown.classList.remove('show');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('show');
            document.querySelectorAll('.dropdown-content').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
            dropdown.classList.toggle('show', !isOpen);
        });

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== btn) hide();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hide();
        });
    },

    handleStoreUpdate(state) {
        const roles = (state?.roles && state.roles.length) ? state.roles : ROLES;
        const signature = roles.map(r => `${r.key}-${r.color || ''}-${r.darkText ? '1' : '0'}`).join('|');
        if (signature !== this.roleSignature) {
            this.roleSignature = signature;
            this.populateRoleFilter(roles);
        }
    },

    populateRoleFilter(rolesList = []) {
        const empFilter = el("#empFilter");
        if (!empFilter) return;

        const roles = rolesList.length ? rolesList : ((store.getState().roles && store.getState().roles.length) ? store.getState().roles : ROLES);

        empFilter.innerHTML = "";
        empFilter.appendChild(create("option", { value: "", textContent: "Todos" }));
        roles.forEach(role => empFilter.appendChild(create("option", { value: role.key, textContent: role.key })));
    },

    resetFilters() {
        const search = el("#empSearch");
        const star = el("#empFilter");
        const sort = el("#empSort");

        if (search) search.value = "";
        if (star) star.value = "";
        if (sort) sort.value = "name";

        ["#filterAllStarOnly", "#filterMinorOnly", "#filterSanctionsOnly", "#filterAvailabilityOnly"].forEach(sel => {
            const checkbox = el(sel);
            if (checkbox) checkbox.checked = false;
        });

        this.renderList();
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

    importFromExcel(event) {
        const file = event?.target?.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                const employees = [...(store.getState().employees || [])];
                let importedCount = 0;

                rows.slice(1).forEach(row => {
                    const name = row[0];
                    if (name && String(name).trim()) {
                        const normalized = String(name).trim();
                        const aliasParts = normalized.split(',');
                        const displayName = (aliasParts.length > 1) ? aliasParts[1].trim() : normalized.split(' ')[0];
                        const id = crypto.randomUUID();
                        const base = {
                            id,
                            name: normalized,
                            displayName: displayName,
                            dni: '',
                            mail: '',
                            celular: '',
                            stars: [],
                            isMinor: false,
                            isAllStar: false,
                            priority: 'medium',
                            availability: { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
                            exceptions: [],
                            sanctions: [],
                        };
                        employees.push(base);
                        importedCount++;
                    }
                });

                store.setState({ employees });
                DataManager.saveState();
                alert(`Se importaron ${importedCount} empleados.`);
            } catch (err) {
                console.error(err);
                alert('Error al importar empleados.');
            }
        };
        reader.readAsArrayBuffer(file);
        event.target.value = "";
    },

    renderList() {
        const state = store.getState();
        const empList = el("#empList");
        if (!empList) return;

        const starFilter = el("#empFilter")?.value;
        const searchFilter = (el("#empSearch")?.value || "").toLowerCase();
        const sortMode = el("#empSort")?.value || "name";

        const filters = {
            allStarOnly: el("#filterAllStarOnly")?.checked,
            minorOnly: el("#filterMinorOnly")?.checked,
            sanctionsOnly: el("#filterSanctionsOnly")?.checked,
            availabilityOnly: el("#filterAvailabilityOnly")?.checked,
        };

        const employees = Array.isArray(state.employees) ? state.employees : [];

        const filtered = employees
            .filter(e => e && typeof e === 'object') // Filter out null/undefined entries
            .slice()
            .sort((a, b) => this.sortEmployees(a, b, sortMode))
            .filter(e => {
                const name = e.name || '';
                const contact = `${e.mail || ''} ${e.celular || ''} ${e.dni || ''}`;
                const nameMatch = `${name} ${contact}`.toLowerCase().includes(searchFilter);
                const starMatch = !starFilter || (e.stars || []).includes(starFilter);
                const allStarMatch = !filters.allStarOnly || e.isAllStar;
                const minorMatch = !filters.minorOnly || e.isMinor;
                const sanctionMatch = !filters.sanctionsOnly || ((e.sanctions || []).length > 0);
                const availabilityMatch = !filters.availabilityOnly || this.hasAvailability(e);

                return nameMatch && starMatch && allStarMatch && minorMatch && sanctionMatch && availabilityMatch;
            });

        clear(empList);

        this.updateStats(employees, filtered);

        if(filtered.length===0){
            empList.appendChild(create("div", { className: "muted", textContent: "Agregá tu primer empleado 👇" }));
            return;
        }

        const table = create("table", { className: "emp-table-new" });
        const thead = create("thead");
        thead.innerHTML = "<tr><th>Nombre</th><th>Contacto</th><th>Estrellas</th><th>Acciones</th></tr>";
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
                const titleRow = create("div", { className: "employee-name-row" });
                titleRow.appendChild(create("strong", { textContent: e.name || 'Sin nombre' }));

                const flags = create("div", { className: "employee-flags" });
                if (e.isAllStar) flags.appendChild(create("span", { className: "badge b-all-star", textContent: "All Star" }));
                if (e.isMinor) flags.appendChild(create("span", { className: "badge b-minor", textContent: "Menor" }));
                const sanctionsCount = (e.sanctions || []).length;
                if (sanctionsCount > 0) flags.appendChild(create("span", { className: "badge b-empaque", textContent: `${sanctionsCount} sanc.` }));
                titleRow.appendChild(flags);
                nameCell.appendChild(titleRow);

                nameCell.appendChild(create("div", { className: "muted", style: { fontSize: "12px" }, textContent: e.displayName || "Sin alias de planilla" }));

                const meta = create("div", { className: "employee-meta" });
                const exceptions = (e.exceptions || []).length;
                if (exceptions > 0) meta.appendChild(create("span", { className: "pill pill-neutral", textContent: `${exceptions} excepción${exceptions === 1 ? '' : 'es'}` }));
                const starCount = (e.stars || []).length;
                meta.appendChild(create("span", { className: "pill pill-neutral", textContent: starCount > 0 ? `${starCount} rol${starCount === 1 ? '' : 'es'}` : "Sin roles" }));
                nameCell.appendChild(meta);
            }
            row.appendChild(nameCell);

            // Contact Cell
            const contactCell = create("td");
            if (!isEditing) {
                const contactStack = create("div", { className: "employee-contact" });
                contactStack.appendChild(create("span", { textContent: e.dni ? `DNI: ${e.dni}` : "DNI no cargado" }));
                contactStack.appendChild(create("span", { className: e.mail ? "" : "muted", textContent: e.mail || "Mail no cargado" }));
                contactStack.appendChild(create("span", { className: e.celular ? "" : "muted", textContent: e.celular || "Celular no cargado" }));
                contactCell.appendChild(contactStack);
            }
            row.appendChild(contactCell);

            // Stars Cell
            const starsCell = create("td");
            if (e.stars && e.stars.length > 0) {
                const badges = create("div", { className: "chips" });
                e.stars.forEach(s => {
                    const roleInfo = ROLES.find(r => r.key.toLowerCase() === s.toLowerCase());
                    badges.appendChild(create("span", {
                        className: "badge",
                        textContent: s,
                        style: roleInfo ? { background: roleInfo.color, color: roleInfo.darkText ? '#111' : '#fff' } : {}
                    }));
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
                actionsCell.appendChild(create("button", { className: "btn secondary", textContent: "Disponibilidad", onClick: () => this.toggleDetail(e.id, 'availability') }));
                actionsCell.appendChild(create("button", { className: "btn secondary", textContent: "Excepciones", onClick: () => this.toggleDetail(e.id, 'exceptions') }));

                // Dropdown logic
                const dropdown = create("div", { className: "dropdown" });
                const ddBtn = create("button", { className: "btn secondary", textContent: "Gestión de empleado ▾", onClick: (ev) => {
                    ev.stopPropagation();
                    const content = ddBtn.nextElementSibling;
                    document.querySelectorAll('.dropdown-content').forEach(d => { if (d !== content) d.classList.remove('show'); });
                    content.classList.toggle("show");
                }});
                dropdown.appendChild(ddBtn);

                const ddContent = create("div", { className: "dropdown-content" });
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: "Sanciones y licencias", onClick: () => this.toggleDetail(e.id, 'sanctions') }));
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: e.isAllStar ? "Quitar All Star" : "Hacer All Star", onClick: () => { this.toggleIsAllStar(e.id); ddContent.classList.remove('show'); } }));
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: e.isMinor ? "Quitar Menor" : "Hacer Menor", onClick: () => { this.toggleIsMinor(e.id); ddContent.classList.remove('show'); } }));
                ddContent.appendChild(create("button", { className: "dropdown-item", textContent: "💬 Enviar WhatsApp", onClick: () => { this.sendWhatsApp(e.id); ddContent.classList.remove('show'); } }));
                ddContent.appendChild(create("button", { className: "dropdown-item del", textContent: "Eliminar empleado", onClick: () => { this.removeEmployee(e.id); ddContent.classList.remove('show'); } }));

                dropdown.appendChild(ddContent);
                actionsCell.appendChild(dropdown);
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

        import('../services/DataManager.js').then(({getDb}) => {
             const storeId = store.getState().activeStoreId;
             const ref = storeId ? storeEmployeesRef(storeId) : legacyEmployeesRef(); // TODO MIGRACION MULTI-LOCAL
             ref.doc(empId).delete().catch(console.error);
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

        const panel = create("div", { className: "employee-detail-panel" });

        if (!emp.availability || Array.isArray(emp.availability)) {
            emp.availability = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
        }

        const content = create("div");
        const stack = create("div", { className: "stack" });
        stack.appendChild(create("strong", { textContent: "Disponibilidad Semanal" }));

        const DAYS = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
        import('../config.js').then(({ SLOTS }) => {
            if (!SLOTS) {
                stack.appendChild(create("div", { textContent: "Error cargando slots." }));
                return;
            }

            const getSlotLabel = (timeValue, slotIndex, isEnd = false) => {
                if (typeof timeValue === 'number') {
                    const idx = isEnd ? timeValue + 1 : timeValue;
                    return SLOTS[idx]?.label || '';
                }

                if (typeof slotIndex === 'number') {
                    const idx = isEnd ? slotIndex + 1 : slotIndex;
                    if (SLOTS[idx]?.label) return SLOTS[idx].label;
                }

                if (typeof timeValue === 'string') {
                    const normalized = timeValue.trim().substring(0, 5);
                    const padded = normalized.length === 4 ? '0' + normalized : normalized;
                    const match = SLOTS.find(s => s.label === padded);
                    if (match) return match.label;
                }

                return '';
            };

            DAYS.forEach((day, dayIndex) => {
                const dayAvailability = emp.availability[dayIndex] || [];
                const dayRow = create("div", {
                    className: "row",
                    style: { borderTop: "1px solid var(--border)", padding: "8px 0", alignItems: "flex-start" }
                });

                dayRow.appendChild(create("strong", { style: { width: "120px", paddingTop: "8px" }, textContent: day }));

                const slotsStack = create("div", { className: "stack", style: { flex: 1, gap: "8px" } });

                if (dayAvailability.length === 0) {
                    slotsStack.appendChild(create("span", { className: "muted", style: { fontSize:"12px", paddingTop:"8px" }, textContent: "Día libre / Full-time" }));
                } else {
                    dayAvailability.forEach((slot, slotIndex) => {
                        const startValue = getSlotLabel(slot.start, slot.startSlot, false);
                        const endValue = getSlotLabel(slot.end, slot.endSlot, true);

                        const slotRow = create("div", { className: "row", style: { justifyContent: "space-between", width: "100%" } });
                        const timeRow = create("div", { className: "row" });

                        const startSel = create("select", { className: "select availability-start" });
                        startSel.appendChild(create("option", { value:"", textContent:"--" }));
                        SLOTS.forEach(s => startSel.appendChild(create("option", { value:s.label, textContent:s.label })));
                        if (startValue) startSel.value = startValue;
                        startSel.onchange = (e) => { slot.start = e.target.value || null; };

                        const endSel = create("select", { className: "select availability-end" });
                        endSel.appendChild(create("option", { value:"", textContent:"--" }));
                        SLOTS.forEach(s => endSel.appendChild(create("option", { value:s.label, textContent:s.label })));
                        if (endValue) endSel.value = endValue;
                        endSel.onchange = (e) => { slot.end = e.target.value || null; };

                        timeRow.appendChild(startSel);
                        timeRow.appendChild(create("span", { textContent:"-" }));
                        timeRow.appendChild(endSel);

                        slotRow.appendChild(timeRow);
                        slotRow.appendChild(create("button", { className: "btn secondary del", textContent: "X", style:{ padding:"2px 6px" }, onClick: () => {
                            emp.availability[dayIndex].splice(slotIndex, 1);
                            this.renderAvailabilityPanel(container, empId);
                        }}));

                        slotsStack.appendChild(slotRow);
                    });
                }

                const addDiv = create("div", { style: { width: "100%" } });
                addDiv.appendChild(create("button", { className: "btn secondary", textContent: "+", style: { padding: "2px 8px" }, onClick: () => {
                    if (!emp.availability[dayIndex]) emp.availability[dayIndex] = [];
                    emp.availability[dayIndex].push({ start: null, end: null });
                    this.renderAvailabilityPanel(container, empId);
                }}));
                slotsStack.appendChild(addDiv);

                dayRow.appendChild(slotsStack);
                stack.appendChild(dayRow);
            });

            content.appendChild(stack);
            content.appendChild(create("div", { className: "hr" }));

            const footer = create("div", { style: { textAlign: "right" } });
            footer.appendChild(create("button", { className: "btn", textContent: "Guardar y Cerrar", onClick: () => {
                DataManager.saveState();
                store.setState({ activeDetailEmployeeId: null });
                this.renderList();
            }}));
            content.appendChild(footer);

            panel.appendChild(content);
            container.appendChild(panel);
        });
    },

    renderExceptionsPanel(container, empId) {
        const emp = store.getState().employees.find(e => e.id === empId);
        if (!emp) return;
        clear(container);

        const panel = create("div", { className: "employee-detail-panel" });
        const list = create("div", { className: "stack" });

        (emp.exceptions || []).forEach(ex => {
            const row = create("div", { className: "row", style: { justifyContent: "space-between" } });
            const timeInfo = ex.start && ex.end ? ` (${ex.start} - ${ex.end})` : ' (Día completo)';
            row.textContent = `${ex.date}${timeInfo} - ${ex.type || 'Excepción'}`;

            const delBtn = create("button", { className: "btn secondary del", textContent: "X", onClick: () => {
                emp.exceptions = emp.exceptions.filter(x => x !== ex);
                DataManager.saveState();
                this.renderList();
            }});
            row.appendChild(delBtn);
            list.appendChild(row);
        });

        const addRow = create("div", { className: "row", style: { gap: '8px', flexWrap: 'wrap' } });
        const dateInput = create("input", { type: "date", className: "input" });
        const startInput = create("input", { type: "time", className: "input", title: "Inicio (opcional)" });
        const endInput = create("input", { type: "time", className: "input", title: "Fin (opcional)" });

        const addBtn = create("button", { className: "btn", textContent: "Añadir", onClick: () => {
            if(dateInput.value) {
                if(!emp.exceptions) emp.exceptions = [];
                const newEx = {
                    date: dateInput.value,
                    start: startInput.value || null,
                    end: endInput.value || null
                };
                // If only one time is set, it's invalid for range, assume full day?
                // Or require both for partial.
                if ((newEx.start && !newEx.end) || (!newEx.start && newEx.end)) {
                    alert("Para excepción parcial, ingresa Inicio y Fin.");
                    return;
                }

                emp.exceptions.push(newEx);
                DataManager.saveState();
                this.renderList();
            } else {
                alert("Ingresa una fecha.");
            }
        }});

        addRow.appendChild(create("label", { textContent: "Fecha:", className: "muted", style: {fontSize:'12px'} }));
        addRow.appendChild(dateInput);
        addRow.appendChild(create("label", { textContent: "De:", className: "muted", style: {fontSize:'12px'} }));
        addRow.appendChild(startInput);
        addRow.appendChild(create("label", { textContent: "A:", className: "muted", style: {fontSize:'12px'} }));
        addRow.appendChild(endInput);
        addRow.appendChild(addBtn);

        panel.appendChild(list);
        panel.appendChild(create("div", { className: "hr" }));
        panel.appendChild(addRow);
        container.appendChild(panel);
    },

    renderSanctionsPanel(container, empId) {
        const emp = store.getState().employees.find(e => e.id === empId);
        if (!emp) return;
        clear(container);

        const panel = create("div", { className: "employee-detail-panel" });
        const stack = create("div", { className: "stack" });
        stack.appendChild(create("strong", { textContent: "Sanciones y Licencias" }));

        const list = create("div", { className: "stack", id: "sanctions-list" });
        (emp.sanctions || []).forEach((sanc, index) => {
            const row = create("div", {
                className: "row",
                style: { justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "8px", marginBottom: "8px" }
            });

            const infoStack = create("div", { className: "stack", style: { gap: "2px" } });
            infoStack.appendChild(create("span", { style: { fontWeight: "500" }, textContent: sanc.description || 'Sin descripción' }));
            infoStack.appendChild(create("span", { className: "muted", style: { fontSize: "12px" }, textContent: `Del ${sanc.startDate} al ${sanc.endDate}` }));
            if (sanc.integra) {
                infoStack.appendChild(create("span", { className: "badge b-minor", style: { fontSize: "10px", padding: "2px 4px", width: "fit-content" }, textContent: "Pasado en Integra" }));
            }
            row.appendChild(infoStack);

            row.appendChild(create("button", { className: "btn secondary del", textContent: "X", onClick: () => {
                emp.sanctions.splice(index, 1);
                this.renderSanctionsPanel(container, empId);
            }}));
            list.appendChild(row);
        });
        if (!emp.sanctions || emp.sanctions.length === 0) {
            list.appendChild(create("p", { className: "muted", textContent: "No hay sanciones." }));
        }
        stack.appendChild(list);

        stack.appendChild(create("div", { className: "hr" }));
        stack.appendChild(create("strong", { textContent: "Añadir Nueva" }));

        const formRow = create("div", { className: "row", style: { gap: "8px", alignItems: "flex-end" } });

        const descStack = create("div", { className: "stack", style: { gap: "4px", flex: 1 } });
        descStack.appendChild(create("label", { className: "muted", style: { fontSize: "12px" }, textContent: "Descripción" }));
        const descInput = create("input", { className: "input", id: "sanction-description" });
        descStack.appendChild(descInput);

        const startStack = create("div", { className: "stack", style: { gap: "4px" } });
        startStack.appendChild(create("label", { className: "muted", style: { fontSize: "12px" }, textContent: "Inicio" }));
        const startInput = create("input", { type: "date", className: "input", id: "sanction-start-date" });
        startStack.appendChild(startInput);

        const endStack = create("div", { className: "stack", style: { gap: "4px" } });
        endStack.appendChild(create("label", { className: "muted", style: { fontSize: "12px" }, textContent: "Fin" }));
        const endInput = create("input", { type: "date", className: "input", id: "sanction-end-date" });
        endStack.appendChild(endInput);

        formRow.appendChild(descStack);
        formRow.appendChild(startStack);
        formRow.appendChild(endStack);
        stack.appendChild(formRow);

        const actionRow = create("div", { className: "row", style: { justifyContent: "space-between", marginTop: "8px" } });
        const checkRow = create("div", { className: "row", style: { alignItems: "center", gap: "8px" } });
        const integraCheck = create("input", { type: "checkbox", style: { width: "16px", height: "16px" }, id: "sanction-integra" });
        checkRow.appendChild(integraCheck);
        checkRow.appendChild(create("label", { htmlFor: "sanction-integra", textContent: "Pasado en Integra" }));
        actionRow.appendChild(checkRow);

        actionRow.appendChild(create("button", { className: "btn", textContent: "Añadir", onClick: () => {
            if (startInput.value && endInput.value && descInput.value) {
                if (new Date(endInput.value) < new Date(startInput.value)) { alert("Fin < Inicio"); return; }
                if(!emp.sanctions) emp.sanctions = [];
                emp.sanctions.push({
                    id: crypto.randomUUID(),
                    description: descInput.value,
                    startDate: startInput.value,
                    endDate: endInput.value,
                    integra: integraCheck.checked
                });
                this.renderSanctionsPanel(container, empId);
            } else {
                alert("Complete todos los campos.");
            }
        }}));
        stack.appendChild(actionRow);

        stack.appendChild(create("div", { className: "hr" }));
        const footer = create("div", { style: { textAlign: "right" } });
        footer.appendChild(create("button", { className: "btn", textContent: "Guardar y Cerrar", onClick: () => {
            DataManager.saveState();
            store.setState({ activeDetailEmployeeId: null });
            this.renderList();
        }}));
        stack.appendChild(footer);

        panel.appendChild(stack);
        container.appendChild(panel);
    },

    sortEmployees(a, b, mode) {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        const priorityOrder = { 'very-high': 1, 'high': 2, 'medium': 3, 'low': 4, 'very-low': 5 };

        if (mode === 'priority') {
            const pa = priorityOrder[a.priority] || priorityOrder['medium'];
            const pb = priorityOrder[b.priority] || priorityOrder['medium'];
            if (pa !== pb) return pa - pb;
        } else if (mode === 'stars') {
            const sa = (a.stars || []).length;
            const sb = (b.stars || []).length;
            if (sa !== sb) return sb - sa;
        }

        return nameA.localeCompare(nameB);
    },

    hasAvailability(emp) {
        if (!emp || typeof emp !== 'object') return false;
        const availability = emp.availability || {};
        return Object.values(availability).some(day => Array.isArray(day) && day.length > 0);
    },

    getAvailabilitySummary(emp) {
        const daysWithRules = Object.values(emp.availability || {}).filter(day => Array.isArray(day) && day.length > 0).length;
        const exceptionsCount = (emp.exceptions || []).length;

        if (daysWithRules === 0 && exceptionsCount === 0) return "Sin restricciones cargadas";

        const parts = [];
        if (daysWithRules > 0) parts.push(`${daysWithRules} día${daysWithRules === 1 ? '' : 's'} con disponibilidad`);
        if (exceptionsCount > 0) parts.push(`${exceptionsCount} excepción${exceptionsCount === 1 ? '' : 'es'}`);
        return parts.join(" · ");
    },

    getSelectedExportFields() {
        return Array.from(document.querySelectorAll('.export-field input[type="checkbox"]'))
            .filter(cb => cb.checked)
            .map(cb => cb.value)
            .filter(Boolean);
    },

    toggleExportFields(checked) {
        document.querySelectorAll('.export-field input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
    },

    exportSelected(format = 'excel') {
        const selectedFields = this.getSelectedExportFields();
        if (!selectedFields.length) {
            alert('Seleccioná al menos un dato para exportar.');
            return;
        }

        const employees = Array.isArray(store.getState().employees) ? store.getState().employees : [];
        if (!employees.length) {
            alert('No hay empleados para exportar.');
            return;
        }

        const rows = employees.map(emp => this.buildExportRow(emp, selectedFields));
        if (format === 'pdf') this.exportToPdf(rows);
        else this.exportToExcel(rows);
    },

    buildExportRow(emp, fields) {
        const row = {};
        fields.forEach(f => {
            const config = EXPORT_FIELD_CONFIG[f];
            if (config) row[config.label] = config.getter(emp, this);
        });
        return row;
    },

    exportToExcel(rows) {
        if (!rows.length || typeof XLSX === 'undefined') return;
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Empleados");
        XLSX.writeFile(workbook, 'empleados.xlsx');
    },

    exportToPdf(rows) {
        if (!rows.length) return;
        const jspdfLib = window.jspdf;
        if (!jspdfLib || !jspdfLib.jsPDF) {
            alert('No se pudo cargar el exportador PDF.');
            return;
        }
        const { jsPDF } = jspdfLib;
        const doc = new jsPDF({ orientation: 'landscape' });
        let y = 16;

        doc.setFontSize(16);
        doc.text('Empleados', 10, y);
        y += 6;
        doc.setFontSize(11);

        rows.forEach((row, idx) => {
            if (y > 190) { doc.addPage(); y = 16; }
            const name = row['Nombre completo'] || 'Sin nombre';
            doc.text(name, 10, y);
            y += 6;

            Object.entries(row).forEach(([label, value]) => {
                if (label === 'Nombre completo') return;
                const line = `${label}: ${value || '-'}`;
                const wrapped = doc.splitTextToSize(line, 270);
                wrapped.forEach(part => {
                    doc.text(part, 10, y);
                    y += 5;
                });
            });

            if (idx < rows.length - 1) {
                doc.setDrawColor(200);
                doc.line(10, y, 280, y);
                y += 6;
            }
        });

        doc.save('empleados.pdf');
    },

    priorityLabel(value) {
        const labels = {
            'very-high': 'Muy alta',
            'high': 'Alta',
            'medium': 'Media',
            'low': 'Baja',
            'very-low': 'Muy baja'
        };
        return labels[value] || 'Sin prioridad';
    },

    updateStats(allEmployees, filteredEmployees) {
        const setText = (selector, value) => {
            const elRef = el(selector);
            if (elRef) elRef.textContent = value;
        };

        const total = allEmployees.length;
        const allStars = allEmployees.filter(e => e.isAllStar).length;
        const minors = allEmployees.filter(e => e.isMinor).length;
        const withAvailability = allEmployees.filter(e => this.hasAvailability(e)).length;
        const withSanctions = allEmployees.filter(e => (e.sanctions || []).length > 0).length;

        setText("#stat-total-employees", total);
        setText("#stat-all-stars", allStars);
        setText("#stat-minors", minors);
        setText("#stat-availability", withAvailability);
        setText("#stat-sanctions", withSanctions);
        setText("#stat-filtered-employees", `Mostrando ${filteredEmployees.length} de ${total}`);
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
    }
};
