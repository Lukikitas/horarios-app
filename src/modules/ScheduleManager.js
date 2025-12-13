import { el, create, clear } from '../utils/dom.js';
import { store, getActiveSchedule, historyManager } from '../store/Store.js';
import { DataManager } from '../services/DataManager.js';
import { SLOTS, ROLES, DAYS, MAX_SLOT_FOR_MINOR } from '../config.js';
import {
    timeToSlotIndex,
    checkRestTime,
    checkShiftOverlap,
    checkEmployeeAvailability,
    isDateInSanctionPeriod,
    calculateConsecutiveWorkDays,
    isSlotUnavailable
} from '../utils/rules.js';
import { getMonday, toISODateString } from '../utils/date.js';
import { EmployeeManager } from './EmployeeManager.js';

export const ScheduleManager = {
    init() {
        this.bindEvents();
    },

    bindEvents() {
        el("#activeRole")?.addEventListener("change", () => this.renderTable());
        el("#formStart")?.addEventListener("change", () => this.updateShiftDuration());
        el("#formEnd")?.addEventListener("change", () => this.updateShiftDuration());
        el("#btnAddUnassignedShift")?.addEventListener("click", () => this.addUnassignedShift());
        el("#btnUndo")?.addEventListener("click", () => this.undoLastAction());

        el("#weekSelector")?.addEventListener("change", (e) => this.changeWeek(e.target.value));
        el("#btn-prev-week")?.addEventListener("click", () => this.changeWeek(-7));
        el("#btn-next-week")?.addEventListener("click", () => this.changeWeek(7));
        el("#btn-lock-week")?.addEventListener("click", () => this.toggleWeekLock());

        // Auto Assign
        el("#btn-auto-assign")?.addEventListener("click", () => {
            this.autoAssignShifts();
            el("#actions-dropdown")?.classList.remove('show');
        });


        // Projected tickets persistence per day
        el("#projectedTickets")?.addEventListener("change", (e) => {
            const val = e.target.value;
            const { activeWeek, activeDay, projectedTickets } = store.getState();
            const weekData = projectedTickets[activeWeek] || {};
            weekData[activeDay] = val;

            const newProjectedTickets = {
                ...projectedTickets,
                [activeWeek]: weekData
            };
            store.setState({ projectedTickets: newProjectedTickets });
            DataManager.saveState();
            this.updateProjectedProductivity();
            this.renderWeeklyStats(); // Update header stats
        });

        // Painting listeners
        window.addEventListener("mouseup", () => {
            if (this.isPainting) this.handlePaintEnd();
            if (this.isUnpainting) this.handleUnpaintEnd(this.lastEnteredSlot);
        });

        // Init selects
        this.optionize(el("#activeRole"), ROLES, r=>({value:r.key,label:r.key}));
        this.optionize(el("#formStart"), SLOTS, s=>({value:s.index,label:s.label}));
        this.optionize(el("#formEnd"),   SLOTS, s=>({value:s.index,label:s.label}));

        this.updateShiftDuration();

        // Print Listeners
        el("#btn-print-schedule-list")?.addEventListener("click", () => { this.printSchedule(); el("#print-modal").style.display="none"; });
        el("#btn-print-daily-planning")?.addEventListener("click", () => { this.printDailyPlanning(); el("#print-modal").style.display="none"; });
        el("#btnPrint")?.addEventListener("click", () => el("#print-modal").style.display="flex");
        el("#print-modal-close")?.addEventListener("click", () => el("#print-modal").style.display="none");

        // Schedule List Listeners
        el("#schedule-list-search")?.addEventListener("input", (e) => {
            store.setState({ scheduleSearchTerm: e.target.value });
            this.renderScheduleList();
        });

        // Calendar Modal
        el("#week-display")?.addEventListener("click", () => {
            this.calendarDate = new Date(store.getState().activeWeek + "T12:00:00Z");
            this.renderCalendar();
            el("#calendar-modal").style.display = "flex";
        });
        el("#calendar-prev-month")?.addEventListener("click", () => {
            this.calendarDate.setMonth(this.calendarDate.getMonth() - 1);
            this.renderCalendar();
        });
        el("#calendar-next-month")?.addEventListener("click", () => {
            this.calendarDate.setMonth(this.calendarDate.getMonth() + 1);
            this.renderCalendar();
        });
        el("#calendar-modal")?.addEventListener("click", (e) => {
            if (e.target === el("#calendar-modal")) el("#calendar-modal").style.display = "none";
        });

        // Templates
        el("#btnSaveTemplate")?.addEventListener("click", () => this.saveCurrentDayAsTemplate());
    },

    calendarDate: new Date(),

    renderCalendar() {
        const grid = el("#calendar-grid");
        const title = el("#calendar-month-year");
        if (!grid || !title) return;

        clear(grid);
        const month = this.calendarDate.getMonth();
        const year = this.calendarDate.getFullYear();
        title.textContent = `${new Date(year, month).toLocaleString('es-ES', { month: 'long' })} ${year}`;

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDay = (firstDay.getDay() + 6) % 7; // Monday = 0
        const totalDays = lastDay.getDate();

        ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].forEach(d => {
            grid.appendChild(create("div", { className: "day-name", textContent: d }));
        });

        for (let i = 0; i < startDay; i++) {
            grid.appendChild(create("div"));
        }

        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(year, month, day);
            const isMonday = date.getDay() === 1;
            const classes = "day" + (isMonday ? " monday" : "");

            const dayEl = create("div", { className: classes, textContent: day });

            if (isMonday) {
                if (toISODateString(date) === store.getState().activeWeek) {
                    dayEl.classList.add("selected");
                }
                dayEl.addEventListener("click", () => {
                    const newWeek = toISODateString(date);
                    DataManager.loadWeek(newWeek);
                    el("#calendar-modal").style.display = "none";
                });
            }
            grid.appendChild(dayEl);
        }
    },

    optionize(select, items, map=(x)=>({value:x, label:x}), includeBlank){
        if(!select) return;
        select.innerHTML = "";
        if(includeBlank){
            const o = document.createElement("option"); o.value=""; o.textContent=includeBlank; select.appendChild(o);
        }
        for(const it of items){
            const {value,label} = map(it);
            const o = document.createElement("option");
            o.value = value; o.textContent = label;
            select.appendChild(o);
        }
    },

    updateShiftDuration() {
        const start = Number(el("#formStart").value);
        const end = Number(el("#formEnd").value);
        const shiftDuration = el("#shiftDuration");
        if(shiftDuration) {
            if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
                const duration = (end - start) * 0.5;
                shiftDuration.textContent = `(${String(duration).replace('.', ',')}hs)`;
            } else {
                shiftDuration.textContent = "";
            }
        }
    },

    render() {
        this.renderDayTabs();
        this.renderTable();
        this.renderLegend();
        this.updateLockUI();
        this.updateWeekDisplay();
        this.renderWeeklyStats();

        // Ensure this method exists before calling
        if (typeof this.renderTemplateList === 'function') {
            this.renderTemplateList();
        } else {
            console.error("ScheduleManager: renderTemplateList is missing!");
        }

        if (store.getState().activeView === 'schedule-list') {
            this.renderScheduleList();
        }
    },

    // --- Template Logic ---

    renderTemplateList() {
        const list = el("#templateList");
        if (!list) return;

        clear(list);
        const templates = store.getState().templates || {};

        if (Object.keys(templates).length === 0) {
            list.appendChild(create("div", { className: "muted", style: { padding: "10px", textAlign: "center" }, textContent: "No hay plantillas guardadas." }));
            return;
        }

        Object.entries(templates).forEach(([name, template]) => {
            const item = create("div", { className: "template-item" });
            const info = create("div", { style: { flex: 1 } });
            info.appendChild(create("div", { style: { fontWeight: "600" }, textContent: name }));
            if (template.description) {
                info.appendChild(create("div", { className: "muted", style: { fontSize: "12px" }, textContent: template.description }));
            }
            item.appendChild(info);

            const actions = create("div", { style: { display: "flex", gap: "5px" } });
            actions.appendChild(create("button", {
                className: "btn small", textContent: "Aplicar",
                onClick: () => { if(confirm(`¿Aplicar plantilla "${name}"? Esto sobrescribirá el día actual.`)) this.applyTemplate(name); }
            }));
            actions.appendChild(create("button", {
                className: "btn small secondary del", innerHTML: "&times;",
                onClick: () => { if(confirm(`¿Eliminar plantilla "${name}"?`)) this.deleteTemplate(name); }
            }));

            item.appendChild(actions);
            list.appendChild(item);
        });
    },

    saveCurrentDayAsTemplate() {
        const nameInp = el("#inpTemplateName");
        const descInp = el("#inpTemplateDesc");
        if (!nameInp) return;

        const name = nameInp.value.trim();
        const description = descInp ? descInp.value.trim() : "";

        if (!name) { alert("Ingresa un nombre para la plantilla."); return; }

        const state = store.getState();
        if (state.templates && state.templates[name]) {
            if (!confirm(`La plantilla "${name}" ya existe. ¿Sobrescribirla?`)) return;
        }

        const schedule = getActiveSchedule();
        const dayShifts = schedule[state.activeDay] || [];

        const templateShifts = dayShifts.map(s => ({ ...s }));

        const newTemplates = {
            ...state.templates,
            [name]: {
                description,
                shifts: templateShifts
            }
        };

        store.setState({ templates: newTemplates });
        DataManager.saveState();

        nameInp.value = "";
        if(descInp) descInp.value = "";
        this.renderTemplateList();
        alert("Plantilla guardada.");
    },

    applyTemplate(name) {
        const state = store.getState();
        const template = state.templates[name];
        if (!template) return;

        const day = state.activeDay;
        this.ensureDay(day);

        // Create new shifts with new IDs
        const newShifts = template.shifts.map(s => ({
            ...s,
            id: crypto.randomUUID(),
        }));

        this.commitChange(() => {
            getActiveSchedule()[day] = newShifts;
        });
    },

    deleteTemplate(name) {
        const state = store.getState();
        const newTemplates = { ...state.templates };
        delete newTemplates[name];

        store.setState({ templates: newTemplates });
        DataManager.saveState();
        this.renderTemplateList();
    },

    renderTable() {
        const state = store.getState();
        const tbody = el("#tbody");
        if (!tbody) return;

        clear(tbody);
        this.renderHead();

        this.updateProjectedProductivity();
        this.updateActiveDayHoursDisplay();
        this.updateDayTitle();

        const day = state.activeDay;
        this.ensureDay(day);
        const schedule = getActiveSchedule();
        if (!schedule) return;

        const allShifts = schedule[day] || [];

        // Filtering
        const searchTerm = (state.scheduleSearchTerm || '').toLowerCase().trim();
        const roleFilters = state.scheduleRoleFilters || [];
        const hasSearch = searchTerm.length > 0;
        const hasRoleFilter = roleFilters.length > 0;
        const hasFilters = hasSearch || hasRoleFilter;

        let filteredShifts = allShifts;

        if (hasRoleFilter) {
            filteredShifts = filteredShifts.filter(shift => roleFilters.includes(shift.role));
        }

        if (hasSearch) {
            const matchingEmployeeIds = state.employees
                .filter(emp => emp.name.toLowerCase().includes(searchTerm))
                .map(emp => emp.id);

            filteredShifts = filteredShifts.filter(shift => {
                if (shift.employeeId) {
                    return matchingEmployeeIds.includes(shift.employeeId);
                }
                return shift.role.toLowerCase().includes(searchTerm) || "sin asignar".includes(searchTerm);
            });
        }

        // No shifts message
        if (allShifts.length === 0) {
            tbody.appendChild(create("div", {
                style: { padding: "20px", textAlign: "center" },
                className: "muted",
                textContent: "No hay turnos creados para este día. Créalos desde el formulario de arriba."
            }));
            return;
        }

        if (filteredShifts.length === 0 && hasFilters) {
             tbody.appendChild(create("div", {
                style: { padding: "20px", textAlign: "center" },
                className: "muted",
                textContent: "No se encontraron turnos que coincidan con los filtros."
            }));
            return;
        }

        const shiftsByRole = filteredShifts.reduce((acc, shift) => {
            if (!acc[shift.role]) acc[shift.role] = [];
            acc[shift.role].push(shift);
            return acc;
        }, {});

        const sortedRoles = Object.keys(shiftsByRole).sort();

        sortedRoles.forEach(role => {
            const roleShifts = shiftsByRole[role];
            roleShifts.sort((a, b) => a.startSlot - b.startSlot);

            roleShifts.forEach((shift, index) => {
                const cols = `240px repeat(${SLOTS.length}, 1fr)`;
                const row = create("div", {
                    className: "rowg",
                    style: { gridTemplateColumns: cols, borderBottom: "1px solid var(--border)" },
                    dataset: { shiftId: shift.id }
                });
                if (index === 0) row.style.borderTop = "2px solid #d1d5db";

                // Name Column
                const namecol = create("div", {
                    className: "namecol",
                    style: { flexDirection: "column", alignItems: "flex-start", justifyContent: "center", position: "relative" }
                });

                const detailsDiv = create("div");
                detailsDiv.appendChild(create("div", { style: { fontWeight: "600" }, textContent: shift.role }));

                const startTime = SLOTS[shift.startSlot].label;
                const endTime = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";
                const duration = (shift.endSlot - shift.startSlot + 1) * 0.5;
                detailsDiv.appendChild(create("div", { className: "muted", style: { fontSize: "12px" }, textContent: `${startTime} - ${endTime} (${String(duration).replace('.',',')}hs)` }));

                const assignWrapper = create("div", { className: "row", style: { marginTop: "4px" } });

                if (shift.employeeId) {
                    const emp = state.employees.find(e => e.id === shift.employeeId);
                    const empNameSpan = create("span");
                    if (emp) {
                        let nameHtml = this.escapeHtml(emp.name);
                        if (shift.replacement && shift.replacement.originalEmployeeId) {
                            const originalEmp = state.employees.find(e => e.id === shift.replacement.originalEmployeeId);
                            if (originalEmp) {
                                nameHtml = `${this.escapeHtml(emp.name)} <span class="muted" style="font-style: italic;">(cubre a ${this.escapeHtml(originalEmp.name)})</span>`;
                            }
                        }
                        const weeklyHours = this.getEmployeeWeeklyHours(emp.id);
                        empNameSpan.innerHTML = nameHtml + ` (${String(weeklyHours).replace('.', ',')}hs)`;
                    } else {
                        empNameSpan.textContent = "Empleado no encontrado";
                    }

                    const unassignBtn = create("button", {
                        className: "btn secondary del", innerHTML: "&times;",
                        style: { padding: "0px 4px", fontSize: "10px", lineHeight: "1", marginLeft: "8px" },
                        title: "Des-asignar empleado",
                        onClick: () => this.commitChange(() => {
                            if (shift.replacement && shift.replacement.originalEmployeeId) {
                                shift.employeeId = shift.replacement.originalEmployeeId;
                                delete shift.replacement;
                            } else {
                                shift.employeeId = null;
                            }
                        })
                    });

                    assignWrapper.appendChild(empNameSpan);
                    assignWrapper.appendChild(unassignBtn);
                } else {
                    assignWrapper.appendChild(create("button", {
                        className: "btn secondary", textContent: "Asignar",
                        style: { padding: "2px 8px" },
                        onClick: () => this.openAssignEmployeeModal(shift.id)
                    }));
                }

                detailsDiv.appendChild(assignWrapper);
                namecol.appendChild(detailsDiv);

                // Actions Div
                const actionsDiv = create("div", { className: "row", style: { position: "absolute", top: "5px", right: "5px" } });
                actionsDiv.appendChild(create("button", {
                    className: "btn secondary", innerHTML: "&#9998;",
                    style: { padding: "2px 6px", fontSize: "10px" }, title: "Editar turno",
                    onClick: (e) => { e.stopPropagation(); this.openEditShiftModal(shift.id); }
                }));
                actionsDiv.appendChild(create("button", {
                    className: "btn secondary del", innerHTML: "&times;",
                    style: { padding: "2px 6px", fontSize: "10px" }, title: "Eliminar turno",
                    onClick: (e) => { e.stopPropagation(); if(confirm("¿Eliminar este turno?")) this.deleteShift(shift.id); }
                }));
                namecol.appendChild(actionsDiv);
                row.appendChild(namecol);

                // Slots
                const emp = shift.employeeId ? state.employees.find(e => e.id === shift.employeeId) : null;
                const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
                const shiftDate = new Date(weekMonday);
                shiftDate.setUTCDate(weekMonday.getUTCDate() + day);

                // Sanction check using the imported util
                const isInConflict = emp && isDateInSanctionPeriod(shiftDate, emp.sanctions) && !shift.replacement;

                for (let i = 0; i < SLOTS.length; i++) {
                    const cell = create("div", { className: "slot", onClick: () => this.handleSlotClick(shift, i) });

                    // Check availability for every slot
                    if (shift.employeeId && emp && isSlotUnavailable(emp, i, state.activeWeek, day)) {
                        cell.classList.add("unavailable-slot");
                    }

                    if (i >= shift.startSlot && i <= shift.endSlot) {
                        const roleData = ROLES.find(r => r.key === shift.role);
                        cell.classList.add("assigned");
                        if(roleData) cell.classList.add(EmployeeManager.clsFor(roleData.key)); // Reusing clsFor
                        if(roleData && roleData.darkText) cell.classList.add("sandwich");

                        if (!shift.employeeId) cell.classList.add("unassigned");
                        else if (isInConflict) cell.style.boxShadow = `inset 0 0 0 2px var(--c-danger)`;

                        cell.addEventListener("mousedown", () => this.handleUnpaintStart(shift.id, i));
                        cell.addEventListener("mouseenter", () => this.handlePaintEnter(i));
                        // mouseup handled globally
                    }
                    row.appendChild(cell);
                }
                tbody.appendChild(row);
            });

            // Add Shift Button
            if (!hasFilters) {
                const addRow = create("div", { className: "add-shift-button-row" });
                const addBtn = create("button", {
                    className: "add-shift-btn " + EmployeeManager.clsFor(role),
                    textContent: "+", title: `Añadir un nuevo turno de ${role}`,
                    onClick: (e) => this.handleAddShiftClick(role, e)
                });
                addRow.appendChild(addBtn);
                tbody.appendChild(addRow);
            }
        });
    },

    renderHead() {
        const state = store.getState();
        const thead = el("#thead");
        if(!thead) return;

        const headcount = this.calculateHeadcountPerSlot(state.activeDay);
        const headcountByRole = this.calculateHeadcountByRolePerSlot(state.activeDay);
        const totalDayHours = this.calculateTotalDayHours(state.activeDay);

        const cols = `240px repeat(${SLOTS.length}, 1fr)`;
        const g = create("div", { className: "rowg", style: { gridTemplateColumns: cols } });

        const name = create("div", {
            className: "namecol",
            innerHTML: `<div style="line-height:1.2"><span class="muted" style="font-size:12px">Turno</span><br><span style="font-size:11px;font-weight:600;color:#374151">Total: ${String(totalDayHours).replace('.',',')}hs</span></div>`
        });
        g.appendChild(name);

        SLOTS.forEach((s, idx) => {
            const c = create("div", {
                className: "slot-h",
                style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2px" }
            });

            const count = headcount[idx].total;
            c.appendChild(create("span", { style: { fontWeight: "bold", fontSize: "12px" }, textContent: count > 0 ? count : "" }));

            const allStarCount = headcount[idx].allStars;
            if (allStarCount > 0) {
                const as = create("div", { className: "all-star-indicator" });
                as.innerHTML = `★ <span class="all-star-count">${allStarCount > 1 ? allStarCount : ''}</span>`;
                c.appendChild(as);
            }

            c.appendChild(create("span", { textContent: s.label }));

            if (count > 0) {
                c.title = Object.entries(headcountByRole[idx])
                    .map(([role, num]) => `${num} ${role}`)
                    .join('\n');
            }
            g.appendChild(c);
        });

        clear(thead);
        thead.appendChild(g);
    },

    // --- State/Logic Helpers ---

    ensureDay(d) {
        const schedule = getActiveSchedule();
        if(!schedule) return;
        schedule[d] = schedule[d] || [];
    },

    commitChange(action) {
        const currentSchedule = getActiveSchedule();
        historyManager.push(currentSchedule);
        action();

        const btnUndo = el("#btnUndo");
        if(btnUndo) btnUndo.disabled = !historyManager.canUndo();

        DataManager.saveState();
        this.render();
    },

    undoLastAction() {
        const state = store.getState();
        if (historyManager.canUndo()) {
            const lastState = historyManager.pop();
            store.setState({
                schedules: {
                    ...state.schedules,
                    [state.activeWeek]: lastState
                }
            });
            DataManager.saveState();
            this.render();
        }
        const btnUndo = el("#btnUndo");
        if(btnUndo) btnUndo.disabled = !historyManager.canUndo();
    },

    deleteShift(shiftId) {
        const state = store.getState();
        const day = state.activeDay;
        const schedule = getActiveSchedule();
        this.ensureDay(day);
        const index = schedule[day].findIndex(s => s.id === shiftId);
        if (index > -1) {
            this.commitChange(() => {
                schedule[day].splice(index, 1);
            });
        }
    },

    addUnassignedShift() {
        const role = el("#activeRole").value;
        const startSlot = Number(el("#formStart").value);
        const endSlot = Number(el("#formEnd").value);
        if(Number.isNaN(startSlot) || Number.isNaN(endSlot) || endSlot <= startSlot) {
            alert("La hora de fin debe ser posterior a la hora de inicio.");
            return;
        }

        const newShift = {
            id: crypto.randomUUID(),
            role: role,
            startSlot: startSlot,
            endSlot: endSlot - 1,
            employeeId: null
        };

        const state = store.getState();
        const day = state.activeDay;
        this.ensureDay(day);
        this.commitChange(() => {
            getActiveSchedule()[day].push(newShift);
        });
    },

    printSchedule() {
        const schedule = getActiveSchedule();
        const employees = store.getState().employees
            .filter(emp => this.getEmployeeWeeklyHours(emp.id) > 0)
            .sort((a,b) => a.name.localeCompare(b.name));

        const monday = new Date(store.getState().activeWeek + "T12:00:00Z");
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const formatDate = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

        let tableRows = '';
        employees.forEach(emp => {
            let row = `<tr><td>${this.escapeHtml(emp.name)}</td>`;
            for (let i = 0; i < 7; i++) {
                const dayShifts = (schedule[i] || []).filter(s => s.employeeId === emp.id);
                if (dayShifts.length > 0) {
                    const shift = dayShifts[0];
                    const startTime = SLOTS[shift.startSlot].label;
                    const endTime = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";
                    row += `<td>${startTime} - ${endTime}</td>`;
                } else {
                    row += `<td>Descanso</td>`;
                }
            }
            row += '</tr>';
            tableRows += row;
        });

        const w = window.open('', '', 'height=800,width=1200');
        w.document.write(`<html><head><title>Horarios</title><style>body{font-family:sans-serif;font-size:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px;text-align:center}th{background:#f2f2f2}@media print{body{margin:0.5in}}</style></head><body><h2>KFC LA PLATA - Semana ${formatDate(monday)} al ${formatDate(sunday)}</h2><table><thead><tr><th>Nombre</th>${DAYS.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table><script>setTimeout(()=>{window.print();window.close()},500)</script></body></html>`);
        w.document.close();
    },

    printDailyPlanning() {
        const schedule = getActiveSchedule();
        const state = store.getState();
        const employees = state.employees;
        const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
        const weekTickets = state.projectedTickets[state.activeWeek] || {};
        let pagesHtml = '';

        const getEmployeeColor = (id) => {
            let hash = 0;
            for (let c = 0; c < id.length; c++) {
                hash = ((hash << 5) - hash) + id.charCodeAt(c);
                hash |= 0;
            }
            const hue = Math.abs(hash) % 360;
            return `hsl(${hue}, 70%, 85%)`;
        };

        for (let i = 0; i < 7; i++) {
            const dayShifts = (schedule[i] || []).filter(s => s.employeeId);
            if (dayShifts.length === 0) continue;

            const dayDate = new Date(weekMonday);
            dayDate.setDate(weekMonday.getDate() + i);
            const dayName = DAYS[i];
            const formattedDate = `${dayName} ${dayDate.getDate()}/${dayDate.getMonth()+1}`;

            const headcounts = Array(SLOTS.length).fill(0);
            dayShifts.forEach(shift => {
                for (let slot = shift.startSlot; slot <= shift.endSlot; slot++) {
                    headcounts[slot] += 1;
                }
            });

            const tickets = Number(weekTickets[i] || 0);
            const totalHours = this.calculateTotalDayHours(i);
            const productivity = (tickets > 0 && totalHours > 0) ? (tickets / totalHours).toFixed(1) : "-";
            const statsLabel = `Tickets: ${tickets || '-'} | Horas: ${totalHours ? String(totalHours).replace('.', ',') : '-'} | Prod: ${productivity}`;

            let tableRows = '';
            dayShifts.sort((a, b) => a.startSlot - b.startSlot).forEach(shift => {
                const emp = employees.find(e => e.id === shift.employeeId);
                if (!emp) return;
                const shiftHours = (shift.endSlot - shift.startSlot + 1) * 0.5;
                const start = SLOTS[shift.startSlot].label;
                const end = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";
                const color = getEmployeeColor(emp.id || emp.name || "");

                let timeline = '';
                for(let j=0; j<SLOTS.length; j++) {
                    const inShift = j >= shift.startSlot && j <= shift.endSlot;
                    const cellStyle = inShift ? `background:${color};border:1px solid rgba(0,0,0,0.05);` : '';
                    timeline += `<td style="${cellStyle}">${inShift ? '&nbsp;' : ''}</td>`;
                }
                tableRows += `<tr><td>${this.escapeHtml(emp.name)}<br>${start}-${end}</td><td>${this.escapeHtml(shift.role)}</td><td>${String(shiftHours).replace('.',',')}</td>${timeline}</tr>`;
            });

            // Header
            const headcountRow = `<tr class="slot-headcount"><th colspan="3" style="text-align:left;font-weight:600;color:#444">En turno</th>${headcounts.map(c => `<th>${c || ''}</th>`).join('')}</tr>`;
            let timelineHeader = '';
            SLOTS.forEach(slot => timelineHeader += `<th>${slot.label.split(':')[0]}</th>`);

            pagesHtml += `<div class="page" style="page-break-after:always; margin-bottom: 20px;"><div style="display:flex;align-items:baseline;gap:10px;justify-content:space-between;"><h3 style="margin:4px 0">${formattedDate}</h3><span style="font-size:11px;color:#555">${statsLabel}</span></div><table style="width:100%;border-collapse:collapse;font-size:9px"><thead>${headcountRow}<tr><th>Empleado</th><th>Pos</th><th>Hs</th>${timelineHeader}</tr></thead><tbody>${tableRows}</tbody></table></div>`;
        }

        const w = window.open('', '', 'height=800,width=1200');
        w.document.write(`<html><head><title>Planning</title><style>body{font-family:sans-serif}table,th,td{border:1px solid #999;padding:2px;text-align:center}th{background:#f6f6f6} .slot-headcount th{background:#eef3fb;font-size:8px;color:#333}@media print{@page{size:landscape}}</style></head><body>${pagesHtml}<script>setTimeout(()=>{window.print();window.close()},500)</script></body></html>`);
        w.document.close();
    },

    // --- Calculations ---
    calculateHeadcountPerSlot(day) {
        const headcount = SLOTS.map(() => ({ total: 0, allStars: 0 }));
        const schedule = getActiveSchedule();
        const dayShifts = schedule[day] || [];
        const state = store.getState();

        for (const shift of dayShifts) {
            const emp = shift.employeeId ? state.employees.find(e => e.id === shift.employeeId) : null;
            const isAllStar = emp ? emp.isAllStar : false;

            for (let i = shift.startSlot; i <= shift.endSlot; i++) {
                headcount[i].total++;
                if (isAllStar) {
                    headcount[i].allStars++;
                }
            }
        }
        return headcount;
    },

    calculateHeadcountByRolePerSlot(day) {
        const headcountByRole = SLOTS.map(() => ({}));
        const schedule = getActiveSchedule();
        const dayShifts = schedule[day] || [];

        for (const shift of dayShifts) {
            for (let i = shift.startSlot; i <= shift.endSlot; i++) {
                if (!headcountByRole[i][shift.role]) {
                    headcountByRole[i][shift.role] = 0;
                }
                headcountByRole[i][shift.role]++;
            }
        }
        return headcountByRole;
    },

    calculateTotalDayHours(day) {
        let totalSlots = 0;
        const schedule = getActiveSchedule();
        if (!schedule) return 0;
        const dayShifts = schedule[day] || [];
        for (const shift of dayShifts) {
            totalSlots += (shift.endSlot - shift.startSlot + 1);
        }
        return totalSlots * 0.5;
    },

    getEmployeeAssignmentsSummary(employeeId) {
        const schedule = getActiveSchedule();
        const summaries = [];

        Object.entries(schedule || {}).forEach(([dayIndex, dayShifts]) => {
            if (!Array.isArray(dayShifts)) return;
            dayShifts
                .filter(shift => shift.employeeId === employeeId)
                .forEach(shift => {
                    const start = SLOTS[shift.startSlot]?.label || "--:--";
                    const end = SLOTS[Math.min(shift.endSlot + 1, SLOTS.length - 1)]?.label || start;
                    const roleAbbr = this.getRoleAbbreviation(shift.role);
                    const dayAbbr = DAYS[Number(dayIndex)]?.slice(0, 2) || "";
                    summaries.push(`${dayAbbr} ${start}-${end} ${roleAbbr}`.trim());
                });
        });

        return summaries;
    },

    getRoleAbbreviation(role) {
        if (!role) return "";
        const parts = role.split(/\s+/).filter(Boolean);
        if (parts.length > 1) {
            return parts.map(p => p[0]).join("").slice(0, 3);
        }
        return role.slice(0, 3);
    },

    getEmployeeWeeklyHours(employeeId) {
        let totalSlots = 0;
        const schedule = getActiveSchedule();
        for (const day in schedule) {
            const dayShifts = schedule[day] || [];
            if (Array.isArray(dayShifts)) {
                for (const shift of dayShifts) {
                    if (shift.employeeId === employeeId) {
                        totalSlots += (shift.endSlot - shift.startSlot + 1);
                    }
                }
            }
        }
        return totalSlots * 0.5;
    },

    // --- Painting Logic ---
    isPainting: false,
    paintStartSlot: -1,
    lastEnteredSlot: -1,
    isUnpainting: false,
    unpaintShiftId: null,
    unpaintStartSlot: -1,

    handlePaintStart(slotIndex) {
        this.isPainting = true;
        this.paintStartSlot = slotIndex;
        this.lastEnteredSlot = slotIndex;
        const newShiftRow = el(".new-shift-row");
        if(newShiftRow) {
            const cell = newShiftRow.querySelector(`[data-slot-index='${slotIndex}']`);
            if(cell) cell.style.background = ROLES.find(r => r.key === el("#activeRole").value)?.color || '#ccc';
        }
    },

    handlePaintEnter(slotIndex) {
        if (this.isPainting) {
            this.lastEnteredSlot = slotIndex;
            const newShiftRow = el(".new-shift-row");
            if(newShiftRow) {
                const cells = newShiftRow.querySelectorAll('.slot');
                cells.forEach(c => c.style.background = "");
                const [start, end] = [Math.min(this.paintStartSlot, slotIndex), Math.max(this.paintStartSlot, slotIndex)];
                const roleColor = ROLES.find(r => r.key === el("#activeRole").value)?.color || '#ccc';
                for (let i = start; i <= end; i++) {
                    const cell = newShiftRow.querySelector(`[data-slot-index='${i}']`);
                    if (cell) cell.style.background = roleColor;
                }
            }
        } else if (this.isUnpainting) {
            this.lastEnteredSlot = slotIndex;
        }
    },

    handlePaintEnd() {
        if (!this.isPainting) return;
        const [start, end] = [Math.min(this.paintStartSlot, this.lastEnteredSlot), Math.max(this.paintStartSlot, this.lastEnteredSlot)];
        this.isPainting = false;

        if (start < 0 || end < 0 || start === end) return;

        const newShift = {
            id: crypto.randomUUID(),
            role: el("#activeRole").value,
            startSlot: start,
            endSlot: end,
            employeeId: null
        };

        const state = store.getState();
        const day = state.activeDay;
        this.ensureDay(day);
        this.commitChange(() => {
            getActiveSchedule()[day].push(newShift);
        });
    },

    handleUnpaintStart(shiftId, slotIndex) {
        this.isUnpainting = true;
        this.unpaintShiftId = shiftId;
        this.unpaintStartSlot = slotIndex;
        this.lastEnteredSlot = slotIndex;
    },

    handleUnpaintEnd(endSlotIndex) {
        if (!this.isUnpainting) return;

        const state = store.getState();
        const day = state.activeDay;
        const schedule = getActiveSchedule();
        const shift = schedule[day]?.find(s => s.id === this.unpaintShiftId);

        if (this.unpaintStartSlot === endSlotIndex || !shift) {
            this.isUnpainting = false;
            this.unpaintShiftId = null;
            return;
        }

        const tempShift = { ...shift };
        let modified = false;

        if (this.unpaintStartSlot === tempShift.startSlot && endSlotIndex > tempShift.startSlot) {
            tempShift.startSlot = endSlotIndex;
            modified = true;
        } else if (this.unpaintStartSlot === tempShift.endSlot && endSlotIndex < tempShift.endSlot) {
            tempShift.endSlot = endSlotIndex;
            modified = true;
        }

        if (modified) {
            shift.startSlot = tempShift.startSlot;
            shift.endSlot = tempShift.endSlot;
            this.commitChange(() => {
                if (shift.startSlot >= shift.endSlot) {
                    const index = schedule[day].findIndex(s => s.id === this.unpaintShiftId);
                    if (index > -1) schedule[day].splice(index, 1);
                }
            });
        } else {
            this.render();
        }

        this.isUnpainting = false;
        this.unpaintShiftId = null;
        this.unpaintStartSlot = -1;
    },

    // --- UI Helpers ---
    escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;" }[c])); },

    // --- Day/Week/UI State ---
    renderDayTabs() {
        const dayTabs = el("#dayTabs");
        if(!dayTabs) return;
        clear(dayTabs);
        const state = store.getState();

        DAYS.forEach((d,idx) => {
            const container = create("div", { className: 'day-tab-item' });
            const b = create("button", {
                className: "pilltab" + (idx === state.activeDay ? " active" : ""),
                textContent: d,
                onClick: () => { store.setState({ activeDay: idx }); this.render(); }
            });

            const hoursSpan = create("span", { className: 'day-tab-hours', dataset: { day: idx } });
            const totalHours = this.calculateTotalDayHours(idx);
            hoursSpan.textContent = totalHours > 0 ? `${String(totalHours).replace('.', ',')}hs` : `-`;

            container.appendChild(b);
            container.appendChild(hoursSpan);
            dayTabs.appendChild(container);
        });
    },

    updateActiveDayHoursDisplay() {
        const dayIndex = store.getState().activeDay;
        const hoursSpan = document.querySelector(`.day-tab-hours[data-day='${dayIndex}']`);
        if (hoursSpan) {
            const totalHours = this.calculateTotalDayHours(dayIndex);
            hoursSpan.textContent = totalHours > 0 ? `${String(totalHours).replace('.', ',')}hs` : `-`;
        }
    },

    updateDayTitle() {
        const { activeDay, activeWeek } = store.getState();
        const dayName = DAYS[activeDay];
        const weekMonday = new Date(activeWeek + "T12:00:00Z");
        const dayDate = new Date(weekMonday);
        dayDate.setDate(weekMonday.getDate() + activeDay);

        const formattedDate = `${dayName}, ${dayDate.getDate()} de ${dayDate.toLocaleString('es-ES', { month: 'long' })}`;
        const dayTitleEl = el("#day-title");
        if (dayTitleEl) dayTitleEl.textContent = formattedDate;
    },

    renderLegend() {
        const cont = el("#legend");
        if(!cont) return;
        clear(cont);
        ROLES.forEach(r => {
            const row = create("div");
            row.appendChild(create("span", { style: { width:"14px", height:"14px", borderRadius:"0", background: r.color } }));
            row.appendChild(create("span", { style: { fontSize:"13px" }, textContent: r.key }));
            cont.appendChild(row);
        });
    },

    updateLockUI() {
        const schedule = getActiveSchedule();
        const isLocked = !!schedule?.isLocked;
        const lockButton = el("#btn-lock-week");
        if(lockButton) {
            lockButton.textContent = isLocked ? "🔒" : "🔓";
            lockButton.title = isLocked ? "Semana bloqueada" : "Semana desbloqueada";
        }

        // Disable controls
        const controls = [
            '#activeRole', '#formStart', '#formEnd', '#btnAddUnassignedShift', '#btnUndo', '#projectedTickets',
            '#inpTemplateName', '#inpTemplateDesc', '#btnSaveTemplate', '#btn-import-text', '#btn-advanced-import-export'
        ];
        controls.forEach(sel => {
            const e = el(sel);
            if(e) e.disabled = isLocked;
        });

        const scheduleTbody = el('#view-schedule #tbody');
        if (scheduleTbody) {
            scheduleTbody.style.pointerEvents = isLocked ? 'none' : 'auto';
            scheduleTbody.style.opacity = isLocked ? 0.7 : 1;
        }

        const scheduleListContent = el('#schedule-list-content');
        if (scheduleListContent) {
            scheduleListContent.querySelectorAll('[draggable="true"]').forEach(el => {
                el.draggable = !isLocked;
            });
        }
    },

    toggleWeekLock() {
        const schedule = getActiveSchedule();
        schedule.isLocked = !schedule.isLocked;
        DataManager.saveState();
        this.render();
    },

    updateProjectedProductivity() {
        const { activeWeek, activeDay, projectedTickets } = store.getState();
        const weekTickets = projectedTickets[activeWeek] || {};
        const tickets = Number(weekTickets[activeDay] || 0);

        // Update input value
        const inp = el("#projectedTickets");
        if (inp) inp.value = tickets || '';

        const totalHours = this.calculateTotalDayHours(activeDay);
        const pp = el("#projectedProductivity");
        if(pp) {
            if (tickets > 0 && totalHours > 0) {
                pp.textContent = (tickets / totalHours).toFixed(1);
            } else {
                pp.textContent = "-";
            }
        }
    },

    updateWeekDisplay() {
        const btn = el("#week-display");
        if (!btn) return;
        const state = store.getState();
        const monday = new Date(state.activeWeek + "T12:00:00Z");
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const format = (d) => `${d.getDate()}/${d.getMonth()+1}`;
        btn.textContent = `${format(monday)} - ${format(sunday)}`;
    },

    renderWeeklyStats() {
        const headerContainer = el(".controls-center");
        if (!headerContainer) return;

        // Check if stats container exists
        let statsContainer = el("#weekly-stats-container");
        if (!statsContainer) {
            statsContainer = create("div", {
                id: "weekly-stats-container",
                style: {
                    display: "flex",
                    gap: "10px",
                    fontSize: "12px",
                    marginBottom: "4px",
                    color: "var(--muted)"
                }
            });
            // Insert before the day title or at the top of controls-center
            headerContainer.insertBefore(statsContainer, headerContainer.firstChild);
        }

        // Calculate stats
        const state = store.getState();
        let totalHours = 0;
        let totalTickets = 0;

        const schedule = getActiveSchedule();
        const weekTickets = state.projectedTickets[state.activeWeek] || {};

        for (let i = 0; i < 7; i++) {
            totalHours += this.calculateTotalDayHours(i);
            totalTickets += Number(weekTickets[i] || 0);
        }

        const productivity = totalHours > 0 ? (totalTickets / totalHours).toFixed(1) : "-";

        clear(statsContainer);

        const leftBox = create("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end" } });
        leftBox.innerHTML = `<div><strong>${String(totalHours).replace('.',',')}hs</strong></div><div>${totalTickets} Tkts</div>`;

        const prodBox = create("div", { style: { display: "flex", alignItems: "center", fontWeight: "bold" } });
        prodBox.textContent = `Prod: ${productivity}`;

        statsContainer.appendChild(leftBox);
        statsContainer.appendChild(prodBox);
    },

    changeWeek(offset) {
        const state = store.getState();
        const currentMonday = new Date(state.activeWeek + "T12:00:00Z");

        if (typeof offset === 'number') {
            currentMonday.setDate(currentMonday.getDate() + offset);
        } else {
            // Assume offset is date string or called from unexpected place
            return;
        }

        const newWeek = toISODateString(getMonday(currentMonday));
        DataManager.loadWeek(newWeek);
    },

    autoAssignShifts() {
        const schedule = getActiveSchedule();
        const state = store.getState();
        let assignedCount = 0;
        let skippedCount = 0;
        const totalUnassigned = [];

        // Collect all unassigned shifts across the week
        for (let day = 0; day < 7; day++) {
            const dayShifts = schedule[day] || [];
            dayShifts.forEach(shift => {
                if (!shift.employeeId) {
                    totalUnassigned.push({ shift, day });
                }
            });
        }

        if (totalUnassigned.length === 0) {
            alert("No hay turnos vacíos para asignar.");
            return;
        }

        if (!confirm(`Se encontraron ${totalUnassigned.length} turnos vacíos.\n\nEl sistema asignará turnos respetando:\n1. Mínimo de 14hs semanales.\n2. Prioridad (Muy Alta > Muy Baja).\n3. Menor carga horaria actual.\n\n¿Continuar?`)) {
            return;
        }

        const PRIORITY_MAP = {
            'very-high': 5,
            'high': 4,
            'medium': 3,
            'low': 2,
            'very-low': 1
        };

        const canEmployeeWorkShiftSafe = (emp, shift, day) => {
             // Logic from canEmployeeWorkShift using our imported utils
             // 1. Sanction
             const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
             const shiftDate = new Date(weekMonday);
             shiftDate.setUTCDate(weekMonday.getUTCDate() + day);

             if (isDateInSanctionPeriod(shiftDate, emp.sanctions)) return false;

             // 2. Minor
             if (emp.isMinor && shift.endSlot > MAX_SLOT_FOR_MINOR) return false;

             // 3. Star
             if (!(emp.stars || []).includes(shift.role)) return false;

             // 4. Availability
             const availCheck = checkEmployeeAvailability(emp, shift, state.activeWeek, day);
             if (!availCheck.isAvailable) return false;

             // 5. Overlap
             const overlapCheck = checkShiftOverlap(emp.id, shift, day);
             if (!overlapCheck.pass) return false;

             // 6. Rest Time
             const restCheck = checkRestTime(emp.id, shift, state.activeWeek, day);
             if (!restCheck.pass) return false;

             // 7. Consecutive Days (soft check - we avoid > 5 in auto assign)
             const consec = calculateConsecutiveWorkDays(emp.id, state.activeWeek, day);
             if (consec > 5) return false;

             return true;
        }

        this.commitChange(() => {
            const processShift = (shift, day, onlyUnder14) => {
                let eligibleCandidates = state.employees.filter(emp => canEmployeeWorkShiftSafe(emp, shift, day));

                if (onlyUnder14) {
                    eligibleCandidates = eligibleCandidates.filter(emp => this.getEmployeeWeeklyHours(emp.id) < 14);
                }

                if (eligibleCandidates.length === 0) return false;

                eligibleCandidates.sort((a, b) => {
                    const pA = PRIORITY_MAP[a.priority || 'medium'];
                    const pB = PRIORITY_MAP[b.priority || 'medium'];
                    if (pA !== pB) return pB - pA; // Higher priority first
                    const hoursA = this.getEmployeeWeeklyHours(a.id);
                    const hoursB = this.getEmployeeWeeklyHours(b.id);
                    return hoursA - hoursB; // Lower hours first
                });

                shift.employeeId = eligibleCandidates[0].id;
                assignedCount++;
                return true;
            };

            for (let day = 0; day < 7; day++) {
                const dayShifts = schedule[day] || [];
                let unassignedInDay = dayShifts.filter(s => !s.employeeId);

                // Pass 1
                unassignedInDay.forEach(shift => {
                   if (shift.employeeId) return;
                   processShift(shift, day, true);
                });

                // Pass 2
                unassignedInDay = dayShifts.filter(s => !s.employeeId);
                unassignedInDay.forEach(shift => {
                    if (!processShift(shift, day, false)) {
                        skippedCount++;
                    }
                });
            }
        });

        alert(`Proceso completado.\n\n- Asignados: ${assignedCount}\n- Sin candidato válido: ${skippedCount}`);
    },


    openAssignEmployeeModal(shiftId) {
        const state = store.getState();
        const day = state.activeDay;
        this.ensureDay(day);
        const schedule = getActiveSchedule();
        const shift = schedule[day].find(s => s.id === shiftId);
        if (!shift) { alert("No se encontró el turno."); return; }

        const wrap = create("div", { style: { position:"fixed", inset:"0", background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", zIndex:1000 }});
        const box = create("div", { className:"card", style:{ maxWidth:"600px", width:"100%" } });

        box.appendChild(create("div", { className:"card-h", innerHTML: `<strong>Asignar empleado a ${shift.role}</strong>` }));

        const c = create("div", { className:"card-c stack" });
        const listContainer = create("div", { className:"assign-employee-list", style: { maxHeight: "400px", overflowY: "auto" } });
        c.appendChild(listContainer);

        const employeesWithStar = state.employees.filter(e => (e.stars || []).includes(shift.role));

        if (employeesWithStar.length === 0) {
            listContainer.textContent = "No hay empleados con la estrella requerida.";
        } else {
            // Logic for sorting and checking warnings
            const available = [];
            const withWarnings = [];
            const unavailable = [];
            const shiftDate = new Date(state.activeWeek + "T12:00:00Z");
            shiftDate.setDate(shiftDate.getDate() + day);

            employeesWithStar.forEach(emp => {
                // Checkers (re-implement or import)
                const isMinor = emp.isMinor;
                const sanctionCheck = isDateInSanctionPeriod(shiftDate, emp.sanctions);

                let hardWarning = "";
                if(sanctionCheck) hardWarning = "Licencia/Sanción activa.";
                else if (isMinor && shift.endSlot > MAX_SLOT_FOR_MINOR) hardWarning = "Menor no puede trabajar tarde.";

                const overlapCheck = checkShiftOverlap(emp.id, shift, day);
                if(!overlapCheck.pass) hardWarning = overlapCheck.message;

                const restCheck = checkRestTime(emp.id, shift, state.activeWeek, day);
                if(!restCheck.pass) hardWarning = restCheck.message;

                // Warnings
                const softWarnings = [];
                const availCheck = checkEmployeeAvailability(emp, shift, state.activeWeek, day);
                if(!availCheck.isAvailable) softWarnings.push(availCheck.reason);

                const consec = calculateConsecutiveWorkDays(emp.id, state.activeWeek, day);
                if(consec > 5) softWarnings.push(`Trabajará ${consec} días seguidos.`);

                if (hardWarning) unavailable.push({ emp, hardWarning });
                else if (softWarnings.length > 0) withWarnings.push({ emp, softWarnings });
                else available.push({ emp, hardWarning: "" });
            });

            // Helper to render button
            const renderBtn = (item, isUnavail, warningText) => {
                const emp = item.emp;
                const btn = create("button", { className: "btn secondary", style: { width: "100%", textAlign: "left" } });
                const weeklyHours = this.getEmployeeWeeklyHours(emp.id);
                btn.innerHTML = `<div>${emp.name} (${String(weeklyHours).replace('.',',')}hs)</div>`;

                const assignmentsSummary = this.getEmployeeAssignmentsSummary(emp.id);
                if (assignmentsSummary.length > 0) {
                    const summaryText = assignmentsSummary.join(" | ");
                    btn.appendChild(create("div", { className: "assignment-summary", textContent: summaryText }));
                }

                if(warningText) {
                    const div = create("div", { className: "warning-text", style: {fontSize:"11px", color: isUnavail ? "var(--c-danger)" : "var(--c-sandwich)"} });
                    div.innerText = warningText;
                    btn.appendChild(div);
                }

                if(isUnavail) {
                    btn.disabled = true;
                    btn.style.opacity = 0.6;
                } else {
                    btn.onclick = () => {
                         if(warningText && !confirm(warningText + "\n\n¿Asignar de todos modos?")) return;
                        this.commitChange(() => { shift.employeeId = emp.id; });
                        wrap.remove();
                    };
                }
                listContainer.appendChild(btn);
            };

            available.forEach(x => renderBtn(x, false, ""));
            withWarnings.forEach(x => renderBtn(x, false, x.softWarnings.join(". ")));
            unavailable.forEach(x => renderBtn(x, true, x.hardWarning));
        }

        box.appendChild(c);

        const f = create("div", { style: { textAlign:"right", marginTop:"12px", padding: "12px" } });
        f.appendChild(create("button", { className:"btn", textContent:"Cancelar", onClick: () => wrap.remove() }));
        box.appendChild(f);

        wrap.appendChild(box);
        document.body.appendChild(wrap);
    },

    openEditShiftModal(shiftId) {
        const state = store.getState();
        const day = state.activeDay;
        const schedule = getActiveSchedule();
        const shift = schedule[day].find(s => s.id === shiftId);
        if (!shift) return;

        const wrap = create("div", { style: { position:"fixed", inset:"0", background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", zIndex:1000 }});
        const box = create("div", { className:"card", style:{ maxWidth:"400px", width:"100%" } });

        box.appendChild(create("div", { className:"card-h", innerHTML: `<strong>Editar turno</strong>` }));
        const c = create("div", { className:"card-c stack" });

        const roleSelect = create("select", { className: "select" });
        this.optionize(roleSelect, ROLES, r=>({value:r.key, label:r.key}));
        roleSelect.value = shift.role;

        const startSelect = create("select", { className: "select" });
        this.optionize(startSelect, SLOTS, s=>({value:s.index, label:s.label}));
        startSelect.value = shift.startSlot;

        const endSelect = create("select", { className: "select" });
        this.optionize(endSelect, SLOTS, s=>({value:s.index, label:s.label}));
        endSelect.value = shift.endSlot + 1;

        c.appendChild(create("label", { className:"muted", textContent: "Rol" }));
        c.appendChild(roleSelect);
        c.appendChild(create("label", { className:"muted", textContent: "Inicio" }));
        c.appendChild(startSelect);
        c.appendChild(create("label", { className:"muted", textContent: "Fin" }));
        c.appendChild(endSelect);

        box.appendChild(c);

        const f = create("div", { style: { textAlign:"right", marginTop:"12px", padding: "12px", gap: "8px", display: "flex", justifyContent: "flex-end" } });
        f.appendChild(create("button", { className:"btn secondary", textContent:"Cancelar", onClick: () => wrap.remove() }));
        f.appendChild(create("button", { className:"btn", textContent:"Guardar", onClick: () => {
            const newStart = Number(startSelect.value);
            const newEnd = Number(endSelect.value);
            if (newEnd <= newStart) { alert("Fin debe ser mayor a Inicio"); return; }

            this.commitChange(() => {
                shift.role = roleSelect.value;
                shift.startSlot = newStart;
                shift.endSlot = newEnd - 1;
            });
            wrap.remove();
        }}));
        box.appendChild(f);

        wrap.appendChild(box);
        document.body.appendChild(wrap);
    },

    renderScheduleList() {
        const content = el("#schedule-list-content");
        if(!content) return;
        clear(content);

        const state = store.getState();
        const schedule = getActiveSchedule();
        if(!schedule) return;

        const searchTerm = (state.scheduleSearchTerm || '').toLowerCase().trim();
        const employees = state.employees
            .filter(emp => this.getEmployeeWeeklyHours(emp.id) > 0)
            .filter(emp => emp.name.toLowerCase().includes(searchTerm))
            .sort((a, b) => a.name.localeCompare(b.name));

        const unassignedShiftsExist = Object.values(schedule).some(day => Array.isArray(day) && day.some(s => !s.employeeId));

        if (employees.length === 0 && !unassignedShiftsExist) {
            content.appendChild(create("p", { className: "muted", textContent: "No hay empleados ni turnos para mostrar." }));
            return;
        }

        const table = create("table", { className: "schedule-list-table" });
        const thead = create("thead");
        const headerRow = create("tr");

        const weekMonday = new Date(state.activeWeek + "T12:00:00Z");

        headerRow.appendChild(create("th", { textContent: "Empleado" }));
        DAYS.forEach((dayName, dayIndex) => {
            const dayDate = new Date(weekMonday);
            dayDate.setDate(weekMonday.getDate() + dayIndex);
            headerRow.appendChild(create("th", {
                innerHTML: `${dayName}<br><span class="muted" style="font-size:11px;">${dayDate.getDate()}/${dayDate.getMonth() + 1}</span>`
            }));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = create("tbody");

        // Unassigned Row
        const unassignedRow = create("tr", { dataset: { employeeId: "unassigned" } });
        unassignedRow.appendChild(create("td", { innerHTML: `<div style="font-weight: 500; font-style: italic;">Turnos sin Asignar</div>` }));

        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
            const dayCell = create("td", { dataset: { day: dayIndex } });
            const unassignedShifts = (schedule[dayIndex] || []).filter(s => !s.employeeId);
            if (unassignedShifts.length > 0) {
                const shiftsContainer = create("div", { className: "shifts-container" });
                unassignedShifts.forEach(shift => {
                    const shiftDiv = create("div", {
                        className: "schedule-list-shift unassigned-shift-item",
                        dataset: { shiftId: shift.id, dayIndex: dayIndex },
                        draggable: true,
                        innerHTML: `<div style="font-weight: 500;">${shift.role}</div><div style="font-size: 11px;">${SLOTS[shift.startSlot].label} - ${SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00"}</div>`
                    });

                    const roleInfo = ROLES.find(r => r.key === shift.role);
                    if(roleInfo) {
                        shiftDiv.style.backgroundColor = roleInfo.color;
                        shiftDiv.style.color = roleInfo.darkText ? '#111' : '#fff';
                    }

                    // Drag events (simplified inline or bind proper listeners)
                    shiftDiv.addEventListener('dragstart', (e) => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ shiftId: shift.id, dayIndex: dayIndex }));
                        e.dataTransfer.effectAllowed = 'move';
                        setTimeout(() => { shiftDiv.style.opacity = '0.5'; }, 0);
                    });
                    shiftDiv.addEventListener('dragend', () => { shiftDiv.style.opacity = '1'; });

                    shiftsContainer.appendChild(shiftDiv);
                });
                dayCell.appendChild(shiftsContainer);
            }
            this.addDropListeners(dayCell);
            unassignedRow.appendChild(dayCell);
        }
        tbody.appendChild(unassignedRow);

        // Employee Rows
        employees.forEach(emp => {
            const row = create("tr", { dataset: { employeeId: emp.id } });
            const weeklyHours = this.getEmployeeWeeklyHours(emp.id);
            row.appendChild(create("td", { innerHTML: `<div style="font-weight: 500;">${this.escapeHtml(emp.name)}</div><div class="muted" style="font-size: 12px;">Total: ${String(weeklyHours).replace('.', ',')}hs</div>` }));

            for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
                const dayCell = create("td", { dataset: { day: dayIndex } });
                const dayShifts = (schedule[dayIndex] || []).filter(s => s.employeeId === emp.id);
                if (dayShifts.length > 0) {
                    const shiftsContainer = create("div", { className: "shifts-container" });
                    dayShifts.forEach(shift => {
                        const shiftDiv = create("div", {
                            className: "schedule-list-shift",
                            dataset: { shiftId: shift.id, dayIndex: dayIndex },
                            draggable: true
                        });

                        const roleInfo = ROLES.find(r => r.key === shift.role);
                        if(roleInfo) {
                            shiftDiv.style.backgroundColor = roleInfo.color;
                            shiftDiv.style.color = roleInfo.darkText ? '#111' : '#fff';
                        }

                        const startTime = SLOTS[shift.startSlot].label;
                        const endTime = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";
                        let shiftText = `<div style="font-weight: 500;">${shift.role}</div><div style="font-size: 11px;">${startTime} - ${endTime}</div>`;

                        if (shift.replacement && shift.replacement.originalEmployeeId) {
                            const originalEmp = state.employees.find(e => e.id === shift.replacement.originalEmployeeId);
                            if(originalEmp) {
                                const originalName = originalEmp.displayName || originalEmp.name.split(' ')[0];
                                shiftText += `<div style="font-size: 10px; font-style: italic; margin-top: 2px;">(cubre a ${this.escapeHtml(originalName)})</div>`;
                            }
                        }
                        shiftDiv.innerHTML = shiftText;

                        // Sanction conflict visual
                        const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
                        const shiftDate = new Date(weekMonday);
                        shiftDate.setDate(shiftDate.getDate() + dayIndex);

                        if (isDateInSanctionPeriod(shiftDate, emp.sanctions) && !shift.replacement) {
                            shiftDiv.style.border = `2px solid var(--c-danger)`;
                            shiftDiv.title = 'Conflicto con sanción/licencia';
                        }

                        shiftDiv.addEventListener('dragstart', (e) => {
                            e.dataTransfer.setData('text/plain', JSON.stringify({ shiftId: shift.id, dayIndex: dayIndex }));
                            e.dataTransfer.effectAllowed = 'move';
                            setTimeout(() => { shiftDiv.style.opacity = '0.5'; }, 0);
                        });
                        shiftDiv.addEventListener('dragend', () => { shiftDiv.style.opacity = '1'; });

                        shiftDiv.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.showShiftContextMenu(e, shift.id, dayIndex, emp.id);
                        });

                        shiftsContainer.appendChild(shiftDiv);
                    });
                    dayCell.appendChild(shiftsContainer);
                }
                this.addDropListeners(dayCell);
                row.appendChild(dayCell);
            }
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        content.appendChild(table);
    },

    addDropListeners(dayCell) {
        dayCell.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        dayCell.addEventListener('dragenter', (e) => { e.preventDefault(); dayCell.classList.add('drag-over'); });
        dayCell.addEventListener('dragleave', () => { dayCell.classList.remove('drag-over'); });
        dayCell.addEventListener('drop', (e) => {
            e.preventDefault();
            dayCell.classList.remove('drag-over');

            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            const sourceShiftId = data.shiftId;
            const sourceDayIndex = data.dayIndex;

            const targetTr = e.target.closest('tr');
            if (!targetTr) return;

            const targetEmployeeId = targetTr.dataset.employeeId;
            const targetShiftElement = e.target.closest('.schedule-list-shift');
            const targetDayIndex = parseInt(e.target.closest('td').dataset.day, 10);

            const schedule = getActiveSchedule();
            const sourceShift = schedule[sourceDayIndex]?.find(s => s.id === sourceShiftId);
            if (!sourceShift) return;

            this.commitChange(() => {
                // Scenario 1: Unassign
                if (targetEmployeeId === 'unassigned') {
                    if (!sourceShift.employeeId) return;
                    sourceShift.employeeId = null;
                    return;
                }

                const targetEmployee = store.getState().employees.find(e => e.id === targetEmployeeId);
                if (!targetEmployee) return;

                // Scenario 2: Swap
                if (targetShiftElement) {
                    const targetShiftId = targetShiftElement.dataset.shiftId;
                    if (sourceShiftId === targetShiftId) return;

                    const targetShift = schedule[targetDayIndex]?.find(s => s.id === targetShiftId);
                    if (!targetShift || !targetShift.employeeId) return;

                    // Swap logic (simplified check)
                    [targetShift.employeeId, sourceShift.employeeId] = [sourceShift.employeeId, targetShift.employeeId];
                }
                // Scenario 3: Move/Assign
                else {
                    const sourceEmployeeId = sourceShift.employeeId;
                    if (sourceEmployeeId === targetEmployeeId && sourceDayIndex === targetDayIndex) return;

                    // Move logic
                    // If moving day, need to splice and push.
                    if (sourceDayIndex !== targetDayIndex) {
                        const originalDayShifts = schedule[sourceDayIndex];
                        const shiftIndex = originalDayShifts.findIndex(s => s.id === sourceShift.id);
                        if (shiftIndex > -1) {
                            const [shiftToMove] = originalDayShifts.splice(shiftIndex, 1);
                            shiftToMove.employeeId = targetEmployee.id;
                            this.ensureDay(targetDayIndex);
                            schedule[targetDayIndex].push(shiftToMove);
                        }
                    } else {
                        // Same day, just reassign
                        sourceShift.employeeId = targetEmployee.id;
                    }
                }
            });
        });
    },

    showShiftContextMenu(event, shiftId, dayIndex, employeeId) {
        const existingMenu = document.querySelector('.shift-context-menu');
        if (existingMenu) existingMenu.remove();

        const menu = create("div", { className: 'shift-context-menu' });

        if (employeeId) {
            menu.appendChild(create("button", { textContent: 'Desasignar empleado', onClick: () => {
                const schedule = getActiveSchedule();
                const shift = schedule[dayIndex]?.find(s => s.id === shiftId);
                if (shift) {
                    this.commitChange(() => { shift.employeeId = null; });
                }
                menu.remove();
            }}));
        }

        menu.appendChild(create("button", { textContent: 'Ir al turno', onClick: () => {
            store.setState({ activeDay: dayIndex });
            // Dispatch event to switch view
            document.dispatchEvent(new CustomEvent('view-changed', { detail: { view: 'schedule' } }));
            // Also need to trigger UIManager to actually switch the DOM visibility
            // We can listen to this event in app_main or UIManager.
            // Or just:
            el("#btn-view-schedule").click();

            setTimeout(() => {
                const shiftRow = document.querySelector(`[data-shift-id="${shiftId}"]`);
                if (shiftRow) {
                    shiftRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    shiftRow.classList.add('highlight-shift');
                    setTimeout(() => shiftRow.classList.remove('highlight-shift'), 2000);
                }
            }, 100);
            menu.remove();
        }}));

        document.body.appendChild(menu);
        menu.style.left = `${event.pageX}px`;
        menu.style.top = `${event.pageY}px`;

        const closeListener = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeListener);
            }
        };
        setTimeout(() => document.addEventListener('click', closeListener), 0);
    },

    handleSlotClick(shift, slotIndex) {
        const state = store.getState();
        const emp = shift.employeeId ? state.employees.find(e => e.id === shift.employeeId) : null;
        const dayIndex = typeof state.activeDay === 'number' ? state.activeDay : 0;

        const tempShift = { ...shift };
        let modified = false;

        if (slotIndex === tempShift.startSlot && tempShift.startSlot < tempShift.endSlot) {
            tempShift.startSlot++;
            modified = true;
        } else if (slotIndex === tempShift.endSlot && tempShift.endSlot > tempShift.startSlot) {
            tempShift.endSlot--;
            modified = true;
        } else if (slotIndex === tempShift.startSlot - 1) {
            tempShift.startSlot--;
            modified = true;
        } else if (slotIndex === tempShift.endSlot + 1) {
            tempShift.endSlot++;
            modified = true;
        }

        if (modified) {
            const isUnavailable = emp && isSlotUnavailable(emp, slotIndex, state.activeWeek, dayIndex);
            if (isUnavailable) {
                const confirmMessage = 'Esta celda está marcada como no disponible para este empleado. ¿Querés continuar de todos modos?';
                if (!confirm(confirmMessage)) return;
            }

            this.commitChange(() => {
                shift.startSlot = tempShift.startSlot;
                shift.endSlot = tempShift.endSlot;
            });
        }
    },

    handleAddShiftClick(role, event) {
        const activeRoleSelect = el("#activeRole");
        if(activeRoleSelect) activeRoleSelect.value = role;

        // Hide button
        event.currentTarget.style.display = 'none';

        // Add new row
        const existingRow = el('.new-shift-row');
        if(existingRow) existingRow.remove();

        const newRow = create("div", { className: "rowg new-shift-row", style: {
            gridTemplateColumns: `240px repeat(${SLOTS.length}, 1fr)`
        }});

        const nameCol = create("div", { className: "namecol" });
        nameCol.innerHTML = `<span class="muted" style="font-style: italic;">Nuevo turno para ${this.escapeHtml(role)}... (pintar)</span>`;
        newRow.appendChild(nameCol);

        for (let i = 0; i < SLOTS.length; i++) {
            const cell = create("div", {
                className: "slot ghost new-shift-slot",
                dataset: { slotIndex: i },
                onMouseDown: () => this.handlePaintStart(i),
                onMouseEnter: () => this.handlePaintEnter(i)
            });
            newRow.appendChild(cell);
        }

        event.currentTarget.parentElement.insertAdjacentElement('afterend', newRow);
    }
};
