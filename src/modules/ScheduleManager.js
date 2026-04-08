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
    isSlotUnavailable,
    getSchedulingRules
} from '../utils/rules.js';
import { getMonday, toISODateString } from '../utils/date.js';
import { EmployeeManager } from './EmployeeManager.js';
import { showToast, showConfirmDialog, showAlertDialog } from '../utils/feedback.js';
import { debounce, rafThrottle } from '../utils/perf.js';

export const ScheduleManager = {
    swapShiftSelectionId: null,
    activeTooltipEl: null,
    activeTooltipAnchor: null,
    debouncedRenderTable: null,
    debouncedRenderScheduleList: null,
    getActiveStoreLabel() {
        const state = store.getState();
        return (state.storeName || state.activeStoreId || 'Local sin nombre').trim();
    },
    init() {
        // Debounced renders to avoid heavy DOM rebuild on each keystroke.
        this.debouncedRenderTable = debounce(() => this.renderTable(), 90);
        this.debouncedRenderScheduleList = debounce(() => this.renderScheduleList(), 110);
        this.bindEvents();
    },

    bindEvents() {
        el("#activeRole")?.addEventListener("change", () => this.renderTable());
        el("#formStart")?.addEventListener("change", () => this.updateShiftDuration());
        el("#formEnd")?.addEventListener("change", () => this.updateShiftDuration());
        el("#btnAddUnassignedShift")?.addEventListener("click", () => this.addUnassignedShift());
        el("#btnUndo")?.addEventListener("click", () => this.undoLastAction());

        el("#weekSelector")?.addEventListener("change", (e) => this.changeWeek(e.target.value));
        el("#btn-prev-week")?.addEventListener("click", () => this.changeWeek(-this.getSchedulingPeriodDays()));
        el("#btn-next-week")?.addEventListener("click", () => this.changeWeek(this.getSchedulingPeriodDays()));
        el("#btn-lock-week")?.addEventListener("click", () => this.toggleWeekLock());

        // Filters dropdown toggle
        const filterBtn = el("#btn-schedule-filters");
        const filterDropdown = el("#schedule-filter-dropdown");
        if (filterBtn && filterDropdown) {
            const hideDropdown = () => {
                filterDropdown.classList.remove('show');
                filterBtn.classList.remove('active');
            };

            filterBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = filterDropdown.classList.contains('show');
                document.querySelectorAll('.dropdown-content').forEach(d => { if (d !== filterDropdown) d.classList.remove('show'); });
                filterDropdown.classList.toggle('show', !isOpen);
                filterBtn.classList.toggle('active', !isOpen);
            });

            document.addEventListener('click', (e) => {
                if (!filterDropdown.contains(e.target) && e.target !== filterBtn) hideDropdown();
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') hideDropdown();
            });
        }

        // Inline filters in schedule grid
        el("#schedule-search")?.addEventListener("input", (e) => {
            store.setState({ scheduleSearchTerm: e.target.value });
            this.debouncedRenderTable();
        });
        el("#schedule-role-filter")?.addEventListener("change", (e) => {
            const selected = Array.from(e.target.selectedOptions || []).map(o => o.value).filter(Boolean);
            store.setState({ scheduleRoleFilters: selected });
            // Role filter change is less frequent; apply immediately.
            this.debouncedRenderTable.flush?.();
        });

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
        const roles = this.getRoleList();
        this.optionize(el("#activeRole"), roles, r=>({value:r.key,label:r.key}));
        this.optionize(el("#formStart"), SLOTS, s=>({value:s.index,label:s.label}));
        this.optionize(el("#formEnd"),   SLOTS, s=>({value:s.index,label:s.label}));
        this.optionize(el("#schedule-role-filter"), roles, r=>({value:r.key,label:r.key}));

        this.updateShiftDuration();

        // Print Listeners
        el("#btn-print-schedule-list")?.addEventListener("click", () => { this.printSchedule(); el("#print-modal").style.display="none"; });
        el("#btn-print-daily-planning")?.addEventListener("click", () => { this.printDailyPlanning(); el("#print-modal").style.display="none"; });
        el("#btnPrint")?.addEventListener("click", () => el("#print-modal").style.display="flex");
        el("#print-modal-close")?.addEventListener("click", () => el("#print-modal").style.display="none");

        // Schedule List Listeners
        el("#schedule-list-search")?.addEventListener("input", (e) => {
            store.setState({ scheduleSearchTerm: e.target.value });
            this.debouncedRenderScheduleList();
        });
        const openMultiModal = () => {
            this.updateScheduleListFiltersUI();
            const modal = el("#schedule-list-multi-modal");
            if (modal) modal.style.display = "flex";
        };
        const closeMultiModal = () => {
            const modal = el("#schedule-list-multi-modal");
            if (modal) modal.style.display = "none";
        };
        el("#schedule-list-multi-btn")?.addEventListener("click", openMultiModal);
        el("#schedule-list-multi-close")?.addEventListener("click", closeMultiModal);
        el("#schedule-list-multi-close-footer")?.addEventListener("click", closeMultiModal);
        el("#schedule-list-multi-modal")?.addEventListener("click", (e) => {
            if (e.target === el("#schedule-list-multi-modal")) closeMultiModal();
        });
        el("#schedule-list-multi-search")?.addEventListener("input", (e) => {
            store.setState({ scheduleSelectedEmployeeSearch: e.target.value });
            this.updateScheduleListFiltersUI();
        });
        el("#schedule-list-clear-filter")?.addEventListener("click", () => {
            store.setState({ scheduleSelectedEmployeeIds: [] });
            store.setState({ scheduleSelectedEmployeeSearch: '' });
            this.updateScheduleListFiltersUI();
            this.renderScheduleList();
        });
        el("#schedule-list-multi-container")?.addEventListener("change", (e) => {
            const target = e.target;
            if (!target || !target.classList?.contains("schedule-list-multi-checkbox")) return;
            const empId = target.value;
            const selectedSet = new Set((store.getState().scheduleSelectedEmployeeIds || []).map(String));
            if (target.checked) selectedSet.add(empId);
            else selectedSet.delete(empId);
            store.setState({ scheduleSelectedEmployeeIds: Array.from(selectedSet) });
            this.debouncedRenderScheduleList.flush?.();
        });
        el("#btn-suggest-productivity")?.addEventListener("click", () => this.suggestShiftsForProductivity());

        this.initSlotHoverHighlight();

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
        el("#monthly-top-month")?.addEventListener("change", (e) => {
            this.monthlySelectedMonth = e.target.value;
            this.renderMonthlyPlanner();
        });
        el("#monthly-editor-save")?.addEventListener("click", () => this.saveMonthlyEditorCell());
        el("#monthly-editor-clear")?.addEventListener("click", () => this.clearMonthlyEditorCell());
        el("#monthly-editor-method")?.addEventListener("change", (e) => {
            this.monthlyTimeMethod = e.target.value === 'end' ? 'end' : 'duration';
            this.syncMonthlyEditorMethodUI();
        });
        document.addEventListener("keydown", (e) => this.handleMonthlyKeyboardShortcuts(e));
        document.addEventListener("click", (e) => {
            const menu = document.querySelector('.monthly-context-menu');
            if (menu && !menu.contains(e.target)) menu.remove();
        });
    },

    getRoleList() {
        const roles = store.getState().roles;
        return roles && roles.length ? roles : ROLES;
    },

    getSchedulingPeriodWeeks() {
        const value = Number(store.getState().schedulingPeriodWeeks);
        return [1, 2, 4].includes(value) ? value : 1;
    },

    getSchedulingPeriodDays() {
        return this.getSchedulingPeriodWeeks() * 7;
    },

    getWeekIdByDayOffset(dayOffset) {
        const baseDate = new Date(`${store.getState().activeWeek}T12:00:00.000Z`);
        baseDate.setUTCDate(baseDate.getUTCDate() + dayOffset);
        return toISODateString(getMonday(baseDate));
    },

    getDayIndexByOffset(dayOffset) {
        const normalized = ((dayOffset % 7) + 7) % 7;
        return normalized;
    },

    getShiftsByDayOffset(dayOffset) {
        const state = store.getState();
        const weekId = this.getWeekIdByDayOffset(dayOffset);
        const dayIndex = this.getDayIndexByOffset(dayOffset);
        const weekSchedule = state.schedules[weekId] || {};
        return Array.isArray(weekSchedule[dayIndex]) ? weekSchedule[dayIndex] : [];
    },

    async preloadPeriodWeeks() {
        const weeks = this.getSchedulingPeriodWeeks();
        const promises = [];
        for (let i = 1; i < weeks; i++) {
            const weekId = this.getWeekIdByDayOffset(i * 7);
            if (!store.getState().schedules[weekId]) {
                promises.push(DataManager.getWeekData(weekId));
            }
        }
        if (promises.length) await Promise.all(promises);
    },

    getMonthlySelectedMonth() {
        if (this.monthlySelectedMonth) return this.monthlySelectedMonth;
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        this.monthlySelectedMonth = `${today.getFullYear()}-${month}`;
        return this.monthlySelectedMonth;
    },

    getDatesForNaturalMonth(monthValue) {
        const [year, month] = (monthValue || '').split('-').map(Number);
        if (!year || !month) return [];
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return Array.from({ length: lastDay }, (_, idx) => new Date(Date.UTC(year, month - 1, idx + 1, 12, 0, 0)));
    },

    async preloadMonthWeeks(monthValue) {
        const dates = this.getDatesForNaturalMonth(monthValue);
        const uniqueWeeks = new Set(dates.map((date) => toISODateString(getMonday(date))));
        const promises = [];
        uniqueWeeks.forEach((weekId) => {
            if (!store.getState().schedules[weekId]) {
                promises.push(DataManager.getWeekData(weekId));
            }
        });
        if (promises.length) await Promise.all(promises);
    },

    getWeekAndDayFromDate(date) {
        const weekId = toISODateString(getMonday(date));
        const dayIndex = (date.getUTCDay() + 6) % 7;
        return { weekId, dayIndex };
    },

    getEmployeeShiftForDate(employeeId, date) {
        const { weekId, dayIndex } = this.getWeekAndDayFromDate(date);
        const weekSchedule = store.getState().schedules[weekId] || {};
        const dayShifts = weekSchedule[dayIndex] || [];
        return dayShifts.find((shift) => shift.employeeId === employeeId) || null;
    },

    syncMonthlyEditorMethodUI() {
        const method = this.monthlyTimeMethod === 'end' ? 'end' : 'duration';
        const durationWrap = el("#monthly-editor-duration-wrap");
        const endWrap = el("#monthly-editor-end-wrap");
        if (durationWrap) durationWrap.style.display = method === 'duration' ? 'flex' : 'none';
        if (endWrap) endWrap.style.display = method === 'end' ? 'flex' : 'none';
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

    initSlotHoverHighlight() {
        const table = el("#view-schedule .table");
        if (!table || this.slotHoverBound) return;
        this.slotHoverBound = true;
        this.hoveredSlotIndex = null;
        this.hoveredSlotEls = [];

        const clearHover = () => {
            if (this.hoveredSlotEls.length) {
                this.hoveredSlotEls.forEach(el => el.classList.remove("hovered-slot-column"));
            }
            this.hoveredSlotEls = [];
            this.hoveredSlotIndex = null;
        };

        const onOver = (e) => {
            const cell = e.target.closest("[data-slot-index]");
            if (!cell || !table.contains(cell)) return;
            const slotIndex = cell.dataset.slotIndex;
            if (slotIndex === this.hoveredSlotIndex) return;
            clearHover();
            const columnCells = table.querySelectorAll(`[data-slot-index="${slotIndex}"]`);
            columnCells.forEach(el => el.classList.add("hovered-slot-column"));
            this.hoveredSlotEls = Array.from(columnCells);
            this.hoveredSlotIndex = slotIndex;
        };

        table.addEventListener("mouseover", rafThrottle(onOver));

        table.addEventListener("mouseleave", () => {
            clearHover();
        });
    },

    render() {
        this.hideEmployeeWeekTooltip();
        this.preloadPeriodWeeks().catch((error) => console.warn('No se pudieron precargar semanas del período.', error));
        this.toggleMonthlyPlannerMode();
        const roles = this.getRoleList();
        const activeRoleSelect = el("#activeRole");
        const filterSelect = el("#schedule-role-filter");
        const prevActive = activeRoleSelect?.value;
        const prevFilters = filterSelect ? Array.from(filterSelect.selectedOptions).map(o => o.value) : [];

        this.optionize(activeRoleSelect, roles, r=>({value:r.key,label:r.key}));
        this.optionize(filterSelect, roles, r=>({value:r.key,label:r.key}));

        if (activeRoleSelect && prevActive) activeRoleSelect.value = prevActive;
        if (filterSelect && prevFilters.length) {
            Array.from(filterSelect.options).forEach(opt => {
                opt.selected = prevFilters.includes(opt.value);
            });
        }
        this.renderDayTabs();
        this.updateScheduleFiltersUI();
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

        if (this.getSchedulingPeriodWeeks() === 4) {
            this.renderMonthlyPlanner();
        }
    },

    toggleMonthlyPlannerMode() {
        const isMonthlyMode = this.getSchedulingPeriodWeeks() === 4;
        const monthlySection = el("#monthly-planner-section");
        const scroller = document.querySelector("#view-schedule .scroller");
        const dayTabs = el("#dayTabs");
        const dayTitle = el("#day-title");
        const projectedTickets = el("#projectedTickets");
        const suggestBtn = el("#btn-suggest-productivity");
        const controlsLeft = document.querySelector("#view-schedule .controls-left");
        const controlsCenter = document.querySelector("#view-schedule .controls-center");
        const controlsRight = document.querySelector("#view-schedule .controls-right");
        const monthTopInput = el("#monthly-top-month");
        const btnLock = el("#btn-lock-week");
        const btnPrev = el("#btn-prev-week");
        const btnNext = el("#btn-next-week");
        const weekDisplay = el("#week-display");
        const summaryBtn = el("#btn-weekly-summary");

        if (monthlySection) monthlySection.style.display = isMonthlyMode ? "flex" : "none";
        if (scroller) scroller.style.display = isMonthlyMode ? "none" : "block";
        if (dayTabs) dayTabs.style.display = isMonthlyMode ? "none" : "flex";
        if (dayTitle) dayTitle.style.display = isMonthlyMode ? "none" : "block";
        if (projectedTickets) projectedTickets.disabled = isMonthlyMode;
        if (suggestBtn) suggestBtn.style.display = isMonthlyMode ? "none" : "inline-flex";
        if (controlsLeft) controlsLeft.style.display = isMonthlyMode ? "none" : "flex";
        if (controlsCenter) controlsCenter.style.display = isMonthlyMode ? "none" : "flex";
        if (controlsRight) controlsRight.style.display = isMonthlyMode ? "none" : "flex";
        if (monthTopInput) monthTopInput.style.display = isMonthlyMode ? "inline-flex" : "none";
        if (btnLock) btnLock.style.display = isMonthlyMode ? "none" : "inline-flex";
        if (btnPrev) btnPrev.style.display = isMonthlyMode ? "none" : "inline-flex";
        if (btnNext) btnNext.style.display = isMonthlyMode ? "none" : "inline-flex";
        if (weekDisplay) weekDisplay.style.display = isMonthlyMode ? "none" : "inline-flex";
        if (summaryBtn) summaryBtn.textContent = isMonthlyMode ? "Resumen mensual" : "Resumen semanal";
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
                onClick: async () => {
                    const confirmed = await showConfirmDialog({
                        title: "Aplicar plantilla",
                        message: `¿Aplicar plantilla "${name}"? Esto sobrescribirá el día actual.`
                    });
                    if (confirmed) this.applyTemplate(name);
                }
            }));
            actions.appendChild(create("button", {
                className: "btn small secondary del", innerHTML: "&times;",
                onClick: async () => {
                    const confirmed = await showConfirmDialog({
                        title: "Eliminar plantilla",
                        message: `¿Eliminar plantilla "${name}"?`
                    });
                    if (confirmed) this.deleteTemplate(name);
                }
            }));

            item.appendChild(actions);
            list.appendChild(item);
        });
    },

    handleSwapSelection(shiftId) {
        if (this.isWeekLocked()) {
            showToast("La semana está bloqueada. Solo podés ver los turnos.", "warning");
            return;
        }
        const currentShiftData = this.findShiftWithDay(shiftId);
        const currentShift = currentShiftData?.shift;
        if (!currentShift || !currentShift.employeeId) {
            showToast("Seleccioná un turno asignado para intercambiar", "warning");
            return;
        }

        if (!this.swapShiftSelectionId) {
            this.swapShiftSelectionId = shiftId;
            showToast("Turno marcado. Elegí otro turno asignado para completar el intercambio", "info");
            this.renderTable();
            return;
        }

        if (this.swapShiftSelectionId === shiftId) {
            this.swapShiftSelectionId = null;
            this.renderTable();
            return;
        }

        const otherShiftData = this.findShiftWithDay(this.swapShiftSelectionId);
        const otherShift = otherShiftData?.shift;
        if (!otherShift || !otherShift.employeeId) {
            this.swapShiftSelectionId = null;
            showToast("El turno seleccionado ya no está asignado", "warning");
            this.renderTable();
            return;
        }

        const validationIssues = this.validateSwap(currentShiftData, otherShiftData);
        const proceedSwap = () => {
            this.commitChange(() => {
                const tempEmp = currentShift.employeeId;
                currentShift.employeeId = otherShift.employeeId;
                otherShift.employeeId = tempEmp;
            });
            this.swapShiftSelectionId = null;
            showToast("Turnos intercambiados", "success");
            this.renderTable();
        };

        if (validationIssues.length) {
            showConfirmDialog({
                title: "Intercambio con advertencias",
                message: validationIssues.join("<br>") + "<br><br>¿Aplicar el intercambio de todos modos?"
            }).then(confirmed => {
                if (confirmed) proceedSwap();
                else this.renderTable();
            });
        } else {
            proceedSwap();
        }
    },

    validateSwap(currentShiftData, otherShiftData) {
        const issues = [];
        const state = store.getState();
        const employeeA = state.employees.find(e => e.id === currentShiftData.shift.employeeId);
        const employeeB = state.employees.find(e => e.id === otherShiftData.shift.employeeId);
        const weekId = state.activeWeek;

        const isSameDay = currentShiftData.dayIndex === otherShiftData.dayIndex;
        const ignoreForEmployeeB = isSameDay ? [otherShiftData.shift.id] : [];
        const ignoreForEmployeeA = isSameDay ? [currentShiftData.shift.id] : [];

        const tempShiftForB = { ...currentShiftData.shift };
        const tempShiftForA = { ...otherShiftData.shift };

        const checkB = this.validateShiftForEmployee(employeeB, tempShiftForB, currentShiftData.dayIndex, weekId, ignoreForEmployeeB);
        if (!checkB.pass) issues.push(`Para ${employeeB?.name || "empleado"}: ${checkB.message}`);

        const checkA = this.validateShiftForEmployee(employeeA, tempShiftForA, otherShiftData.dayIndex, weekId, ignoreForEmployeeA);
        if (!checkA.pass) issues.push(`Para ${employeeA?.name || "empleado"}: ${checkA.message}`);

        return issues;
    },

    findShiftById(shiftId) {
        const result = this.findShiftWithDay(shiftId);
        return result?.shift || null;
    },

    findShiftWithDay(shiftId) {
        const days = this.getScheduleDaysArray();
        for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
            const found = days[dayIndex]?.find(s => s.id === shiftId);
            if (found) return { shift: found, dayIndex };
        }
        return null;
    },

    async saveCurrentDayAsTemplate() {
        const nameInp = el("#inpTemplateName");
        const descInp = el("#inpTemplateDesc");
        if (!nameInp) return;

        const name = nameInp.value.trim();
        const description = descInp ? descInp.value.trim() : "";

        if (!name) { showToast("Ingresa un nombre para la plantilla.", "warning"); return; }

        const state = store.getState();
        if (state.templates && state.templates[name]) {
            const confirmed = await showConfirmDialog({
                title: "Sobrescribir plantilla",
                message: `La plantilla "${name}" ya existe. ¿Sobrescribirla?`
            });
            if (!confirmed) return;
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
        showToast("Plantilla guardada.", "success");
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

        const roleOrder = this.getRoleList().map(r => r.key);
        const sortedRoles = Object.keys(shiftsByRole).sort((a, b) => {
            const ia = roleOrder.indexOf(a);
            const ib = roleOrder.indexOf(b);
            if (ia === -1 && ib === -1) return a.localeCompare(b);
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });

        sortedRoles.forEach(role => {
            const roleShifts = shiftsByRole[role];
            roleShifts.sort((a, b) => a.startSlot - b.startSlot);

            roleShifts.forEach((shift, index) => {
                const cols = `240px repeat(${SLOTS.length}, minmax(28px, 1fr))`;
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
                        empNameSpan.addEventListener("mouseenter", () => this.showEmployeeWeekTooltip(emp, empNameSpan));
                        empNameSpan.addEventListener("mouseleave", () => this.hideEmployeeWeekTooltip());
                        empNameSpan.addEventListener("mousemove", () => this.positionEmployeeWeekTooltip(empNameSpan));
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
                    className: "btn secondary swap-button", innerHTML: "⇄",
                    style: { padding: "2px 6px", fontSize: "10px" }, title: "Intercambiar turno",
                    onClick: (e) => { e.stopPropagation(); this.handleSwapSelection(shift.id); }
                }));
                actionsDiv.appendChild(create("button", {
                    className: "btn secondary", innerHTML: "&#9998;",
                    style: { padding: "2px 6px", fontSize: "10px" }, title: "Editar turno",
                    onClick: (e) => { e.stopPropagation(); this.openEditShiftModal(shift.id); }
                }));
                actionsDiv.appendChild(create("button", {
                    className: "btn secondary del", innerHTML: "&times;",
                    style: { padding: "2px 6px", fontSize: "10px" }, title: "Eliminar turno",
                    onClick: async (e) => {
                        e.stopPropagation();
                        const confirmed = await showConfirmDialog({
                            title: "Eliminar turno",
                            message: "¿Eliminar este turno?"
                        });
                        if (confirmed) this.deleteShift(shift.id);
                    }
                }));
                if (this.swapShiftSelectionId === shift.id) {
                    namecol.classList.add("swap-selected");
                }
                namecol.appendChild(actionsDiv);
                row.appendChild(namecol);

                // Slots
                const emp = shift.employeeId ? state.employees.find(e => e.id === shift.employeeId) : null;
                const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
                const shiftDate = new Date(weekMonday);
                shiftDate.setUTCDate(weekMonday.getUTCDate() + day);
                const activeRules = getSchedulingRules();

                // Sanction check using the imported util
                const isInConflict = activeRules.enforceSanctions && emp && isDateInSanctionPeriod(shiftDate, emp.sanctions) && !shift.replacement;

                for (let i = 0; i < SLOTS.length; i++) {
                    const cell = create("div", { className: "slot", dataset: { slotIndex: i }, onClick: () => this.handleSlotClick(shift, i) });

                    // Check availability for every slot
                    if (shift.employeeId && emp && isSlotUnavailable(emp, i, state.activeWeek, day)) {
                        cell.classList.add("unavailable-slot");
                    }

                    if (i >= shift.startSlot && i <= shift.endSlot) {
                        const roleData = ROLES.find(r => r.key === shift.role);
                        cell.classList.add("assigned");
                        if (roleData) {
                            cell.style.background = roleData.color;
                            cell.style.color = roleData.darkText ? '#111' : '#fff';
                        }

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
                const roleInfo = ROLES.find(r => r.key === role);
                const addBtn = create("button", {
                    className: "add-shift-btn",
                    textContent: "+", title: `Añadir un nuevo turno de ${role}`,
                    onClick: (e) => this.handleAddShiftClick(role, e),
                    style: roleInfo ? { background: roleInfo.color, color: roleInfo.darkText ? '#111' : '#fff' } : {}
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

        const cols = `240px repeat(${SLOTS.length}, minmax(28px, 1fr))`;
        const g = create("div", { className: "rowg", style: { gridTemplateColumns: cols } });

        const name = create("div", {
            className: "namecol",
            innerHTML: `<div style="line-height:1.2"><span class="muted" style="font-size:12px">Turno</span><br><span style="font-size:11px;font-weight:600;color:#374151">Total: ${String(totalDayHours).replace('.',',')}hs</span></div>`
        });
        g.appendChild(name);

        SLOTS.forEach((s, idx) => {
            const c = create("div", {
                className: "slot-h",
                dataset: { slotIndex: idx },
                style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1px", padding: "2px 0" }
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

    ensureSavingIndicator() {
        const container = el("#week-selector-container");
        if (!container) return;

        let badge = el("#schedule-saving-indicator");
        if (!badge) {
            badge = create("span", { id: "schedule-saving-indicator", className: "saving-indicator", textContent: "Sincronizado" });
            container.appendChild(badge);
        }
    },

    setSavingStatus(isSaving, hasError = false) {
        const badge = el("#schedule-saving-indicator");
        if (!badge) return;

        badge.classList.toggle("active", isSaving);
        badge.classList.toggle("error", !!hasError);
        if (hasError) {
            badge.textContent = "Error al guardar";
        } else if (isSaving) {
            badge.textContent = "Guardando…";
        } else {
            badge.textContent = "Sincronizado";
        }
    },

    validateShiftForEmployee(employee, shift, dayIndex, weekId, shiftsToIgnore = []) {
        if (!employee) return { pass: false, message: "Empleado no encontrado." };
        if (!shift && shift !== 0) return { pass: false, message: "Turno no válido." };

        if (shift.ignoreRestrictions) return { pass: true, message: "" };

        const shiftDate = new Date(`${weekId}T12:00:00.000Z`);
        shiftDate.setUTCDate(shiftDate.getUTCDate() + dayIndex);
        const rules = getSchedulingRules();

        if (rules.enforceSanctions && isDateInSanctionPeriod(shiftDate, employee.sanctions)) {
            return { pass: false, message: "El empleado tiene una licencia activa." };
        }

        if (rules.enforceMinorNightLimit && employee.isMinor && shift.endSlot > MAX_SLOT_FOR_MINOR) {
            return { pass: false, message: "El empleado es menor y no puede trabajar en este horario." };
        }

        if (rules.enforceRoleStar && !shift.ignoreRestrictions && shift.role && !(employee.stars || []).includes(shift.role)) {
            return { pass: false, message: `El empleado no tiene la estrella requerida para ${shift.role}.` };
        }

        if (rules.enforceOverlap) {
            const overlapCheck = checkShiftOverlap(employee.id, shift, dayIndex, shiftsToIgnore);
            if (!overlapCheck.pass) return overlapCheck;
        }

        if (rules.enforceRestTime) {
            const restCheck = checkRestTime(employee.id, shift, weekId, dayIndex, rules.minRestHours);
            if (!restCheck.pass) return restCheck;
        }

        if (rules.enforceAvailability) {
            const availabilityCheck = checkEmployeeAvailability(employee, shift, weekId, dayIndex);
            if (!availabilityCheck.isAvailable) {
                return { pass: false, message: availabilityCheck.reason };
            }
        }

        return { pass: true, message: "" };
    },

    commitChange(action) {
        if (this.isWeekLocked()) {
            showToast("La semana está bloqueada. Solo podés ver los turnos.", "warning");
            return;
        }
        const currentSchedule = getActiveSchedule();
        historyManager.push(currentSchedule);
        action();

        const btnUndo = el("#btnUndo");
        if(btnUndo) btnUndo.disabled = !historyManager.canUndo();

        this.render();

        this.setSavingStatus(true);
        DataManager.saveState()
            .then(() => this.setSavingStatus(false))
            .catch((err) => {
                console.error("Error al guardar cambios de horario:", err);
                this.setSavingStatus(false, true);
            });
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
        if (this.isWeekLocked()) {
            showToast("La semana está bloqueada. Solo podés ver los turnos.", "warning");
            return;
        }
        const role = el("#activeRole").value;
        const startSlot = Number(el("#formStart").value);
        const endSlot = Number(el("#formEnd").value);
        if(Number.isNaN(startSlot) || Number.isNaN(endSlot) || endSlot <= startSlot) {
            showToast("La hora de fin debe ser posterior a la hora de inicio.", "warning");
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
        const state = store.getState();
        if (this.getSchedulingPeriodWeeks() === 4) {
            this.printMonthlySchedule();
            return;
        }
        const periodDays = this.getSchedulingPeriodDays();
        const employees = state.employees
            .filter(emp => {
                for (let dayOffset = 0; dayOffset < periodDays; dayOffset++) {
                    if (this.getShiftsByDayOffset(dayOffset).some(s => s.employeeId === emp.id)) return true;
                }
                return false;
            })
            .sort((a,b) => a.name.localeCompare(b.name));

        const monday = new Date(state.activeWeek + "T12:00:00Z");
        const periodEnd = new Date(monday);
        periodEnd.setDate(monday.getDate() + periodDays - 1);
        const formatDate = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
        const storeLabel = this.escapeHtml(this.getActiveStoreLabel());

        const chunkSize = periodDays > 10 ? 7 : periodDays;
        const sections = [];
        for (let startOffset = 0; startOffset < periodDays; startOffset += chunkSize) {
            const endOffset = Math.min(startOffset + chunkSize, periodDays);
            const dayHeaders = [];
            for (let dayOffset = startOffset; dayOffset < endOffset; dayOffset++) {
                const dayDate = new Date(monday);
                dayDate.setDate(monday.getDate() + dayOffset);
                const dayName = dayDate.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
                dayHeaders.push(`<th>${this.escapeHtml(dayName)}<br>${dayDate.getDate()}/${dayDate.getMonth() + 1}</th>`);
            }

            let tableRows = '';
            employees.forEach(emp => {
                let row = `<tr><td>${this.escapeHtml(emp.name)}</td>`;
                for (let dayOffset = startOffset; dayOffset < endOffset; dayOffset++) {
                    const dayShifts = this.getShiftsByDayOffset(dayOffset).filter(s => s.employeeId === emp.id);
                    if (dayShifts.length > 0) {
                        const shift = dayShifts[0];
                        const startTime = SLOTS[shift.startSlot].label;
                        const endTime = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";
                        row += `<td>${startTime}<br>${endTime}</td>`;
                    } else {
                        row += `<td>OFF</td>`;
                    }
                }
                row += '</tr>';
                tableRows += row;
            });

            sections.push(`<section class="print-section"><h3>Días ${startOffset + 1} al ${endOffset}</h3><table><thead><tr><th>Nombre</th>${dayHeaders.join('')}</tr></thead><tbody>${tableRows}</tbody></table></section>`);
        }

        const w = window.open('', '', 'height=800,width=1200');
        w.document.write(`<html><head><title>Horarios</title><style>body{font-family:sans-serif;font-size:9px}h3{margin:8px 0}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #ccc;padding:4px;text-align:center;word-wrap:break-word}th{background:#f2f2f2}.print-section{margin-bottom:14px}@media print{@page{size:landscape;margin:8mm}.print-section{page-break-after:always}.print-section:last-child{page-break-after:auto}}</style></head><body><h2>${storeLabel} - Período ${formatDate(monday)} al ${formatDate(periodEnd)}</h2>${sections.join('')}<script>setTimeout(()=>{window.print();window.close()},500)</script></body></html>`);
        w.document.close();
    },

    printMonthlySchedule() {
        const state = store.getState();
        const monthValue = this.getMonthlySelectedMonth();
        const dates = this.getDatesForNaturalMonth(monthValue);
        if (!dates.length) return;

        const employees = state.employees
            .filter((emp) => dates.some((date) => this.getEmployeeShiftForDate(emp.id, date)))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const monthTitle = dates[0].toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const storeLabel = this.escapeHtml(this.getActiveStoreLabel());

        const headers = dates.map((date) => {
            const dayName = date.toLocaleDateString('es-AR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
            return `<th>${this.escapeHtml(dayName)}<br>${String(date.getUTCDate()).padStart(2, '0')}</th>`;
        }).join('');

        const rows = employees.map((emp) => {
            const cells = dates.map((date) => {
                const shift = this.getEmployeeShiftForDate(emp.id, date);
                if (!shift) return '<td>OFF</td>';
                const startTime = SLOTS[shift.startSlot]?.label || '';
                const endTime = SLOTS[shift.endSlot + 1]?.label || '02:00';
                return `<td><strong>${startTime}-${endTime}</strong></td>`;
            }).join('');
            return `<tr><td class="name-cell">${this.escapeHtml(emp.name || 'Sin nombre')}</td>${cells}</tr>`;
        }).join('');

        const w = window.open('', '', 'height=850,width=1500');
        w.document.write(`<html><head><title>Listado mensual</title><style>body{font-family:Arial,sans-serif;margin:0;font-size:8px}.sheet{padding:6mm}h2{margin:0 0 6px 0;font-size:14px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #888;padding:2px;text-align:center;vertical-align:middle;word-break:break-word}th{background:#f1f5f9;font-size:7px;line-height:1.1}td{font-size:7px;line-height:1.1}.name-cell{width:120px;min-width:120px;max-width:120px;text-align:left;font-weight:700}@media print{@page{size:landscape;margin:6mm}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><div class="sheet"><h2>${storeLabel} · Listado mensual · ${this.escapeHtml(monthTitle)}</h2><table><thead><tr><th class="name-cell">Empleado</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div><script>setTimeout(()=>{window.print();window.close()},500)</script></body></html>`);
        w.document.close();
    },

    async renderMonthlyPlanner() {
        if (this.getSchedulingPeriodWeeks() !== 4) return;
        const monthInput = el("#monthly-top-month");
        const gridContainer = el("#monthly-planner-grid");
        const editor = el("#monthly-planner-editor");
        const targetBadge = el("#monthly-editor-target");
        if (!monthInput || !gridContainer || !editor || !targetBadge) return;

        const monthValue = this.getMonthlySelectedMonth();
        if (monthInput.value !== monthValue) monthInput.value = monthValue;

        await this.preloadMonthWeeks(monthValue);

        const dates = this.getDatesForNaturalMonth(monthValue);
        const state = store.getState();
        const employees = [...state.employees].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const selectedKey = this.monthlyEditorContext ? `${this.monthlyEditorContext.employeeId}|${this.monthlyEditorContext.dateISO}` : null;
        const prevScrollTop = gridContainer.scrollTop;
        const prevScrollLeft = gridContainer.scrollLeft;

        clear(gridContainer);
        const table = create("table", { className: "monthly-grid-table" });
        const thead = create("thead");
        const headerRow = create("tr");
        headerRow.appendChild(create("th", { className: "monthly-employee-cell", textContent: "APELLIDO Y NOMBRE" }));
        dates.forEach((date) => {
            const dayName = date.toLocaleDateString('es-AR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '').toUpperCase();
            headerRow.appendChild(create("th", { innerHTML: `${dayName}<br>${String(date.getUTCDate()).padStart(2, '0')}` }));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = create("tbody");
        employees.forEach((employee) => {
            const row = create("tr");
            row.appendChild(create("td", { className: "monthly-employee-cell", textContent: employee.name || employee.displayName || 'Sin nombre' }));

            // Precompute exception dates for fast lookups per day cell.
            const exceptionDateSet = new Set(
                (employee.exceptions || [])
                    .map(ex => ex?.date)
                    .filter(Boolean)
            );

            dates.forEach((date) => {
                const dateISO = toISODateString(date);
                const shift = this.getEmployeeShiftForDate(employee.id, date);
                const roleInfo = shift ? this.getRoleList().find((role) => role.key === shift.role) : null;
                const { weekId } = this.getWeekAndDayFromDate(date);
                const isLocked = !!(store.getState().schedules[weekId]?.isLocked);
                const cellKey = `${employee.id}|${dateISO}`;

                const cell = create("td", {
                    className: `monthly-shift-cell ${shift ? 'active' : 'off'}${selectedKey === cellKey ? ' selected' : ''}`,
                    title: isLocked ? 'La semana de esta fecha está bloqueada' : 'Click para editar',
                    dataset: { employeeId: employee.id, dateIso: dateISO }
                });
                if (roleInfo) {
                    cell.style.background = roleInfo.color;
                    cell.style.color = roleInfo.darkText ? '#111' : '#fff';
                }

                if (shift) {
                    const startLabel = SLOTS[shift.startSlot]?.label || '';
                    const endLabel = SLOTS[shift.endSlot + 1]?.label || '';
                    cell.innerHTML = `<div style="font-size:12px;font-weight:800;">${startLabel} - ${endLabel}</div><div style="font-size:9px;opacity:.9;">${this.escapeHtml(shift.role || '')}</div>`;
                } else {
                    cell.textContent = 'OFF';
                }

                // Alerts: exceptions / licenses / sanctions for that day.
                const hasException = exceptionDateSet.has(dateISO);
                const hasSanction = Array.isArray(employee.sanctions) && employee.sanctions.length > 0
                    ? isDateInSanctionPeriod(date, employee.sanctions)
                    : false;

                if (hasException || hasSanction) {
                    const parts = [];
                    if (hasException) parts.push('EX');
                    if (hasSanction) parts.push('LIC');

                    const badgeLabel = parts.join('+');
                    const bg = (hasException && hasSanction)
                        ? 'rgba(124,58,237,0.95)' // both
                        : (hasException ? 'rgba(239,68,68,0.95)' : 'rgba(245,158,11,0.95)'); // exception / sanction

                    cell.style.position = cell.style.position || 'relative';
                    cell.style.zIndex = 1;

                    // Avoid blocking clicks/drag on the cell.
                    cell.appendChild(create('div', {
                        className: 'monthly-day-alert-badge',
                        textContent: badgeLabel,
                        style: {
                            position: 'absolute',
                            top: '2px',
                            right: '2px',
                            fontSize: '10px',
                            fontWeight: '800',
                            background: bg,
                            color: '#fff',
                            padding: '1px 4px',
                            borderRadius: '999px',
                            pointerEvents: 'none'
                        }
                    }));

                    const alertTitle = `${parts.join(' + ')} en ${dateISO}`;
                    cell.title = cell.title ? `${cell.title} • ${alertTitle}` : alertTitle;
                }

                if (!isLocked) {
                    cell.addEventListener('click', () => this.selectMonthlyCell(employee, date));
                    cell.addEventListener('contextmenu', (event) => this.openMonthlyContextMenu(event, employee, date));
                    cell.addEventListener('dragover', (event) => {
                        event.preventDefault();
                        cell.classList.add('drag-over');
                        event.dataTransfer.dropEffect = 'move';
                    });
                    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
                    cell.addEventListener('drop', (event) => {
                        event.preventDefault();
                        cell.classList.remove('drag-over');
                        this.handleMonthlyCellDrop(event, employee, date);
                    });
                }

                if (shift && !isLocked) {
                    cell.draggable = true;
                    cell.addEventListener('dragstart', (event) => this.handleMonthlyCellDragStart(event, shift, employee.id, dateISO));
                    cell.addEventListener('dragend', () => { cell.style.opacity = '1'; });
                }

                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        gridContainer.appendChild(table);
        gridContainer.scrollTop = prevScrollTop;
        gridContainer.scrollLeft = prevScrollLeft;

        editor.style.display = "flex";
        if (this.monthlyEditorContext) {
            const selectedEmployee = state.employees.find((emp) => emp.id === this.monthlyEditorContext.employeeId);
            const selectedDate = new Date(`${this.monthlyEditorContext.dateISO}T12:00:00.000Z`);
            targetBadge.textContent = `${selectedEmployee?.name || 'Empleado'} · ${selectedDate.toLocaleDateString('es-AR', { timeZone: 'UTC' })}`;
        } else {
            targetBadge.textContent = "Seleccioná una celda para asignar turno";
        }
    },

    async selectMonthlyCell(employee, date) {
        const dateISO = toISODateString(date);
        if (this.monthlyMoveSourceContext && (this.monthlyMoveSourceContext.employeeId !== employee.id || this.monthlyMoveSourceContext.dateISO !== dateISO)) {
            const moved = await this.moveMonthlyShift(this.monthlyMoveSourceContext, { employeeId: employee.id, dateISO });
            this.monthlyMoveSourceContext = null;
            if (moved) return;
        }
        this.monthlyEditorContext = { employeeId: employee.id, dateISO };

        const roleSelect = el("#monthly-editor-role");
        const startSelect = el("#monthly-editor-start");
        const durationSelect = el("#monthly-editor-duration");
        const endSelect = el("#monthly-editor-end");
        const methodSelect = el("#monthly-editor-method");
        if (!roleSelect || !startSelect || !durationSelect || !endSelect || !methodSelect) return;

        this.optionize(roleSelect, [{ key: '' }, ...this.getRoleList()], (role) => ({ value: role.key, label: role.key || 'OFF' }));
        this.optionize(startSelect, [{ label: '', index: '' }, ...SLOTS], (slot) => ({ value: slot.index, label: slot.label || '--' }));
        this.optionize(endSelect, [{ index: '' }, ...SLOTS], (slot) => {
            if (slot.index === '') return { value: '', label: '--' };
            const endLabel = SLOTS[Number(slot.index) + 1]?.label || SLOTS[Number(slot.index)]?.label || '';
            return { value: slot.index, label: endLabel };
        });
        const shift = this.getEmployeeShiftForDate(employee.id, date);
        roleSelect.value = shift?.role || '';
        startSelect.value = shift ? String(shift.startSlot) : '';
        durationSelect.value = shift ? String((shift.endSlot - shift.startSlot + 1) / 2) : '';
        endSelect.value = shift ? String(shift.endSlot) : '';
        methodSelect.value = this.monthlyTimeMethod === 'end' ? 'end' : 'duration';
        this.syncMonthlyEditorMethodUI();

        this.renderMonthlyPlanner();
    },

    openMonthlyContextMenu(event, employee, date) {
        event.preventDefault();
        this.selectMonthlyCell(employee, date);

        const existing = document.querySelector('.monthly-context-menu');
        if (existing) existing.remove();

        const menu = create("div", { className: "monthly-context-menu" });
        menu.appendChild(create("button", {
            textContent: "Copiar turno",
            onClick: () => {
                this.copySelectedMonthlyCell();
                menu.remove();
            }
        }));
        menu.appendChild(create("button", {
            textContent: "Pegar turno",
            onClick: () => {
                this.pasteToSelectedMonthlyCell();
                menu.remove();
            }
        }));
        menu.appendChild(create("button", {
            textContent: "Mover turno",
            onClick: () => {
                const dateISO = toISODateString(date);
                const shift = this.getEmployeeShiftForDate(employee.id, date);
                if (!shift) {
                    showToast("No hay turno para mover en esta celda.", "warning");
                } else {
                    this.monthlyMoveSourceContext = { employeeId: employee.id, dateISO };
                    showToast("Turno listo para mover. Seleccioná la celda destino.", "info");
                }
                menu.remove();
            }
        }));
        menu.appendChild(create("button", {
            className: "delete",
            textContent: "Borrar turno",
            onClick: async () => {
                await this.applyMonthlyCellData({ employeeId: employee.id, dateISO: toISODateString(date) }, null);
                menu.remove();
            }
        }));
        document.body.appendChild(menu);
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
    },

    handleMonthlyKeyboardShortcuts(event) {
        if (this.getSchedulingPeriodWeeks() !== 4 || !this.monthlyEditorContext) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
        const isCopy = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
        const isPaste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
        if (isCopy) {
            event.preventDefault();
            this.copySelectedMonthlyCell();
        }
        if (isPaste) {
            event.preventDefault();
            this.pasteToSelectedMonthlyCell();
        }
        const isDeleteKey = event.key === 'Delete' || event.key === 'Del' || event.key === 'Supr' || event.keyCode === 46 || event.key === 'Backspace';
        if (isDeleteKey && this.monthlyEditorContext) {
            event.preventDefault();
            this.clearMonthlyEditorCell();
        }
    },

    handleMonthlyCellDragStart(event, shift, employeeId, dateISO) {
        event.dataTransfer.setData('text/plain', JSON.stringify({
            mode: 'monthly',
            sourceEmployeeId: employeeId,
            sourceDateISO: dateISO,
            shiftId: shift.id
        }));
        event.dataTransfer.effectAllowed = 'move';
        setTimeout(() => {
            const target = event.currentTarget;
            if (target?.style) target.style.opacity = '0.45';
        }, 0);
    },

    async handleMonthlyCellDrop(event, employee, date) {
        let payload = null;
        try {
            payload = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch {
            return;
        }
        if (!payload || payload.mode !== 'monthly') return;
        await this.moveMonthlyShift(
            { employeeId: payload.sourceEmployeeId, dateISO: payload.sourceDateISO, shiftId: payload.shiftId },
            { employeeId: employee.id, dateISO: toISODateString(date) }
        );
    },

    async moveMonthlyShift(sourceContext, targetContext) {
        if (!sourceContext || !targetContext || !targetContext.employeeId) return false;
        if (sourceContext.employeeId === targetContext.employeeId && sourceContext.dateISO === targetContext.dateISO) return false;

        const sourceDate = new Date(`${sourceContext.dateISO}T12:00:00.000Z`);
        const targetDate = new Date(`${targetContext.dateISO}T12:00:00.000Z`);
        const { weekId: sourceWeekId, dayIndex: sourceDayIndex } = this.getWeekAndDayFromDate(sourceDate);
        const { weekId: targetWeekId, dayIndex: targetDayIndex } = this.getWeekAndDayFromDate(targetDate);
        await Promise.all([DataManager.getWeekData(sourceWeekId), DataManager.getWeekData(targetWeekId)]);

        const schedules = store.getState().schedules;
        if (schedules[sourceWeekId]?.isLocked || schedules[targetWeekId]?.isLocked) {
            showToast("No podés mover turnos en semanas bloqueadas.", "warning");
            return false;
        }

        const sourceShift = this.getEmployeeShiftForDate(sourceContext.employeeId, sourceDate);
        if (!sourceShift || (sourceContext.shiftId && sourceShift.id !== sourceContext.shiftId)) {
            showToast("No se encontró el turno de origen.", "warning");
            return false;
        }
        const targetShift = this.getEmployeeShiftForDate(targetContext.employeeId, targetDate);
        if (targetShift) {
            showToast("La celda destino ya tiene un turno. Primero borrá ese turno.", "warning");
            return false;
        }

        const shiftData = { role: sourceShift.role, startSlot: sourceShift.startSlot, endSlot: sourceShift.endSlot };
        const blockingMessage = this.getMonthlyBlockingValidation(targetContext, shiftData);
        if (blockingMessage) {
            showToast(blockingMessage, "error");
            return false;
        }
        const warnings = this.getMonthlyShiftWarnings(targetContext, shiftData, targetWeekId, targetDayIndex);
        if (warnings.length) {
            const confirmed = await showConfirmDialog({
                title: "Advertencias de validación",
                message: `Se detectaron estas advertencias:<br><br>${warnings.map((w) => `• ${w}`).join('<br>')}<br><br>¿Mover igualmente el turno?`
            });
            if (!confirmed) return false;
        }

        const nextSchedules = { ...store.getState().schedules };
        const sourceWeek = { ...(nextSchedules[sourceWeekId] || {}) };
        const targetWeek = sourceWeekId === targetWeekId ? sourceWeek : { ...(nextSchedules[targetWeekId] || {}) };
        const sourceDay = [...(sourceWeek[sourceDayIndex] || [])];
        const sourceDayWithoutMovedShift = sourceDay.filter((shift) => !(shift.employeeId === sourceContext.employeeId && shift.id === sourceShift.id));
        const targetDayBase = sourceWeekId === targetWeekId && sourceDayIndex === targetDayIndex
            ? sourceDayWithoutMovedShift
            : [...(targetWeek[targetDayIndex] || [])];

        sourceWeek[sourceDayIndex] = sourceDayWithoutMovedShift;
        targetWeek[targetDayIndex] = targetDayBase.filter((shift) => shift.employeeId !== targetContext.employeeId).concat([{
            ...sourceShift,
            id: crypto.randomUUID(),
            employeeId: targetContext.employeeId
        }]);

        nextSchedules[sourceWeekId] = sourceWeek;
        nextSchedules[targetWeekId] = targetWeek;
        store.setState({ schedules: nextSchedules, activeDay: targetDayIndex });
        await DataManager.saveWeek(sourceWeekId);
        if (targetWeekId !== sourceWeekId) await DataManager.saveWeek(targetWeekId);
        this.monthlyEditorContext = { ...targetContext };
        showToast("Turno movido correctamente.", "success");
        this.renderMonthlyPlanner();
        if (store.getState().activeView === 'schedule-list') this.renderScheduleList();
        return true;
    },

    copySelectedMonthlyCell() {
        const context = this.monthlyEditorContext;
        if (!context) return;
        const date = new Date(`${context.dateISO}T12:00:00.000Z`);
        const shift = this.getEmployeeShiftForDate(context.employeeId, date);
        this.monthlyClipboard = shift
            ? { role: shift.role, startSlot: shift.startSlot, endSlot: shift.endSlot }
            : null;
        showToast(shift ? "Turno copiado." : "Se copió una celda OFF.", "info");
    },

    async pasteToSelectedMonthlyCell() {
        if (!this.monthlyEditorContext || this.monthlyClipboard === undefined) return;
        const saved = await this.applyMonthlyCellData(this.monthlyEditorContext, this.monthlyClipboard);
        if (saved) showToast("Turno pegado.", "success");
    },

    async applyMonthlyCellData(context, shiftData) {
        const date = new Date(`${context.dateISO}T12:00:00.000Z`);
        const { weekId, dayIndex } = this.getWeekAndDayFromDate(date);
        await DataManager.getWeekData(weekId);
        if (shiftData) {
            const blockingMessage = this.getMonthlyBlockingValidation(context, shiftData);
            if (blockingMessage) {
                showToast(blockingMessage, "error");
                return false;
            }
            const warnings = this.getMonthlyShiftWarnings(context, shiftData, weekId, dayIndex);
            if (warnings.length) {
                const confirmed = await showConfirmDialog({
                    title: "Advertencias de validación",
                    message: `Se detectaron estas advertencias:<br><br>${warnings.map((w) => `• ${w}`).join('<br>')}<br><br>¿Guardar igualmente el turno?`
                });
                if (!confirmed) return false;
            }
        }
        const currentState = store.getState();
        const schedules = { ...currentState.schedules };
        const weekSchedule = { ...(schedules[weekId] || {}) };
        const dayShifts = [...(weekSchedule[dayIndex] || [])];
        const remainingShifts = dayShifts.filter((shift) => shift.employeeId !== context.employeeId);

        if (shiftData) {
            remainingShifts.push({
                id: crypto.randomUUID(),
                employeeId: context.employeeId,
                role: shiftData.role,
                startSlot: shiftData.startSlot,
                endSlot: shiftData.endSlot,
                ignoreRestrictions: false,
            });
        }

        weekSchedule[dayIndex] = remainingShifts;
        schedules[weekId] = weekSchedule;
        store.setState({ schedules });
        await DataManager.saveWeek(weekId);
        this.renderMonthlyPlanner();
        return true;
    },

    getMonthlyBlockingValidation(context, shiftData) {
        const state = store.getState();
        const employee = state.employees.find((emp) => emp.id === context.employeeId);
        if (!employee) return "Empleado no encontrado.";
        const rules = getSchedulingRules();
        if (rules.enforceRoleStar && shiftData.role && !(employee.stars || []).includes(shiftData.role)) {
            return `El empleado no tiene la estrella requerida para ${shiftData.role}.`;
        }
        return "";
    },

    getMonthlyShiftWarnings(context, shiftData, weekId, dayIndex) {
        const warnings = [];
        const state = store.getState();
        const employee = state.employees.find((emp) => emp.id === context.employeeId);
        if (!employee) return ["Empleado no encontrado."];
        const rules = getSchedulingRules();
        const shift = {
            employeeId: context.employeeId,
            role: shiftData.role,
            startSlot: shiftData.startSlot,
            endSlot: shiftData.endSlot,
            ignoreRestrictions: false
        };

        if (rules.enforceAvailability) {
            const availabilityCheck = checkEmployeeAvailability(employee, shift, weekId, dayIndex);
            if (!availabilityCheck.isAvailable) warnings.push(availabilityCheck.reason);
        }

        if (rules.enforceRestTime) {
            const restCheck = checkRestTime(employee.id, shift, weekId, dayIndex, rules.minRestHours);
            if (!restCheck.pass) warnings.push(restCheck.message);
        }

        if (rules.maxConsecutiveDays?.enabled) {
            const weekSchedule = state.schedules[weekId] || {};
            const originalDay = [...(weekSchedule[dayIndex] || [])];
            weekSchedule[dayIndex] = originalDay.filter((s) => s.employeeId !== context.employeeId).concat([{ ...shift }]);
            const consecutiveDays = calculateConsecutiveWorkDays(employee.id, weekId, dayIndex);
            weekSchedule[dayIndex] = originalDay;
            if (consecutiveDays > (rules.maxConsecutiveDays.limit || 5)) {
                warnings.push(`${employee.name} quedaría con ${consecutiveDays} días seguidos (límite ${rules.maxConsecutiveDays.limit}).`);
            }
        }

        return warnings;
    },

    async saveMonthlyEditorCell() {
        const context = this.monthlyEditorContext;
        if (!context) {
            showToast("Primero seleccioná una celda en la grilla.", "warning");
            return;
        }
        const role = el("#monthly-editor-role")?.value || '';
        const startSlot = Number(el("#monthly-editor-start")?.value);
        const method = el("#monthly-editor-method")?.value === 'end' ? 'end' : 'duration';
        this.monthlyTimeMethod = method;
        const durationHours = Number(el("#monthly-editor-duration")?.value);
        const durationSlots = Math.round(durationHours * 2);
        const endSlotByDuration = startSlot + durationSlots - 1;
        const endSlotManual = Number(el("#monthly-editor-end")?.value);
        const endSlot = method === 'end' ? endSlotManual : endSlotByDuration;

        if (!role) {
            showToast("Seleccioná un puesto o usá 'Marcar OFF'.", "warning");
            return;
        }
        if (!Number.isFinite(startSlot)) {
            showToast("Definí una hora de inicio válida.", "warning");
            return;
        }
        if (method === 'duration' && (!Number.isFinite(durationHours) || durationHours <= 0)) {
            showToast("Definí una duración válida.", "warning");
            return;
        }
        if (method === 'end' && (!Number.isFinite(endSlotManual) || endSlotManual < startSlot)) {
            showToast("Definí una hora de salida válida.", "warning");
            return;
        }
        if (!Number.isFinite(endSlot) || endSlot >= SLOTS.length) {
            showToast("El turno calculado supera el horario permitido.", "warning");
            return;
        }

        const saved = await this.applyMonthlyCellData(context, {
            role,
            startSlot,
            endSlot,
        });
        if (saved) showToast("Turno mensual guardado.", "success");
    },

    async clearMonthlyEditorCell() {
        const context = this.monthlyEditorContext;
        if (!context) return;
        const saved = await this.applyMonthlyCellData(context, null);
        if (saved) showToast("Celda marcada como OFF.", "success");
    },

    printDailyPlanning() {
        const schedule = getActiveSchedule();
        const state = store.getState();
        const employees = state.employees;
        const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
        const weekTickets = state.projectedTickets[state.activeWeek] || {};
        const storeLabel = this.escapeHtml(this.getActiveStoreLabel());
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

            pagesHtml += `<div class="page" style="page-break-after:always; margin-bottom: 20px;"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;"><div style="display:flex;align-items:baseline;gap:12px;"><h3 style="margin:4px 0">${formattedDate}</h3><span style="font-size:11px;color:#555;white-space:nowrap;">${statsLabel}</span></div><span style="font-size:12px;font-weight:600;color:#222;white-space:nowrap;">${storeLabel}</span></div><table style="width:100%;border-collapse:collapse;font-size:9px"><thead>${headcountRow}<tr><th>Empleado</th><th>Pos</th><th>Hs</th>${timelineHeader}</tr></thead><tbody>${tableRows}</tbody></table></div>`;
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
            employeeId: null,
            ignoreRestrictions: false
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
        const schedule = getActiveSchedule() || {};

        DAYS.forEach((d,idx) => {
            const container = create("div", { className: 'day-tab-item' });
            const b = create("button", {
                className: "pilltab" + (idx === state.activeDay ? " active" : ""),
                textContent: d,
                onClick: () => { store.setState({ activeDay: idx }); this.render(); }
            });

            const hasUnassigned = Array.isArray(schedule[idx]) && schedule[idx].some(s => !s.employeeId);
            if (hasUnassigned) {
                b.appendChild(create("span", { className: "unassigned-dot", title: "Quedan turnos sin asignar" }));
            }

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

    getEmployeeWeekShifts(employeeId) {
        const days = this.getScheduleDaysArray();
        if (!days || typeof days.forEach !== "function") return [];
        const shifts = [];
        days.forEach((dayShifts, dayIndex) => {
            (dayShifts || []).forEach(s => {
                if (s.employeeId === employeeId) {
                    shifts.push({
                        dayIndex,
                        role: s.role,
                        startSlot: s.startSlot,
                        endSlot: s.endSlot
                    });
                }
            });
        });
        return shifts;
    },

    showEmployeeWeekTooltip(employee, anchor) {
        if (!employee) return;
        const shifts = this.getEmployeeWeekShifts(employee.id);

        this.hideEmployeeWeekTooltip();
        const tooltip = create("div", { className: "employee-week-tooltip card" });
        const content = create("div", { className: "card-c stack", style: { gap: "4px" } });

        if (!shifts.length) {
            content.appendChild(create("div", { className: "muted mini-label", textContent: "Sin turnos en la semana" }));
        } else {
            const maxItems = 8;
            shifts.slice(0, maxItems).forEach(s => {
                const startLabel = SLOTS[s.startSlot]?.label || "";
                const endLabel = SLOTS[s.endSlot + 1]?.label || SLOTS[s.endSlot]?.label || "";
                const dayName = DAYS[s.dayIndex] || "";
                content.appendChild(create("div", {
                    className: "tooltip-row",
                    textContent: `${dayName}: ${startLabel} - ${endLabel} · ${s.role}`
                }));
            });
            if (shifts.length > maxItems) {
                content.appendChild(create("div", { className: "muted mini-label", textContent: `+${shifts.length - maxItems} turnos más` }));
            }
        }

        tooltip.appendChild(content);
        document.body.appendChild(tooltip);
        this.activeTooltipEl = tooltip;
        this.activeTooltipAnchor = anchor;
        this.positionEmployeeWeekTooltip(anchor);
    },

    positionEmployeeWeekTooltip(anchor) {
        if (!this.activeTooltipEl || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        this.activeTooltipEl.style.position = "absolute";
        this.activeTooltipEl.style.zIndex = "2000";
        this.activeTooltipEl.style.left = `${rect.left + window.scrollX}px`;
        this.activeTooltipEl.style.top = `${rect.bottom + window.scrollY + 6}px`;
    },

    hideEmployeeWeekTooltip() {
        if (this.activeTooltipEl?.parentNode) {
            this.activeTooltipEl.parentNode.removeChild(this.activeTooltipEl);
        }
        this.activeTooltipEl = null;
        this.activeTooltipAnchor = null;
    },

    getScheduleDaysArray(scheduleOverride) {
        const schedule = scheduleOverride ?? getActiveSchedule();
        const days = Array.from({ length: 7 }, (_, i) => {
            const direct = schedule?.[i];
            if (Array.isArray(direct)) return direct;
            return [];
        });
        return days;
    },

    isWeekLocked() {
        const schedule = getActiveSchedule();
        return !!schedule?.isLocked;
    },

    suggestShiftsForProductivity(targetProductivity = 6.5) {
        if (this.isWeekLocked()) {
            showToast("La semana está bloqueada. Solo podés ver los turnos.", "warning");
            return;
        }

        const state = store.getState();
        const projectedTickets = Number((state.projectedTickets[state.activeWeek] || {})[state.activeDay] || 0);
        if (!projectedTickets || projectedTickets <= 0) {
            showToast("Ingresá tickets proyectados para el día.", "warning");
            return;
        }

        const dayIndex = state.activeDay;

        const median = arr => {
            if (!arr || !arr.length) return null;
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };

        const generateForTarget = (targetProd) => {
            const requiredHours = projectedTickets / targetProd;
            if (!Number.isFinite(requiredHours) || requiredHours <= 0) return null;

            const roleHours = {};
            const roleStartCount = {};
            const roleShiftLengths = {};
            const globalStartCount = {};
            const schedules = state.schedules || {};
            Object.entries(schedules).forEach(([weekKey, weekData]) => {
                if (weekKey === state.activeWeek || !weekData) return;
                const dayShifts = weekData[dayIndex] || [];
                dayShifts.forEach(shift => {
                    if (shift.startSlot === undefined || shift.endSlot === undefined) return;
                    const hours = (shift.endSlot - shift.startSlot + 1) / 2;
                    if (hours > 0) {
                        roleHours[shift.role] = (roleHours[shift.role] || 0) + hours;
                        roleShiftLengths[shift.role] = roleShiftLengths[shift.role] || [];
                        roleShiftLengths[shift.role].push(hours);
                    }
                    roleStartCount[shift.role] = roleStartCount[shift.role] || {};
                    roleStartCount[shift.role][shift.startSlot] = (roleStartCount[shift.role][shift.startSlot] || 0) + 1;
                    globalStartCount[shift.startSlot] = (globalStartCount[shift.startSlot] || 0) + 1;
                });
            });

            const totalRoleHours = Object.values(roleHours).reduce((a, b) => a + b, 0);
            const availableRoles = state.roles?.length ? state.roles.map(r => r.key) : ROLES.map(r => r.key);
            const roleWeights = {};
            if (totalRoleHours > 0) {
                availableRoles.forEach(r => {
                    roleWeights[r] = (roleHours[r] || 0) / totalRoleHours;
                });
            } else {
                const even = availableRoles.length ? 1 / availableRoles.length : 0;
                availableRoles.forEach(r => roleWeights[r] = even);
            }

            const fallbackStart = (() => {
                const sorted = Object.entries(globalStartCount).sort((a, b) => b[1] - a[1]);
                if (sorted.length) return Number(sorted[0][0]);
                return SLOTS.find(s => s.label === "09:00")?.index ?? 18;
            })();

            const hoursPerRole = {};
            availableRoles.forEach(r => {
                hoursPerRole[r] = requiredHours * (roleWeights[r] || 0);
            });

            const schedule = getActiveSchedule();
            this.ensureDay(dayIndex);

            const suggested = [];
            let totalSuggestedHours = 0;
            availableRoles.forEach(role => {
                let remaining = hoursPerRole[role] || 0;
                if (remaining <= 0) return;

                const roleMedian = median(roleShiftLengths[role] || []) || 6;
                const shiftSlotLength = Math.max(1, Math.round(roleMedian * 2));

                const startSlots = Object.entries(roleStartCount[role] || {})
                    .sort((a, b) => b[1] - a[1])
                    .map(([slot]) => Number(slot));

                // Seed shift en el horario más frecuente del rol para respetar patrones típicos del día (ej. descarga 06:00 martes/sábado)
                if (startSlots.length && totalSuggestedHours < requiredHours - 0.25 && remaining > 0) {
                    const startSlot = startSlots[0];
                    const endSlot = Math.min(SLOTS.length - 1, startSlot + shiftSlotLength - 1);
                    const hours = (endSlot - startSlot + 1) / 2;
                    suggested.push({
                        id: crypto.randomUUID(),
                        role,
                        startSlot,
                        endSlot,
                        employeeId: null
                    });
                    remaining -= hours;
                    totalSuggestedHours += hours;
                }

                let idx = 0;
                while (remaining > 0 && totalSuggestedHours < requiredHours - 0.25) {
                    const startSlot = startSlots.length ? startSlots[idx % startSlots.length] : fallbackStart;
                    let endSlot = Math.min(SLOTS.length - 1, startSlot + shiftSlotLength - 1);
                    let hours = (endSlot - startSlot + 1) / 2;

                    const remainingGlobal = requiredHours - totalSuggestedHours;
                    if (hours > remainingGlobal && remainingGlobal > 0.5) {
                        const allowedSlots = Math.max(1, Math.round(remainingGlobal * 2));
                        endSlot = Math.min(SLOTS.length - 1, startSlot + allowedSlots - 1);
                        hours = (endSlot - startSlot + 1) / 2;
                    } else if (hours > remainingGlobal && remainingGlobal <= 0.5) {
                        break;
                    }

                    suggested.push({
                        id: crypto.randomUUID(),
                        role,
                        startSlot,
                        endSlot,
                        employeeId: null
                    });

                    remaining -= hours;
                    totalSuggestedHours += hours;
                    idx++;
                }
            });

            if (!suggested.length) return null;
            const estimatedProductivity = projectedTickets / totalSuggestedHours;
            return { suggested, totalSuggestedHours, requiredHours, estimatedProductivity, targetProd };
        };

        const targets = [6.5, 6.4];
        let result = null;
        let usedTarget = null;
        for (const target of targets) {
            const attempt = generateForTarget(target);
            if (attempt && attempt.estimatedProductivity >= target - 0.05) {
                result = attempt;
                usedTarget = target;
                break;
            }
            if (!result || (attempt && attempt.estimatedProductivity > result.estimatedProductivity)) {
                result = attempt;
                usedTarget = target;
            }
        }

        if (!result || !result.suggested?.length) {
            showToast("No se pudieron generar turnos sugeridos.", "warning");
            return;
        }

        showConfirmDialog({
            title: "Sugerencia de turnos",
            message: `Tickets proyectados: ${projectedTickets}<br>Meta de productividad: ${usedTarget.toFixed(1)}<br>Horas objetivo: ${(projectedTickets / usedTarget).toFixed(1)}hs<br>Horas sugeridas: ${result.totalSuggestedHours.toFixed(1)}hs<br>Prod. estimada: ${result.estimatedProductivity.toFixed(2)}<br><br>¿Agregar los turnos sugeridos al día?`
        }).then(confirmed => {
            if (!confirmed) return;
            const schedule = getActiveSchedule();
            this.ensureDay(state.activeDay);
            this.commitChange(() => {
                schedule[state.activeDay].push(...result.suggested);
            });
            showToast("Turnos sugeridos agregados.", "success");
        });
    },

    updateScheduleFiltersUI() {
        const state = store.getState();
        const searchInput = el("#schedule-search");
        const roleSelect = el("#schedule-role-filter");
        const scheduleListSearch = el("#schedule-list-search");

        if (searchInput && searchInput.value !== (state.scheduleSearchTerm || "")) {
            searchInput.value = state.scheduleSearchTerm || "";
        }

        if (roleSelect) {
            const selectedValues = new Set(state.scheduleRoleFilters || []);
            Array.from(roleSelect.options).forEach(opt => {
                opt.selected = selectedValues.has(opt.value);
            });
        }

        if (scheduleListSearch && scheduleListSearch.value !== (state.scheduleSearchTerm || "")) {
            scheduleListSearch.value = state.scheduleSearchTerm || "";
        }
    },

    updateScheduleListFiltersUI() {
        const state = store.getState();

        const searchInput = el("#schedule-list-search");
        if (searchInput && searchInput.value !== (state.scheduleSearchTerm || "")) {
            searchInput.value = state.scheduleSearchTerm || "";
        }

        const container = el("#schedule-list-multi-container");
        const searchBox = el("#schedule-list-multi-search");
        if (searchBox && searchBox.value !== (state.scheduleSelectedEmployeeSearch || "")) {
            searchBox.value = state.scheduleSelectedEmployeeSearch || "";
        }
        if (!container) return;

        const selectedSet = new Set((state.scheduleSelectedEmployeeIds || []).map(String));
        const searchTerm = (state.scheduleSelectedEmployeeSearch || '').toLowerCase().trim();
        clear(container);

        const employees = state.employees.slice().sort((a, b) => (a.displayName || a.name || '').localeCompare(b.displayName || b.name || ''));
        employees
        .filter(emp => {
            if (!searchTerm) return true;
            const display = (emp.displayName || '').toLowerCase();
            const full = (emp.name || '').toLowerCase();
            return display.includes(searchTerm) || full.includes(searchTerm);
        })
        .forEach(emp => {
            const checkbox = create("input", {
                type: "checkbox",
                className: "schedule-list-multi-checkbox",
                value: String(emp.id),
                checked: selectedSet.has(String(emp.id))
            });
            const label = create("label", {
                className: "row",
                style: { gap: "8px", alignItems: "center" }
            });
            label.appendChild(checkbox);

            const textStack = create("div", { className: "stack", style: { gap: "2px" } });
            textStack.appendChild(create("div", { textContent: emp.displayName || emp.name || "" }));
            if (emp.displayName && emp.name && emp.displayName !== emp.name) {
                textStack.appendChild(create("div", { className: "muted", style: { fontSize: "12px" }, textContent: emp.name }));
            }

            label.appendChild(textStack);
            container.appendChild(label);
        });
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
            scheduleTbody.style.pointerEvents = 'auto'; // permitir tooltip
            scheduleTbody.style.opacity = 1;
        }

        const scheduleTable = document.querySelector('#view-schedule .table');
        if (scheduleTable) {
            scheduleTable.style.border = isLocked ? '2px solid var(--c-danger, #e53e3e)' : '';
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
        const periodEnd = new Date(monday);
        periodEnd.setDate(monday.getDate() + this.getSchedulingPeriodDays() - 1);

        const format = (d) => `${d.getDate()}/${d.getMonth()+1}`;
        btn.textContent = `${format(monday)} - ${format(periodEnd)}`;

        this.ensureSavingIndicator();
        this.setSavingStatus(false);
    },

    renderWeeklyStats() {
        const statsContainer = el("#weekly-stats-container");
        if (!statsContainer) return;

        // Calculate stats
        const state = store.getState();
        let totalHours = 0;
        let totalTickets = 0;

        const periodDays = this.getSchedulingPeriodDays();
        for (let dayOffset = 0; dayOffset < periodDays; dayOffset++) {
            const weekId = this.getWeekIdByDayOffset(dayOffset);
            const dayIndex = this.getDayIndexByOffset(dayOffset);
            const weekData = state.schedules[weekId] || {};
            const dayShifts = weekData[dayIndex] || [];
            dayShifts.forEach(shift => {
                totalHours += (shift.endSlot - shift.startSlot + 1) / 2;
            });
            const weekTickets = state.projectedTickets[weekId] || {};
            totalTickets += Number(weekTickets[dayIndex] || 0);
        }

        const productivity = totalHours > 0 ? (totalTickets / totalHours).toFixed(1) : "-";

        clear(statsContainer);

        const stats = [
            { label: 'Hs', value: `${String(totalHours).replace('.', ',')}hs` },
            { label: 'Tkts', value: `${totalTickets}` },
            { label: 'Prod', value: productivity }
        ];

        stats.forEach(stat => {
            const pill = create("div", { className: "weekly-stat-pill" });
            pill.innerHTML = `<span class="muted">${stat.label}</span><strong>${stat.value}</strong>`;
            statsContainer.appendChild(pill);
        });
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

    async autoAssignShifts() {
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
            showToast("No hay turnos vacíos para asignar.", "info");
            return;
        }

        const confirmed = await showConfirmDialog({
            title: "Autoasignar turnos",
            message: `Se encontraron ${totalUnassigned.length} turnos vacíos.<br><br>El sistema asignará turnos respetando:<br>1. Mínimo de 14hs semanales.<br>2. Prioridad (Muy Alta > Muy Baja).<br>3. Menor carga horaria actual.<br><br>¿Continuar?`
        });
        if (!confirmed) {
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
             const rules = getSchedulingRules();
             // Logic from canEmployeeWorkShift using our imported utils
             // 1. Sanction
             const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
             const shiftDate = new Date(weekMonday);
             shiftDate.setUTCDate(weekMonday.getUTCDate() + day);

             if (rules.enforceSanctions && isDateInSanctionPeriod(shiftDate, emp.sanctions)) return false;

             // 2. Minor
             if (rules.enforceMinorNightLimit && emp.isMinor && shift.endSlot > MAX_SLOT_FOR_MINOR) return false;

             // 3. Star
             if (rules.enforceRoleStar && !(emp.stars || []).includes(shift.role)) return false;

             // 4. Availability
             if (rules.enforceAvailability) {
                 const availCheck = checkEmployeeAvailability(emp, shift, state.activeWeek, day);
                 if (!availCheck.isAvailable) return false;
             }

             // 5. Overlap
             if (rules.enforceOverlap) {
                 const overlapCheck = checkShiftOverlap(emp.id, shift, day);
                 if (!overlapCheck.pass) return false;
             }

             // 6. Rest Time
             if (rules.enforceRestTime) {
                 const restCheck = checkRestTime(emp.id, shift, state.activeWeek, day, rules.minRestHours);
                 if (!restCheck.pass) return false;
             }

             // 7. Consecutive Days (configurable per local)
             const consecutiveRule = rules.maxConsecutiveDays;
             const consec = calculateConsecutiveWorkDays(emp.id, state.activeWeek, day);
             if (consecutiveRule.enabled && consec > consecutiveRule.limit) return false;

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

        showAlertDialog({
            title: "Autoasignación completada",
            message: `Asignados: ${assignedCount}<br>Sin candidato válido: ${skippedCount}`
        });
    },


    openAssignEmployeeModal(shiftId) {
        const state = store.getState();
        const day = state.activeDay;
        this.ensureDay(day);
        const schedule = getActiveSchedule();
        const shift = schedule[day].find(s => s.id === shiftId);
        if (!shift) { showToast("No se encontró el turno.", "error"); return; }

        const wrap = create("div", { style: { position:"fixed", inset:"0", background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", zIndex:1000 }});
        const box = create("div", { className:"card", style:{ maxWidth:"600px", width:"100%" } });

        box.appendChild(create("div", { className:"card-h", innerHTML: `<strong>Asignar empleado a ${shift.role}</strong>` }));

        const c = create("div", { className:"card-c stack" });
        const listContainer = create("div", { className:"assign-employee-list", style: { maxHeight: "400px", overflowY: "auto" } });
        const ignoreRestrictions = !!shift.ignoreRestrictions;

        if (ignoreRestrictions) {
            c.appendChild(create("div", { className: "warning-text", style: { marginBottom: "8px" }, textContent: "Este turno ignora la disponibilidad y el descanso mínimo." }));
        }

        c.appendChild(listContainer);

        const activeRules = getSchedulingRules();
        const employeesWithStar = state.employees.filter(e => !activeRules.enforceRoleStar || (e.stars || []).includes(shift.role));
        const candidates = ignoreRestrictions ? state.employees : employeesWithStar;

        if (candidates.length === 0) {
            listContainer.textContent = ignoreRestrictions
                ? "No hay empleados para asignar."
                : (activeRules.enforceRoleStar ? "No hay empleados con la estrella requerida." : "No hay empleados para asignar.");
        } else {
            // Logic for sorting and checking warnings
            const available = [];
            const withWarnings = [];
            const unavailable = [];
            const shiftDate = new Date(state.activeWeek + "T12:00:00Z");
            shiftDate.setDate(shiftDate.getDate() + day);

            const evaluateEmployee = (emp) => {
                const rules = getSchedulingRules();
                const isMinor = emp.isMinor;
                const sanctionCheck = rules.enforceSanctions && isDateInSanctionPeriod(shiftDate, emp.sanctions);

                let hardWarning = "";
                if(sanctionCheck) hardWarning = "Licencia/Sanción activa.";
                else if (rules.enforceMinorNightLimit && isMinor && shift.endSlot > MAX_SLOT_FOR_MINOR) hardWarning = "Menor no puede trabajar tarde.";

                if (rules.enforceOverlap) {
                    const overlapCheck = checkShiftOverlap(emp.id, shift, day);
                    if(!overlapCheck.pass) hardWarning = overlapCheck.message;
                }

                if (rules.enforceRestTime) {
                    const restCheck = checkRestTime(emp.id, shift, state.activeWeek, day, rules.minRestHours);
                    if(!restCheck.pass) hardWarning = restCheck.message;
                }

                // Warnings
                const softWarnings = [];
                if (rules.enforceAvailability) {
                    const availCheck = checkEmployeeAvailability(emp, shift, state.activeWeek, day);
                    if(!availCheck.isAvailable) softWarnings.push(availCheck.reason);
                }

                const consecutiveRule = rules.maxConsecutiveDays;
                const consec = calculateConsecutiveWorkDays(emp.id, state.activeWeek, day);
                if (consecutiveRule.enabled && consec > consecutiveRule.limit) {
                    softWarnings.push(`Trabajará ${consec} días seguidos (límite ${consecutiveRule.limit}).`);
                }

                return { hardWarning, softWarnings };
            };

            candidates.forEach(emp => {
                const { hardWarning, softWarnings } = evaluateEmployee(emp);
                const hasRoleStar = (emp.stars || []).includes(shift.role);

                if (ignoreRestrictions) {
                    const infoWarnings = [];
                    if (!hasRoleStar) infoWarnings.push('Sin estrella para el rol.');
                    if (hardWarning) infoWarnings.push(hardWarning);
                    if (softWarnings.length > 0) infoWarnings.push(softWarnings.join('. '));
                    available.push({ emp, hardWarning: infoWarnings.filter(Boolean).join(' ') });
                } else if (hardWarning) {
                    unavailable.push({ emp, hardWarning });
                } else if (softWarnings.length > 0) {
                    withWarnings.push({ emp, softWarnings });
                } else {
                    available.push({ emp, hardWarning: "" });
                }
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
                    btn.onclick = async () => {
                        if(warningText) {
                            const confirmed = await showConfirmDialog({
                                title: "Asignar con advertencias",
                                message: `${warningText.replace(/\n/g, "<br>")}<br><br>¿Asignar de todos modos?`
                            });
                            if(!confirmed) return;
                        }
                        this.commitChange(() => { shift.employeeId = emp.id; });
                        wrap.remove();
                    };
                }
                listContainer.appendChild(btn);
            };

            available.forEach(x => renderBtn(x, false, x.hardWarning || ""));
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

        const ignoreRestrictionsCheckbox = create("input", { type: "checkbox", id: "ignore-restrictions-checkbox", checked: !!shift.ignoreRestrictions });
        const ignoreLabel = create("label", { htmlFor: "ignore-restrictions-checkbox", textContent: "Ignorar restricciones" });
        const ignoreHint = create("div", { className: "muted", style: { fontSize: "12px", marginTop: "4px" }, textContent: "Permite asignar sin validar disponibilidad ni descanso." });

        c.appendChild(create("label", { className:"muted", textContent: "Rol" }));
        c.appendChild(roleSelect);
        c.appendChild(create("label", { className:"muted", textContent: "Inicio" }));
        c.appendChild(startSelect);
        c.appendChild(create("label", { className:"muted", textContent: "Fin" }));
        c.appendChild(endSelect);
        const ignoreRow = create("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" } });
        ignoreRow.appendChild(ignoreRestrictionsCheckbox);
        ignoreRow.appendChild(ignoreLabel);
        c.appendChild(ignoreRow);
        c.appendChild(ignoreHint);

        box.appendChild(c);

        const f = create("div", { style: { textAlign:"right", marginTop:"12px", padding: "12px", gap: "8px", display: "flex", justifyContent: "flex-end" } });
        f.appendChild(create("button", { className:"btn secondary", textContent:"Cancelar", onClick: () => wrap.remove() }));
        f.appendChild(create("button", { className:"btn", textContent:"Guardar", onClick: () => {
            const newStart = Number(startSelect.value);
            const newEnd = Number(endSelect.value);
            if (newEnd <= newStart) { showToast("Fin debe ser mayor a Inicio", "warning"); return; }

            this.commitChange(() => {
                shift.role = roleSelect.value;
                shift.startSlot = newStart;
                shift.endSlot = newEnd - 1;
                shift.ignoreRestrictions = !!ignoreRestrictionsCheckbox.checked;
            });
            wrap.remove();
        }}));
        box.appendChild(f);

        wrap.appendChild(box);
        document.body.appendChild(wrap);
    },

    getDayRestrictionInfo(employee, shiftDate, shiftDateString) {
        if (!employee) return { blocked: false, reason: '' };
        const rules = getSchedulingRules();

        if (rules.enforceSanctions && isDateInSanctionPeriod(shiftDate, employee.sanctions)) {
            return { blocked: true, reason: 'Licencia activa' };
        }

        const hasFullDayException = (employee.exceptions || []).some(ex => ex.date === shiftDateString && !ex.start && !ex.end);
        if (hasFullDayException) {
            return { blocked: true, reason: 'Excepción de día completo' };
        }

        return { blocked: false, reason: '' };
    },

    async renderScheduleList() {
        const content = el("#schedule-list-content");
        if(!content) return;
        clear(content);

        this.updateScheduleListFiltersUI();

        const state = store.getState();
        const schedule = getActiveSchedule();
        if(!schedule) return;

        if (this.getSchedulingPeriodWeeks() === 4) {
            await this.renderMonthlyScheduleList(content);
            return;
        }

        if (this.isWeekLocked()) {
            content.classList.add("locked-view");
        } else {
            content.classList.remove("locked-view");
        }

        const searchTerm = (state.scheduleSearchTerm || '').toLowerCase().trim();
        const selectedIds = new Set((state.scheduleSelectedEmployeeIds || []).map(String));

        const employees = state.employees
            .filter(emp => this.getEmployeeWeeklyHours(emp.id) > 0)
            .filter(emp => emp.name.toLowerCase().includes(searchTerm))
            .filter(emp => selectedIds.size === 0 || selectedIds.has(String(emp.id)))
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
                    const ignoreTag = shift.ignoreRestrictions ? '<div class="muted" style="font-size: 10px;">Ignora restricciones</div>' : '';
                    const shiftDiv = create("div", {
                        className: "schedule-list-shift unassigned-shift-item",
                        dataset: { shiftId: shift.id, dayIndex: dayIndex },
                        draggable: true,
                        innerHTML: `<div style="font-weight: 500;">${shift.role}</div><div style="font-size: 11px;">${SLOTS[shift.startSlot].label} - ${SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00"}</div>${ignoreTag}`
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
                const shiftDate = new Date(weekMonday);
                shiftDate.setDate(weekMonday.getDate() + dayIndex);
                const shiftDateString = toISODateString(shiftDate);

                const restrictionInfo = this.getDayRestrictionInfo(emp, shiftDate, shiftDateString);
                let warningContainer = null;
                if (restrictionInfo.blocked) {
                    dayCell.classList.add("warning-cell");
                    warningContainer = create("div", { className: "warning-cell-content", title: restrictionInfo.reason });
                    warningContainer.innerHTML = `<div>⚠️ No disponible</div><span>${restrictionInfo.reason}</span>`;
                    dayCell.appendChild(warningContainer);
                }

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
                        const ignoreTag = shift.ignoreRestrictions ? '<div class="muted" style="font-size: 10px;">Ignora restricciones</div>' : '';
                        let shiftText = `<div style="font-weight: 500;">${shift.role}</div><div style="font-size: 11px;">${startTime} - ${endTime}</div>${ignoreTag}`;

                        if (shift.replacement && shift.replacement.originalEmployeeId) {
                            const originalEmp = state.employees.find(e => e.id === shift.replacement.originalEmployeeId);
                            if(originalEmp) {
                                const originalName = originalEmp.displayName || originalEmp.name.split(' ')[0];
                                shiftText += `<div style="font-size: 10px; font-style: italic; margin-top: 2px;">(cubre a ${this.escapeHtml(originalName)})</div>`;
                            }
                        }
                        shiftDiv.innerHTML = shiftText;

                        // Day restriction visual
                        if (restrictionInfo.blocked && !shift.replacement) {
                            shiftDiv.style.border = `2px solid var(--c-danger)`;
                            shiftDiv.title = restrictionInfo.reason;
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
                    if (warningContainer) {
                        warningContainer.appendChild(shiftsContainer);
                    } else {
                        dayCell.appendChild(shiftsContainer);
                    }
                }
                this.addDropListeners(dayCell);
                row.appendChild(dayCell);
            }
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        content.appendChild(table);
    },

    async renderMonthlyScheduleList(content) {
        const state = store.getState();
        const monthValue = this.getMonthlySelectedMonth();
        await this.preloadMonthWeeks(monthValue);
        const dates = this.getDatesForNaturalMonth(monthValue);
        const searchTerm = (state.scheduleSearchTerm || '').toLowerCase().trim();
        const selectedIds = new Set((state.scheduleSelectedEmployeeIds || []).map(String));

        const employeeHasShift = (employeeId) => dates.some((date) => !!this.getEmployeeShiftForDate(employeeId, date));
        const employees = state.employees
            .filter((emp) => employeeHasShift(emp.id))
            .filter((emp) => (emp.name || '').toLowerCase().includes(searchTerm))
            .filter((emp) => selectedIds.size === 0 || selectedIds.has(String(emp.id)))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const hasUnassigned = dates.some((date) => {
            const { weekId, dayIndex } = this.getWeekAndDayFromDate(date);
            return (store.getState().schedules[weekId]?.[dayIndex] || []).some((shift) => !shift.employeeId);
        });

        if (employees.length === 0 && !hasUnassigned) {
            content.appendChild(create("p", { className: "muted", textContent: "No hay empleados ni turnos para mostrar en el mes seleccionado." }));
            return;
        }

        const table = create("table", { className: "schedule-list-table schedule-list-monthly-table" });
        const thead = create("thead");
        const headerRow = create("tr");
        headerRow.appendChild(create("th", { textContent: "Empleado", className: "employee-name-cell" }));
        dates.forEach((date) => {
            const dayName = date.toLocaleDateString('es-AR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '').toUpperCase();
            headerRow.appendChild(create("th", { innerHTML: `${dayName}<br><span class="muted" style="font-size:10px;">${date.getUTCDate()}/${date.getUTCMonth() + 1}</span>` }));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = create("tbody");
        if (hasUnassigned) {
            const unassignedRow = create("tr", { dataset: { employeeId: "unassigned" } });
            unassignedRow.appendChild(create("td", { innerHTML: `<div style="font-weight: 500; font-style: italic;">Turnos sin Asignar</div>` }));
            dates.forEach((date) => {
                const cell = create("td");
                const dateISO = toISODateString(date);
                const { weekId, dayIndex } = this.getWeekAndDayFromDate(date);
                const shifts = (store.getState().schedules[weekId]?.[dayIndex] || []).filter((shift) => !shift.employeeId);
                shifts.forEach((shift) => {
                    const shiftDiv = create("div", {
                        className: "schedule-list-shift unassigned-shift-item",
                        draggable: true,
                        innerHTML: `<div style="font-weight:500;">${this.escapeHtml(shift.role || '')}</div><div style="font-size:11px;">${SLOTS[shift.startSlot]?.label || ''} - ${SLOTS[shift.endSlot + 1]?.label || '02:00'}</div>`
                    });
                    shiftDiv.addEventListener('dragstart', (event) => this.handleMonthlyCellDragStart(event, shift, null, dateISO));
                    shiftDiv.addEventListener('dragend', () => { shiftDiv.style.opacity = '1'; });
                    cell.appendChild(shiftDiv);
                });
                this.addMonthlyListDropListeners(cell, "unassigned", date);
                unassignedRow.appendChild(cell);
            });
            tbody.appendChild(unassignedRow);
        }

        employees.forEach((emp) => {
            const row = create("tr", { dataset: { employeeId: emp.id } });
            row.appendChild(create("td", { className: "employee-name-cell", textContent: emp.name || 'Sin nombre' }));
            dates.forEach((date) => {
                const cell = create("td");
                const dateISO = toISODateString(date);
                const shift = this.getEmployeeShiftForDate(emp.id, date);
                if (shift) {
                    const roleInfo = this.getRoleList().find((role) => role.key === shift.role);
                    const shiftDiv = create("div", {
                        className: "schedule-list-shift",
                        draggable: true,
                        innerHTML: `<div style="font-weight:500;">${this.escapeHtml(shift.role || '')}</div><div style="font-size:11px;">${SLOTS[shift.startSlot]?.label || ''} - ${SLOTS[shift.endSlot + 1]?.label || '02:00'}</div>`
                    });
                    if (roleInfo) {
                        shiftDiv.style.backgroundColor = roleInfo.color;
                        shiftDiv.style.color = roleInfo.darkText ? '#111' : '#fff';
                    }
                    shiftDiv.addEventListener('dragstart', (event) => this.handleMonthlyCellDragStart(event, shift, emp.id, dateISO));
                    shiftDiv.addEventListener('dragend', () => { shiftDiv.style.opacity = '1'; });
                    shiftDiv.addEventListener('contextmenu', (event) => this.openMonthlyContextMenu(event, emp, date));
                    cell.appendChild(shiftDiv);
                } else {
                    cell.classList.add('monthly-off-cell');
                    cell.textContent = 'OFF';
                }
                this.addMonthlyListDropListeners(cell, emp.id, date);
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        content.appendChild(table);
    },

    addMonthlyListDropListeners(cell, targetEmployeeId, targetDate) {
        cell.addEventListener('dragover', (event) => {
            event.preventDefault();
            cell.classList.add('drag-over');
            event.dataTransfer.dropEffect = 'move';
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
        cell.addEventListener('drop', async (event) => {
            event.preventDefault();
            cell.classList.remove('drag-over');
            let payload = null;
            try {
                payload = JSON.parse(event.dataTransfer.getData('text/plain'));
            } catch {
                return;
            }
            if (!payload || payload.mode !== 'monthly') return;
            const source = { employeeId: payload.sourceEmployeeId, dateISO: payload.sourceDateISO, shiftId: payload.shiftId };
            if (targetEmployeeId === 'unassigned') {
                await this.unassignMonthlyShift(source);
                return;
            }
            const target = { employeeId: targetEmployeeId, dateISO: toISODateString(targetDate) };
            await this.moveMonthlyShift(source, target);
        });
    },

    async unassignMonthlyShift(sourceContext) {
        if (!sourceContext?.employeeId || !sourceContext?.dateISO) return;
        const sourceDate = new Date(`${sourceContext.dateISO}T12:00:00.000Z`);
        const sourceShift = this.getEmployeeShiftForDate(sourceContext.employeeId, sourceDate);
        if (!sourceShift) return;
        const { weekId, dayIndex } = this.getWeekAndDayFromDate(sourceDate);
        await DataManager.getWeekData(weekId);
        const nextSchedules = { ...store.getState().schedules };
        const weekSchedule = { ...(nextSchedules[weekId] || {}) };
        const dayShifts = [...(weekSchedule[dayIndex] || [])];
        weekSchedule[dayIndex] = dayShifts.map((shift) => (shift.id === sourceShift.id ? { ...shift, employeeId: null } : shift));
        nextSchedules[weekId] = weekSchedule;
        store.setState({ schedules: nextSchedules, activeDay: dayIndex });
        await DataManager.saveWeek(weekId);
        showToast("Turno desasignado.", "success");
        if (store.getState().activeView === 'schedule-list') this.renderScheduleList();
        else this.renderMonthlyPlanner();
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
            if (this.isWeekLocked()) {
                showToast("La semana está bloqueada. Solo podés ver los turnos.", "warning");
                return;
            }
            const sourceShift = schedule[sourceDayIndex]?.find(s => s.id === sourceShiftId);
            if (!sourceShift) return;

            const state = store.getState();
            const weekId = state.activeWeek;
            this.ensureDay(sourceDayIndex);
            this.ensureDay(targetDayIndex);

            // Scenario 1: Unassign
            if (targetEmployeeId === 'unassigned') {
                if (!sourceShift.employeeId) return;
                this.commitChange(() => {
                    sourceShift.employeeId = null;
                });
                return;
            }

            const targetEmployee = state.employees.find(e => e.id === targetEmployeeId);
            if (!targetEmployee) return;

            // Scenario 2: Swap
            if (targetShiftElement) {
                const targetShiftId = targetShiftElement.dataset.shiftId;
                if (sourceShiftId === targetShiftId) return;

                const targetShift = schedule[targetDayIndex]?.find(s => s.id === targetShiftId);
                const sourceEmployee = state.employees.find(e => e.id === sourceShift.employeeId);
                if (!targetShift || !targetShift.employeeId || !sourceEmployee) return;

                const validationForTarget = this.validateShiftForEmployee(targetEmployee, sourceShift, targetDayIndex, weekId, [targetShift.id]);
                if (!validationForTarget.pass) {
                    showToast(validationForTarget.message, "error");
                    return;
                }

                const validationForSource = this.validateShiftForEmployee(sourceEmployee, targetShift, sourceDayIndex, weekId, [sourceShift.id]);
                if (!validationForSource.pass) {
                    showToast(validationForSource.message, "error");
                    return;
                }

                this.commitChange(() => {
                    [targetShift.employeeId, sourceShift.employeeId] = [sourceShift.employeeId, targetShift.employeeId];
                });
                return;
            }

            // Scenario 3: Move/Assign
            const sourceEmployeeId = sourceShift.employeeId;
            if (sourceEmployeeId === targetEmployeeId && sourceDayIndex === targetDayIndex) return;

            const validation = this.validateShiftForEmployee(targetEmployee, sourceShift, targetDayIndex, weekId, [sourceShift.id]);
            if (!validation.pass) {
                showToast(validation.message, "error");
                return;
            }

            this.commitChange(() => {
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
                    sourceShift.employeeId = targetEmployee.id;
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

    async handleSlotClick(shift, slotIndex) {
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
                const confirmed = await showConfirmDialog({
                    title: "Celda no disponible",
                    message: confirmMessage
                });
                if (!confirmed) return;
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
            gridTemplateColumns: `240px repeat(${SLOTS.length}, minmax(28px, 1fr))`
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
