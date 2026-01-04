import { el, create } from '../utils/dom.js';
import { store, getActiveSchedule } from '../store/Store.js';
import { DataManager } from '../services/DataManager.js';
import { ROLES, SLOTS, DAYS } from '../config.js';
import { timeToSlotIndex } from '../utils/rules.js';
import { toISODateString } from '../utils/date.js';
import { EmployeeManager } from './EmployeeManager.js';
import { ScheduleManager } from './ScheduleManager.js';

export const ImportExportManager = {
    init() {
        this.bindEvents();
    },

    bindEvents() {
        el("#btn-import-text")?.addEventListener("click", () => {
            el("#import-text-area").value = "";
            el("#import-text-modal").style.display = "flex";
        });
        el("#import-text-modal-close")?.addEventListener("click", () => el("#import-text-modal").style.display = "none");
        el("#btn-import-text-cancel")?.addEventListener("click", () => el("#import-text-modal").style.display = "none");
        el("#btn-import-text-process")?.addEventListener("click", () => this.importShiftsFromText());

        el("#btn-advanced-import-export")?.addEventListener("click", () => el("#advanced-import-export-modal").style.display = "flex");
        el("#advanced-import-export-modal-close")?.addEventListener("click", () => el("#advanced-import-export-modal").style.display = "none");

        el("#btn-export-employees")?.addEventListener("click", () => this.exportEmployees());
        el("#file-import-employees")?.addEventListener("change", (e) => this.importEmployees(e));

        el("#btn-export-day")?.addEventListener("click", () => this.exportDay());
        el("#file-import-day")?.addEventListener("change", (e) => this.importDay(e));

        el("#btn-export-week")?.addEventListener("click", () => this.exportWeek());
        el("#file-import-week")?.addEventListener("change", (e) => this.importWeek(e));
    },

    importShiftsFromText() {
        const text = el("#import-text-area").value.trim();
        if (!text) { alert("Vacío."); return; }

        const lines = text.split('\n');
        const newShifts = [];
        const errors = [];
        const timeRegex = /(\d{2}:\d{2})\s+a\s+(\d{2}:\d{2})\s+(.+)/;

        lines.forEach((line, index) => {
            line = line.trim();
            if (!line) return;
            const match = line.match(timeRegex);
            if (!match) { errors.push(`Línea ${index + 1}: Formato inválido.`); return; }

            const [, startTime, endTime, roleRaw] = match;
            const roleName = roleRaw.trim();
            let role = ROLES.find(r => r.key.toLowerCase() === roleName.toLowerCase());
            if (!role) {
                const normalizedRoleName = roleName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                role = ROLES.find(r => r.key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === normalizedRoleName);
            }
            if (!role) { errors.push(`Línea ${index + 1}: Rol desconocido.`); return; }

            const startSlot = timeToSlotIndex(startTime);
            const endSlotIndex = timeToSlotIndex(endTime);
            if (startSlot === -1 || endSlotIndex === -1) { errors.push(`Línea ${index + 1}: Hora inválida.`); return; }
            if (endSlotIndex <= startSlot) { errors.push(`Línea ${index + 1}: Fin <= Inicio.`); return; }

            newShifts.push({
                id: crypto.randomUUID(),
                role: role.key,
                startSlot: startSlot,
                endSlot: endSlotIndex - 1,
                employeeId: null
            });
        });

        if (errors.length > 0) { alert("Errores:\n" + errors.join("\n")); return; }
        if (newShifts.length === 0) { alert("Nada para importar."); return; }

        if (!confirm(`Importar ${newShifts.length} turnos?`)) return;

        const state = store.getState();
        ScheduleManager.commitChange(() => {
             const schedule = getActiveSchedule();
             schedule[state.activeDay] = newShifts;
        });

        el("#import-text-modal").style.display = "none";
        alert("Importado.");
    },

    exportEmployees() {
        this.downloadJSON(store.getState().employees, `empleados-${toISODateString(new Date())}.json`);
    },

    importEmployees(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const imported = JSON.parse(ev.target.result);
                if (!Array.isArray(imported)) throw new Error("No es array");
                const current = store.getState().employees;
                const existingIds = new Set(current.map(emp => emp.id));
                const newEmps = imported.filter(emp => emp.id && !existingIds.has(emp.id));

                if (newEmps.length === 0) { alert("No hay nuevos empleados."); return; }
                if (confirm(`Importar ${newEmps.length} empleados?`)) {
                    store.setState({ employees: [...current, ...newEmps] });
                    DataManager.saveState();
                    EmployeeManager.renderList();
                    alert("Importado.");
                    el("#advanced-import-export-modal").style.display = "none";
                }
            } catch (err) { alert("Error: " + err.message); }
            e.target.value = '';
        };
        reader.readAsText(file);
    },

    exportDay() {
        const state = store.getState();
        const schedule = getActiveSchedule();
        const dayShifts = schedule[state.activeDay] || [];
        this.downloadJSON(dayShifts, `dia-${DAYS[state.activeDay]}-${toISODateString(new Date())}.json`);
    },

    importDay(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const imported = JSON.parse(ev.target.result);
                if (!Array.isArray(imported)) throw new Error("Formato inválido");
                if (confirm("Reemplazar turnos del día actual?")) {
                    const newShifts = imported.map(s => ({ ...s, id: crypto.randomUUID() }));
                    const state = store.getState();
                    ScheduleManager.commitChange(() => {
                        const schedule = getActiveSchedule();
                        schedule[state.activeDay] = newShifts;
                    });
                    alert("Importado.");
                    el("#advanced-import-export-modal").style.display = "none";
                }
            } catch (err) { alert("Error: " + err.message); }
            e.target.value = '';
        };
        reader.readAsText(file);
    },

    exportWeek() {
        const includeAssignments = el("#chk-include-assignments").checked;
        let weekSchedule = getActiveSchedule();
        if (!includeAssignments) {
            weekSchedule = JSON.parse(JSON.stringify(weekSchedule));
            for (const day in weekSchedule) {
                if (Array.isArray(weekSchedule[day])) {
                    weekSchedule[day].forEach(s => s.employeeId = null);
                }
            }
        }
        this.downloadJSON(weekSchedule, `semana-${store.getState().activeWeek}.json`);
    },

    importWeek(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const imported = JSON.parse(ev.target.result);
                if (typeof imported !== 'object') throw new Error("Formato inválido");
                if (confirm("Reemplazar semana actual?")) {
                    const newWeek = JSON.parse(JSON.stringify(imported));
                    for (const day in newWeek) {
                        if (Array.isArray(newWeek[day])) {
                            newWeek[day].forEach(s => s.id = crypto.randomUUID());
                        }
                    }
                    store.setState({
                        schedules: {
                            ...store.getState().schedules,
                            [store.getState().activeWeek]: newWeek
                        }
                    });
                    DataManager.saveState();
                    ScheduleManager.render();
                    alert("Importado.");
                    el("#advanced-import-export-modal").style.display = "none";
                }
            } catch (err) { alert("Error: " + err.message); }
            e.target.value = '';
        };
        reader.readAsText(file);
    },

    downloadJSON(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
};
