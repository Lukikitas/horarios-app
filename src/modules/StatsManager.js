import { el, create, clear } from '../utils/dom.js';
import { store, getActiveSchedule } from '../store/Store.js';
import { DAYS, SLOTS } from '../config.js';
import { toISODateString, getMonday } from '../utils/date.js';
import { ScheduleManager } from './ScheduleManager.js';
import { DataManager } from '../services/DataManager.js';
import { showToast } from '../utils/feedback.js';

export const StatsManager = {
    init() {
        this.bindEvents();
    },

    bindEvents() {
        el("#btn-weekly-summary")?.addEventListener("click", () => {
            this.renderWeeklySummary();
            el("#weekly-summary-modal").style.display = "flex";
        });
        el("#weekly-summary-modal-close")?.addEventListener("click", () => {
            el("#weekly-summary-modal").style.display = "none";
        });

        el("#weekly-summary-sort")?.addEventListener("change", (e) => {
            store.setState({ weeklySummarySort: e.target.value });
            this.renderWeeklySummary();
        });

        // Francos is just a view render, handled by UIManager triggering render()

        // Clock Ins
        el("#fileImportClockIns")?.addEventListener("change", (e) => this.importClockIns(e));
        el("#clockInSearch")?.addEventListener("input", (e) => {
            store.setState({ clockInSearchTerm: e.target.value });
            this.renderClockInReport();
        });
        el("#clockInSort")?.addEventListener("change", (e) => {
            store.setState({ clockInSortOrder: e.target.value });
            this.renderClockInReport();
        });
        el("#clockInDateFilter")?.addEventListener("change", (e) => {
            store.setState({ clockInDateFilter: e.target.value || null });
            this.renderClockInReport();
        });

        // Planilla Turno Listeners
        el("#btn-edit-planilla")?.addEventListener("click", () => this.togglePlanillaEdit());
        el("#btn-print-planilla")?.addEventListener("click", () => window.print());
        el("#btn-edit-breaks")?.addEventListener("click", () => this.toggleBreaksEdit());
        el("#planilla-date-picker")?.addEventListener("change", () => {
            store.setState({ tempPlanillaState: null });
            const btn = el("#btn-edit-planilla");
            if (btn) {
                btn.textContent = "Editar Planilla";
                btn.classList.remove("btn-primary", "btn-secondary");
                btn.classList.add("btn-secondary");
            }
            this.renderPlanillaTurno(false);
        });
        el("#rappi-code-input")?.addEventListener("input", (e) => {
            store.setState({ rappiCode: e.target.value });
            if(el("#rappi-code-print")) el("#rappi-code-print").textContent = `Cód. Rappi: ${e.target.value}`;
            DataManager.saveState();
        });
    },

    render() {
        // Called by app_main when view changes
        const state = store.getState();
        if (state.activeView === 'francos') this.renderFrancos();
        if (state.activeView === 'clock-ins') this.renderClockInReport();
        if (state.activeView === 'planilla-turno') this.renderPlanillaTurno();
    },

    renderWeeklySummary() {
        const state = store.getState();
        const content = el("#weekly-summary-content");
        if (!content) return;
        const isMonthlyMode = Number(state.schedulingPeriodWeeks) === 4;
        const summaryBtn = el("#btn-weekly-summary");
        const summaryHeading = el("#summary-modal-heading");
        if (summaryBtn) summaryBtn.textContent = isMonthlyMode ? 'Resumen mensual' : 'Resumen semanal';
        if (summaryHeading) summaryHeading.textContent = isMonthlyMode ? 'Resumen Mensual' : 'Resumen Semanal';

        const employees = state.employees.slice();
        if(employees.length === 0) {
            content.innerHTML = "<p class='muted'>No hay empleados.</p>";
            return;
        }

        const monthValue = el("#monthly-top-month")?.value || '';
        const monthDates = (() => {
            if (!isMonthlyMode || !monthValue) return [];
            const [year, month] = monthValue.split('-').map(Number);
            if (!year || !month) return [];
            const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
            return Array.from({ length: lastDay }, (_, idx) => new Date(Date.UTC(year, month - 1, idx + 1, 12, 0, 0)));
        })();

        const getDayShifts = (date) => {
            const weekId = toISODateString(getMonday(date));
            const dayIndex = (date.getUTCDay() + 6) % 7;
            const week = state.schedules[weekId] || {};
            return week[dayIndex] || [];
        };

        const getHours = (empId) => {
            if (!isMonthlyMode) return ScheduleManager.getEmployeeWeeklyHours(empId);
            return monthDates.reduce((acc, date) => {
                const shifts = getDayShifts(date).filter(s => s.employeeId === empId);
                return acc + shifts.reduce((sum, s) => sum + ((s.endSlot - s.startSlot + 1) / 2), 0);
            }, 0);
        };

        // Helper for working days count - assumes getActiveSchedule returns full week object
        const getWorkingDays = (empId) => {
            if (!isMonthlyMode) {
                const schedule = getActiveSchedule();
                if (!schedule) return 0;
                let days = new Set();
                for (let i = 0; i < 7; i++) {
                    const dayShifts = schedule[i] || [];
                    if (dayShifts.some(s => s.employeeId === empId)) {
                        days.add(i);
                    }
                }
                return days.size;
            }
            const worked = new Set();
            monthDates.forEach((date) => {
                const dateKey = toISODateString(date);
                if (getDayShifts(date).some(s => s.employeeId === empId)) worked.add(dateKey);
            });
            return worked.size;
        };

        const sortOrder = state.weeklySummarySort || 'alpha';

        const employeeData = employees.map(emp => ({
            ...emp,
            weeklyHours: getHours(emp.id),
            workingDaysCount: getWorkingDays(emp.id)
        }));

        if (sortOrder === 'hours') employeeData.sort((a,b) => b.weeklyHours - a.weeklyHours);
        else if (sortOrder === 'days') employeeData.sort((a,b) => b.workingDaysCount - a.workingDaysCount);
        else employeeData.sort((a,b) => (a.name || '').localeCompare(b.name || ''));

        const middleIndex = Math.ceil(employeeData.length / 2);
        const leftColumnEmployees = employeeData.slice(0, middleIndex);
        const rightColumnEmployees = employeeData.slice(middleIndex);

        // Helper to generate details row content
        const generateDetailsRow = (empId) => {
            if (!isMonthlyMode) {
                const schedule = getActiveSchedule();
                if (!schedule) return document.createElement('div');
            }

            const detailsContainer = create("div", { className: "details-container" });
            const table = create("table", { className: "details-table" });

            const thead = create("thead");
            const headRow = create("tr");
            ['Día', 'Horario', 'Puesto', 'Acción'].forEach(text => {
                headRow.appendChild(create("th", { textContent: text }));
            });
            thead.appendChild(headRow);
            table.appendChild(thead);

            const tbody = create("tbody");
            const daysMap = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
            let hasShifts = false;

            const iterate = isMonthlyMode
                ? monthDates.map((date) => ({
                    label: `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
                    key: toISODateString(date),
                    shifts: getDayShifts(date).filter(s => s.employeeId === empId),
                    dayIndex: (date.getUTCDay() + 6) % 7
                }))
                : Array.from({ length: 7 }, (_, i) => ({
                    label: daysMap[i],
                    shifts: ((getActiveSchedule() || {})[i] || []).filter(s => s.employeeId === empId),
                    dayIndex: i
                }));

            iterate.forEach((entry) => {
                const dayShifts = entry.shifts.slice().sort((a,b) => a.startSlot - b.startSlot);

                dayShifts.forEach(shift => {
                    hasShifts = true;
                    const start = SLOTS[shift.startSlot].label;
                    const end = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";

                    const tr = create("tr");
                    tr.appendChild(create("td", { textContent: entry.label }));
                    tr.appendChild(create("td", { textContent: `${start} - ${end}` }));
                    tr.appendChild(create("td", { textContent: shift.role })); // create handles text content safely

                    const actionTd = create("td", { style: { textAlign: 'center' } });
                    const btn = create("button", {
                        className: "btn small secondary btn-go-shift",
                        textContent: "Ir",
                        style: { padding: "1px 4px", fontSize: "10px" },
                        dataset: { shiftId: shift.id, day: entry.dayIndex, date: entry.key || '' }
                    });
                    actionTd.appendChild(btn);
                    tr.appendChild(actionTd);

                    tbody.appendChild(tr);
                });
            });

            if (!hasShifts) {
                const tr = create("tr");
                const td = create("td", { colSpan: 4, className: "muted", textContent: "Sin turnos." });
                tr.appendChild(td);
                tbody.appendChild(tr);
            }

            table.appendChild(tbody);
            detailsContainer.appendChild(table);
            return detailsContainer;
        };

        const generateTableFor = (list, colIndex) => {
            const table = create("table", { className: "emp-table-new" });
            table.innerHTML = `<thead><tr><th>Empleado</th><th>Hs</th><th>Días</th><th></th></tr></thead>`;
            const tbody = create("tbody");

            list.forEach(e => {
                const tr = create("tr");
                tr.innerHTML = `<td>${e.name}</td><td>${String(e.weeklyHours).replace('.',',')}hs</td><td>${e.workingDaysCount}</td>`;

                const actionTd = create("td");
                const btnDetails = create("button", {
                    className: "btn small secondary",
                    textContent: "Detalles",
                    onClick: (evt) => {
                        const existingDetails = tr.nextElementSibling;
                        if (existingDetails && existingDetails.classList.contains('details-row')) {
                            existingDetails.remove();
                            evt.target.textContent = "Detalles";
                        } else {
                            const detailsTr = create("tr", { className: "details-row" });
                            const detailsTd = create("td", { colSpan: 4 });
                            detailsTd.appendChild(generateDetailsRow(e.id));

                            // Bind "Ir" buttons
                            detailsTd.querySelectorAll('.btn-go-shift').forEach(btn => {
                                btn.addEventListener('click', () => {
                                    const shiftId = btn.dataset.shiftId;
                                    const day = parseInt(btn.dataset.day);

                                    // Close modal
                                    el("#weekly-summary-modal").style.display = "none";

                                    // Navigate logic
                                    if (isMonthlyMode && btn.dataset.date) {
                                        const monthInput = el("#monthly-top-month");
                                        if (monthInput) monthInput.value = btn.dataset.date.slice(0, 7);
                                        ScheduleManager.monthlySelectedMonth = btn.dataset.date.slice(0, 7);
                                    }
                                    store.setState({ activeDay: day });
                                    el("#btn-view-schedule").click(); // Switch view

                                    setTimeout(() => {
                                        const shiftRow = document.querySelector(`[data-shift-id="${shiftId}"]`);
                                        if (shiftRow) {
                                            shiftRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            shiftRow.classList.add('highlight-shift');
                                            setTimeout(() => shiftRow.classList.remove('highlight-shift'), 2000);
                                        }
                                    }, 300); // Increased timeout slightly for view switch
                                });
                            });

                            detailsTr.appendChild(detailsTd);
                            tr.after(detailsTr);
                            evt.target.textContent = "Ocultar";
                        }
                    }
                });
                actionTd.appendChild(btnDetails);
                tr.appendChild(actionTd);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            return table;
        };

        content.innerHTML = `<div class="summary-grid" id="summary-grid-container"></div>`;
        const grid = content.querySelector("#summary-grid-container");

        const divLeft = create("div");
        divLeft.appendChild(generateTableFor(leftColumnEmployees, 0));

        const divRight = create("div");
        divRight.appendChild(generateTableFor(rightColumnEmployees, 1));

        grid.appendChild(divLeft);
        grid.appendChild(divRight);
    },

    renderFrancos() {
        const content = el("#francos-content");
        if(!content) return;
        clear(content);

        const schedule = getActiveSchedule();
        const employees = store.getState().employees;
        if(!schedule) return;

        const table = create("table", { className: "schedule-list-table" });
        const thead = create("thead");
        const weekMonday = new Date(store.getState().activeWeek + "T12:00:00Z");

        let headerHTML = "<tr>";
        DAYS.forEach((d, i) => {
             const dayDate = new Date(weekMonday);
             dayDate.setDate(weekMonday.getDate() + i);
             headerHTML += `<th>${d}<br><span class="muted" style="font-size:11px;">${dayDate.getDate()}/${dayDate.getMonth()+1}</span></th>`;
        });
        headerHTML += "</tr>";
        thead.innerHTML = headerHTML;
        table.appendChild(thead);

        const tbody = create("tbody");
        const maxRowsPerDay = new Array(7).fill(0);
        const employeesByDay = Array.from({length: 7}, () => []);

        for(let i=0; i<7; i++) {
            const dayShifts = schedule[i] || [];
            const assignedIds = new Set(dayShifts.map(s => s.employeeId));
            employees.forEach(emp => {
                if(!assignedIds.has(emp.id)) employeesByDay[i].push(emp.name);
            });
            maxRowsPerDay[i] = employeesByDay[i].length;
        }

        const maxRows = Math.max(...maxRowsPerDay);
        for(let r=0; r<maxRows; r++) {
            const tr = create("tr");
            for(let c=0; c<7; c++) {
                tr.appendChild(create("td", { textContent: employeesByDay[c][r] || '' }));
            }
            tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        content.appendChild(table);
    },

    importClockIns(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                await this.processAndCompareClockIns(json);
            } catch (err) {
                console.error(err);
                showToast("Error procesando fichero.", "error");
            }
        };
        reader.readAsArrayBuffer(file);
    },

    async processAndCompareClockIns(data) {
        const state = store.getState();
        const reportDataByEmployee = {};

        const normalizeName = (name) => name?.toString().toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, ' ') || '';
        const two = (v) => String(v).padStart(2, '0');

        const normalizeDate = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
        const formatDate = (d) => `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
        const formatTime = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;

        const clockInsByEmployee = {};
        let minDate = null;
        let maxDate = null;

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || !row[0] || !row[4] || !row[7] || !(row[4] instanceof Date)) continue;

            const employeeName = normalizeName(row[0]);
            const clockInDateTime = new Date(row[4]);
            const clockOutDateTime = new Date(row[7]);
            const normalizedDate = normalizeDate(clockInDateTime);
            const dateKey = toISODateString(normalizedDate);

            if (!clockInsByEmployee[employeeName]) clockInsByEmployee[employeeName] = {};
            if (!clockInsByEmployee[employeeName][dateKey]) clockInsByEmployee[employeeName][dateKey] = [];
            clockInsByEmployee[employeeName][dateKey].push({ clockInDate: clockInDateTime, clockOutDate: clockOutDateTime });

            if (!minDate || normalizedDate < minDate) minDate = normalizedDate;
            if (!maxDate || normalizedDate > maxDate) maxDate = normalizedDate;
        }

        if (!minDate || !maxDate) {
            store.setState({ lastClockInReportData: {} });
            this.renderClockInReport();
            return;
        }

        const weeksNeeded = new Set();
        for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
            weeksNeeded.add(toISODateString(getMonday(new Date(d))));
        }

        const scheduleCache = { ...store.getState().schedules };
        for (const weekKey of weeksNeeded) {
            if (!scheduleCache[weekKey]) {
                const weekData = await DataManager.getWeekData(weekKey);
                scheduleCache[weekKey] = weekData || {};
            }
        }

        const getScheduleForDate = (d) => {
            // Normalize date to noon to avoid timezone shifts when getting the Monday key
            const localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
            const monday = getMonday(localDate);
            const weekKey = toISODateString(monday);
            const dayIndex = localDate.getDay() === 0 ? 6 : localDate.getDay() - 1;
            const weekSchedule = scheduleCache[weekKey] || {};
            return weekSchedule[dayIndex] || [];
        };

        for (const employee of state.employees) {
            const employeeKey = employee.name;
            const employeeNameNormalized = normalizeName(employee.name);

            for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
                const currentDate = normalizeDate(new Date(d));
                const dateKey = toISODateString(currentDate);
                const scheduledShift = getScheduleForDate(currentDate).find(s => String(s.employeeId) === String(employee.id));
                const clockInDataList = clockInsByEmployee[employeeNameNormalized]?.[dateKey] || [];

                if (!scheduledShift && clockInDataList.length === 0) continue;

                if (!reportDataByEmployee[employeeKey]) {
                    reportDataByEmployee[employeeKey] = { name: employeeKey, records: [], totalHours: 0, status: 'ok' };
                }

                const dayName = DAYS[currentDate.getDay() === 0 ? 6 : currentDate.getDay() - 1];
                let scheduledTime = 'Sin turno asignado';
                if (scheduledShift) {
                    const startTime = SLOTS[scheduledShift.startSlot].label;
                    const endTime = SLOTS[scheduledShift.endSlot + 1] ? SLOTS[scheduledShift.endSlot + 1].label : "02:00";
                    scheduledTime = `${startTime} - ${endTime} (${scheduledShift.role})`;
                }

                if (clockInDataList.length > 0) {
                    clockInDataList
                        .sort((a, b) => new Date(a.clockInDate) - new Date(b.clockInDate))
                        .forEach(clockInData => {
                            const clockInDateTime = new Date(clockInData.clockInDate);
                            const rawClockOutTime = new Date(clockInData.clockOutDate);

                            // Combine the clock-out time with the clock-in date to avoid Excel date defaults (e.g., 1899)
                            const clockOutDateTime = new Date(clockInDateTime);
                            clockOutDateTime.setHours(
                                rawClockOutTime.getHours(),
                                rawClockOutTime.getMinutes(),
                                rawClockOutTime.getSeconds(),
                                rawClockOutTime.getMilliseconds()
                            );

                            // Handle shifts that end after midnight by rolling the clock-out date forward
                            if (clockOutDateTime <= clockInDateTime) clockOutDateTime.setDate(clockOutDateTime.getDate() + 1);

                            let status = 'ok';
                            let note = '';

                            if (scheduledShift) {
                                const [scheduledStartH, scheduledStartM] = SLOTS[scheduledShift.startSlot].label.split(':').map(Number);
                                const scheduledStart = new Date(currentDate);
                                scheduledStart.setHours(scheduledStartH, scheduledStartM, 0, 0);

                                const endLabel = SLOTS[scheduledShift.endSlot + 1]?.label || '02:00';
                                const [scheduledEndH, scheduledEndM] = endLabel.split(':').map(Number);
                                const scheduledEnd = new Date(currentDate);
                                scheduledEnd.setHours(scheduledEndH, scheduledEndM, 0, 0);
                                if (scheduledEnd <= scheduledStart) scheduledEnd.setDate(scheduledEnd.getDate() + 1);

                                const diffStart = Math.abs(clockInDateTime - scheduledStart) / (1000 * 60);
                                const diffEnd = Math.abs(clockOutDateTime - scheduledEnd) / (1000 * 60);

                                if (diffStart > 15 || diffEnd > 15) {
                                    status = 'warning';
                                    const parts = [];
                                    if (diffStart > 15) {
                                        parts.push(`Entrada ${clockInDateTime > scheduledStart ? 'tarde' : 'temprano'} ${Math.round(diffStart)} min`);
                                    }
                                    if (diffEnd > 15) {
                                        parts.push(`Salida ${clockOutDateTime > scheduledEnd ? 'tarde' : 'temprano'} ${Math.round(diffEnd)} min`);
                                    }
                                    note = parts.join(' | ');
                                }
                            }

                            const actualHours = (clockOutDateTime - clockInDateTime) / (1000 * 60 * 60);
                            reportDataByEmployee[employeeKey].records.push({
                                isoDate: dateKey,
                                date: `${dayName}, ${formatDate(currentDate)}`,
                                scheduled: scheduledTime,
                                clockIn: formatTime(clockInData.clockInDate),
                                clockOut: formatTime(clockInData.clockOutDate),
                                actual: `${actualHours.toFixed(2).replace('.',',')}hs`,
                                status,
                                note
                            });
                        });
                } else if (scheduledShift) {
                    reportDataByEmployee[employeeKey].records.push({
                        isoDate: dateKey,
                        date: `${dayName}, ${formatDate(currentDate)}`,
                        scheduled: scheduledTime,
                        clockIn: 'Ausente',
                        clockOut: '',
                        actual: '0,00hs',
                        status: 'absence',
                        note: 'Ausencia en día con turno asignado'
                    });
                }
            }
        }

        store.setState({ lastClockInReportData: reportDataByEmployee });
        this.renderClockInReport();
    },

    renderClockInReport() {
        const content = el("#clock-in-report-content");
        if(!content) return;
        clear(content);

        const reportData = store.getState().lastClockInReportData;
        if (!reportData) {
            content.innerHTML = '<p class="muted">Sube un archivo Excel para ver el análisis de fichadas.</p>';
            return;
        }

        const dateFilter = store.getState().clockInDateFilter;
        const searchTerm = (store.getState().clockInSearchTerm || '').toLowerCase();
        const filteredReportData = {};

        for (const empName of Object.keys(reportData)) {
            const originalData = reportData[empName];
            let filteredRecords = originalData.records;

            if (dateFilter) filteredRecords = originalData.records.filter(r => r.isoDate === dateFilter);

            if (filteredRecords.length > 0 && (!searchTerm || empName.toLowerCase().includes(searchTerm))) {
                const totalHours = filteredRecords.reduce((acc, record) => {
                    const hours = parseFloat(record.actual.replace('hs', '').replace(',', '.'));
                    return acc + (isNaN(hours) ? 0 : hours);
                }, 0);

                filteredReportData[empName] = {
                    ...originalData,
                    records: filteredRecords,
                    totalHours: totalHours
                };
            }
        }

        let employeeNames = Object.keys(filteredReportData);
        if (store.getState().clockInSortOrder === 'hours_desc') {
            employeeNames.sort((a, b) => filteredReportData[b].totalHours - filteredReportData[a].totalHours);
        } else if (store.getState().clockInSortOrder === 'hours_asc') {
            employeeNames.sort((a, b) => filteredReportData[a].totalHours - filteredReportData[b].totalHours);
        } else {
            employeeNames.sort((a, b) => a.localeCompare(b));
        }

        if (employeeNames.length === 0) {
            content.innerHTML = '<p class="muted">No se encontraron fichadas que coincidan con los filtros.</p>';
            return;
        }

        const reportContainer = create('div', { className: 'clock-in-report-container' });

        employeeNames.forEach(employeeName => {
            const employeeData = filteredReportData[employeeName];
            const card = create('div', { className: 'employee-clock-in-card' });
            if (employeeData.status === 'error') card.classList.add('error-card');

            const title = create('h3', { className: 'employee-card-title' });
            const titleName = create('span', { textContent: employeeName });
            const titleHours = create('span', { className: 'muted', textContent: `Total: ${employeeData.totalHours.toFixed(2).replace('.',',')}hs` });
            title.appendChild(titleName);
            title.appendChild(titleHours);
            card.appendChild(title);

            const table = create('table', { className: 'clock-in-table-internal' });
            table.innerHTML = '<thead><tr><th>Día</th><th>Turno Asignado</th><th>Entrada</th><th>Salida</th><th>Hs. Hechas</th><th>Estado</th></tr></thead>';
            const tbody = table.createTBody();

            employeeData.records.forEach(record => {
                const row = tbody.insertRow();
                if (record.status === 'error') {
                    row.classList.add('danger-text');
                    row.title = record.message;
                } else if (record.status === 'absence') {
                    row.classList.add('absence-row');
                    row.title = 'El empleado tenía un turno asignado pero no hay fichada registrada.';
                } else if (record.status === 'warning') {
                    row.classList.add('warning-row');
                    row.title = record.note || 'Desvío mayor a 15 minutos respecto al turno asignado';
                }

                row.innerHTML = `<td>${record.date}</td><td>${record.scheduled}</td><td>${record.clockIn}</td><td>${record.clockOut}</td><td>${record.actual}</td><td></td>`;

                const noteCell = row.cells[5];
                if (record.note) {
                    const noteEl = create('div', {
                        className: `warning-text ${record.status === 'absence' ? 'strong-warning' : ''}`.trim(),
                        textContent: record.note
                    });
                    noteCell.appendChild(noteEl);
                }
            });

            card.appendChild(table);
            reportContainer.appendChild(card);
        });

        content.appendChild(reportContainer);
    },

    renderPlanillaTurno(isEditing = false) {
        const state = store.getState();
        const rappiCodeInput = el("#rappi-code-input");
        if (rappiCodeInput) rappiCodeInput.value = state.rappiCode || '';
        if (el("#rappi-code-print")) el("#rappi-code-print").textContent = `Cód. Rappi: ${state.rappiCode || '____'}`;

        const datePicker = el("#planilla-date-picker");
        if (!datePicker) return;
        if (!datePicker.value) datePicker.value = toISODateString(new Date());

        const selectedDate = new Date(datePicker.value + "T12:00:00Z");
        const dayName = DAYS[selectedDate.getUTCDay() === 0 ? 6 : selectedDate.getUTCDay() - 1];
        const formattedDate = `${dayName}, ${selectedDate.getUTCDate()} de ${selectedDate.toLocaleString('es-ES', { month: 'long' })} de ${selectedDate.getUTCFullYear()}`;
        if(el("#planilla-title")) el("#planilla-title").textContent = formattedDate;

        // Use temp state if editing, else derive from schedule
        // Need getScheduleForDate helper or logic here.
        // We can import getScheduleForDate logic or duplicate.
        // Let's implement helper locally or import.

        const getMonday = (d) => {
            d = new Date(d);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            return new Date(d.setDate(diff));
        };
        const getScheduleForDate = (d) => {
            const monday = getMonday(d);
            const weekKey = toISODateString(monday);
            const dayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
            const weekSchedule = state.schedules[weekKey] || {};
            return weekSchedule[dayIndex] || [];
        };

        const shifts = (state.tempPlanillaState ? state.tempPlanillaState.shifts : getScheduleForDate(selectedDate)).filter(s => s.employeeId);
        shifts.sort((a, b) => a.startSlot - b.startSlot);

        const mananaTbody = el("#tabla-manana tbody");
        const tardeTbody = el("#tabla-tarde tbody");
        if(mananaTbody) clear(mananaTbody);
        if(tardeTbody) clear(tardeTbody);

        const slot1600 = 20;
        let totalSlotsManana = 0;
        let totalSlotsTarde = 0;

        shifts.forEach(shift => {
            const emp = state.employees.find(e => e.id === shift.employeeId);
            if (!emp) return;

            if (shift.startSlot < slot1600) {
                const endSlotForCalc = Math.min(shift.endSlot, slot1600 - 1);
                totalSlotsManana += (endSlotForCalc - shift.startSlot + 1);
            }
            if (shift.endSlot >= slot1600) {
                const startSlotForCalc = Math.max(shift.startSlot, slot1600);
                totalSlotsTarde += (shift.endSlot - startSlotForCalc + 1);
            }

            const tr = create("tr", { dataset: { shiftId: shift.id } });
            const shiftHours = (shift.endSlot - shift.startSlot + 1) * 0.5;

            import('../config.js').then(({ SLOTS, ROLES }) => {
                if (isEditing) {
                    const empSel = create("select", { className: "select planilla-edit-employee" });
                    state.employees.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(e => {
                        empSel.appendChild(create("option", { value: e.id, textContent: e.name, selected: e.id === emp.id }));
                    });

                    const startSel = create("select", { className: "select planilla-edit-start" });
                    SLOTS.forEach(s => startSel.appendChild(create("option", { value: s.index, textContent: s.label, selected: s.index === shift.startSlot })));

                    const endSel = create("select", { className: "select planilla-edit-end" });
                    SLOTS.forEach(s => endSel.appendChild(create("option", { value: s.index, textContent: s.label, selected: s.index === (shift.endSlot + 1) })));

                    const roleSel = create("select", { className: "select planilla-edit-role" });
                    ROLES.forEach(r => roleSel.appendChild(create("option", { value: r.key, textContent: r.key, selected: r.key === shift.role })));

                    tr.appendChild(create("td", {}, [empSel]));
                    const timeTd = create("td");
                    timeTd.appendChild(startSel);
                    timeTd.appendChild(document.createTextNode(" a "));
                    timeTd.appendChild(endSel);
                    tr.appendChild(timeTd);

                    const hsTd = create("td", { className: "hs-cell", textContent: String(shiftHours).replace('.', ',') });
                    tr.appendChild(hsTd);
                    tr.appendChild(create("td", {}, [roleSel]));
                    tr.appendChild(create("td"));

                    const updateH = () => {
                        const s = parseInt(startSel.value);
                        const e = parseInt(endSel.value);
                        if(e > s) hsTd.textContent = String((e-s)*0.5).replace('.',',');
                        else hsTd.textContent = "Err";
                    };
                    startSel.onchange = updateH;
                    endSel.onchange = updateH;

                } else {
                    const start = SLOTS[shift.startSlot].label;
                    const end = SLOTS[shift.endSlot+1] ? SLOTS[shift.endSlot+1].label : "02:00";
                    tr.innerHTML = `<td>${emp.name}</td><td>${start} a ${end}</td><td>${String(shiftHours).replace('.',',')}</td><td>${shift.role}</td><td></td>`;
                }

                if (shift.startSlot < slot1600) { if(mananaTbody) mananaTbody.appendChild(tr); }
                else { if(tardeTbody) tardeTbody.appendChild(tr); }
            });
        });

        // Add empty rows logic... (skip for brevity or basic implementation)
        if(el("#total-hs-manana")) el("#total-hs-manana").textContent = String(totalSlotsManana * 0.5).replace('.', ',');
        if(el("#total-hs-tarde")) el("#total-hs-tarde").textContent = String(totalSlotsTarde * 0.5).replace('.', ',');

        this.renderBreaksSection(false);
    },

    togglePlanillaEdit() {
        const btn = el("#btn-edit-planilla");
        const isEditing = btn.textContent === "Aplicar Cambios";

        if (isEditing) {
            const trs = document.querySelectorAll("#view-planilla-turno tbody tr[data-shift-id]");
            const updatedShifts = JSON.parse(JSON.stringify(store.getState().tempPlanillaState.shifts));

            trs.forEach(tr => {
                const shiftId = tr.dataset.shiftId;
                const shift = updatedShifts.find(s => s.id === shiftId);
                if(shift) {
                    shift.employeeId = tr.querySelector(".planilla-edit-employee").value;
                    shift.startSlot = parseInt(tr.querySelector(".planilla-edit-start").value);
                    shift.endSlot = parseInt(tr.querySelector(".planilla-edit-end").value) - 1;
                    shift.role = tr.querySelector(".planilla-edit-role").value;
                }
            });

            store.setState({ tempPlanillaState: { shifts: updatedShifts } });

            btn.textContent = "Editar Planilla";
            btn.classList.remove("btn-primary");
            btn.classList.add("btn-secondary");
            this.renderPlanillaTurno(false);
        } else {
            // Start Edit
            if (!store.getState().tempPlanillaState) {
                const datePicker = el("#planilla-date-picker");
                const selectedDate = new Date(datePicker.value + "T12:00:00Z");

                const getMonday = (d) => {
                    d = new Date(d);
                    const day = d.getDay();
                    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                    return new Date(d.setDate(diff));
                };
                const getScheduleForDate = (d) => {
                    const monday = getMonday(d);
                    const weekKey = toISODateString(monday);
                    const dayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
                    const weekSchedule = store.getState().schedules[weekKey] || {};
                    return weekSchedule[dayIndex] || [];
                };

                const originalShifts = getScheduleForDate(selectedDate);
                store.setState({ tempPlanillaState: { shifts: JSON.parse(JSON.stringify(originalShifts)) } });
            }
            btn.textContent = "Aplicar Cambios";
            btn.classList.remove("btn-secondary");
            btn.classList.add("btn-primary");
            this.renderPlanillaTurno(true);
        }
    },

    renderBreaksSection(isEditing) {
        const table = el("#breaks-table");
        if(!table) return;
        clear(table);

        const breaks = store.getState().breaks || { "9250": [], "1245": [] };
        const breaks9250 = breaks["9250"] || [];
        const breaks1245 = breaks["1245"] || [];
        const maxRows = Math.max(breaks9250.length, breaks1245.length);

        const thead = create("thead", { innerHTML: "<tr><th colspan='2'>9250</th><th colspan='2'>1245</th></tr>" });
        table.appendChild(thead);

        const tbody = create("tbody");
        for(let i=0; i<maxRows; i++) {
            const row = create("tr");
            const b1 = breaks9250[i] || {};
            const b2 = breaks1245[i] || {};

            if(isEditing) {
                row.appendChild(create("td", {}, [create("input", { className: "break-input", dataset: { code:"9250", idx:i, field:"id" }, value: b1.id||'' })]));
                row.appendChild(create("td", {}, [create("input", { className: "break-input", dataset: { code:"9250", idx:i, field:"text" }, value: b1.text||'' })]));
                row.appendChild(create("td", {}, [create("input", { className: "break-input", dataset: { code:"1245", idx:i, field:"id" }, value: b2.id||'' })]));
                row.appendChild(create("td", {}, [create("input", { className: "break-input", dataset: { code:"1245", idx:i, field:"text" }, value: b2.text||'' })]));
            } else {
                row.appendChild(create("td", { textContent: b1.id }));
                row.appendChild(create("td", { textContent: b1.text }));
                row.appendChild(create("td", { textContent: b2.id }));
                row.appendChild(create("td", { textContent: b2.text }));
            }
            tbody.appendChild(row);
        }

        if (isEditing) {
            // Add new row placeholder
             const row = create("tr");
             row.appendChild(create("td", {}, [create("input", { className: "break-input", dataset: { code:"9250", idx:maxRows, field:"id" }, placeholder:"ID" })]));
             row.appendChild(create("td", {}, [create("input", { className: "break-input", dataset: { code:"9250", idx:maxRows, field:"text" }, placeholder:"Text" })]));
             row.appendChild(create("td", {}, [create("input", { className: "break-input", dataset: { code:"1245", idx:maxRows, field:"id" }, placeholder:"ID" })]));
             row.appendChild(create("td", {}, [create("input", { className: "break-input", dataset: { code:"1245", idx:maxRows, field:"text" }, placeholder:"Text" })]));
             tbody.appendChild(row);
        }

        table.appendChild(tbody);
    },

    toggleBreaksEdit() {
        const btn = el("#btn-edit-breaks");
        const isEditing = btn.textContent === "Guardar Breaks";

        if (isEditing) {
            // Save logic
            const inputs = document.querySelectorAll(".break-input");
            const newBreaks = { "9250": [], "1245": [] };
            const temp = {};

            inputs.forEach(inp => {
                const { code, idx, field } = inp.dataset;
                const key = `${code}-${idx}`;
                if(!temp[key]) temp[key] = {};
                temp[key][field] = inp.value;
            });

            Object.keys(temp).forEach(k => {
                const [code] = k.split('-');
                if (temp[k].id || temp[k].text) {
                    newBreaks[code].push(temp[k]);
                }
            });

            store.setState({ breaks: newBreaks });
            DataManager.saveState();

            btn.textContent = "Editar Breaks";
            btn.classList.remove("btn-primary");
            btn.classList.add("btn-secondary");
            this.renderBreaksSection(false);
        } else {
            btn.textContent = "Guardar Breaks";
            btn.classList.remove("btn-secondary");
            btn.classList.add("btn-primary");
            this.renderBreaksSection(true);
        }
    }
};
