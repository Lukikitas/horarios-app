import { firebaseConfig, SLOTS } from './src/config.js';
import { HistoryManager } from './src/history.js';

const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

(async function(){
  // auth.onAuthStateChanged(async (user) => {
  //   if (user) {
  //     const idTokenResult = await user.getIdTokenResult();
  //     if (idTokenResult.claims.role !== 'manager') {
  //       window.location.href = 'index.html';
  //     }
  //   } else {
  //     window.location.href = 'index.html';
  //   }
  // });
  /* ====== Date Helpers ====== */
  function toISODateString(date) {
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
  }

  function getMonday(d) {
      d = new Date(d);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
      return new Date(d.setDate(diff));
  }

  /* ====== Datos base ====== */
  const ROLES = [
    { key: "Cocina",       cls: "b-cocina",       color: getComputedStyle(document.documentElement).getPropertyValue('--c-cocina').trim(),       darkText:false },
    { key: "Empaque",      cls: "b-empaque",      color: getComputedStyle(document.documentElement).getPropertyValue('--c-empaque').trim(),      darkText:false },
    { key: "Sandwich",     cls: "b-sandwich",     color: getComputedStyle(document.documentElement).getPropertyValue('--c-sandwich').trim(),     darkText:true  },
    { key: "Lobby",        cls: "b-lobby",        color: getComputedStyle(document.documentElement).getPropertyValue('--c-lobby').trim(),        darkText:false },
    { key: "Presentación", cls: "b-presentación", color: getComputedStyle(document.documentElement).getPropertyValue('--c-presentacion').trim(), darkText:false },
    { key: "Delivery",     cls: "b-delivery",     color: getComputedStyle(document.documentElement).getPropertyValue('--c-delivery').trim(),     darkText:false },
    { key: "Caja",         cls: "b-caja",         color: getComputedStyle(document.documentElement).getPropertyValue('--c-caja').trim(),         darkText:false },
    { key: "Anfitriona",   cls: "b-anfitriona",   color: getComputedStyle(document.documentElement).getPropertyValue('--c-anfitriona').trim(),   darkText:false },
    { key: "Descarga",     cls: "b-descarga",     color: getComputedStyle(document.documentElement).getPropertyValue('--c-descarga').trim(),     darkText:false },
  ];
  const DAYS = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
  const MAX_SLOT_FOR_MINOR = 27; // up to 19:30-20:00 inclusive. Cannot work 20:00 onwards.

  /* ====== Estado (Firestore) ====== */
  const state = {
    employees: [],
    schedules: {},
    templates: {},
    projectedTickets: {},
    activeWeek: toISODateString(getMonday(new Date())),
    activeDay:0,
    weeklySummarySort: 'alpha',
    editingEmployeeId: null,
    activeDetailEmployeeId: null,
    activeDetailSection: null,
    clockInSearchTerm: '',
    clockInSortOrder: 'alpha',
    lastClockInReportData: null,
    clockInDateFilter: null,
    scheduleRoleFilters: [],
    scheduleSearchTerm: '',
    breaks: {},
    tempPlanillaState: null,
    rappiCode: '',
  };

  const defaultBreaks = {
    "9250": [
      { "id": 1, "text": "POP + PAPAS" },
      { "id": 2, "text": "RUSTER + PAPAS" },
      { "id": 3, "text": "5 ALITAS + PAPAS" },
      { "id": 4, "text": "2 PIEZAS + PAPAS" },
      { "id": 5, "text": "ENSALADA TEAM" },
      { "id": 6, "text": "CAFE + 3 MED" },
      { "id": 7, "text": "TOSTADO REGULAR" }
    ],
    "1245": [
      { "id": 1, "text": "ENTRENADORES" },
      { "id": 2, "text": "SUPER PAPAS" },
      { "id": 3, "text": "3 ALITAS + PAPAS" },
      { "id": 8, "text": "9" },
      { "id": 9, "text": "2 PIEZAS + PAPAS" },
      { "id": 10, "text": "ENSALADA + PAPAS" },
      { "id": 11, "text": "11" }
    ]
  };

  async function loadState() {
    const docRef = db.collection("schedules").doc("main");
    try {
      const doc = await docRef.get();
      if (doc.exists) {
          const data = doc.data();
          state.employees = data.employees || [];
          state.breaks = data.breaks || defaultBreaks;
          state.rappiCode = data.rappiCode || '';
          // Migration for availability and exceptions
          state.employees.forEach(emp => {
            if (!emp.displayName) {
                const nameParts = emp.name.split(',');
                emp.displayName = nameParts.length > 1 ? nameParts[1].trim() : emp.name.split(' ')[0];
            }
            if (!emp.availability) {
                // New employee or very old data
                emp.availability = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
            } else if (Array.isArray(emp.availability)) {
                // It's an array, needs migration from the old format
                const newAvailability = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
                for (let i = 0; i < 7; i++) {
                    const dayData = emp.availability[i];
                    if (dayData && (dayData.start || dayData.end)) { // Old format: [{...}, {...}]
                        newAvailability[i] = [dayData];
                    }
                }
                emp.availability = newAvailability;
            }
            // If it's already an object, we assume it's the new correct format and do nothing.

            if (!emp.exceptions) {
              emp.exceptions = [];
            }
            if (!emp.sanctions) {
              emp.sanctions = [];
            }
          });
          state.templates = data.templates || {};
          state.projectedTickets = data.projectedTickets || {};
          state.activeDay = data.activeDay || 0;
          state.activeWeek = data.activeWeek || toISODateString(getMonday(new Date()));

          // Migration from old format
          if (data.schedule && !data.schedules) {
              console.log("Migrating old schedule format...");
              const weekKey = toISODateString(getMonday(new Date()));
              state.schedules = { [weekKey]: data.schedule };
              state.activeWeek = weekKey;
              // delete old field
              const updateData = { ...data, schedules: state.schedules };
              delete updateData.schedule;
              db.collection("schedules").doc("main").set(updateData); // No need to wait
          } else {
              state.schedules = data.schedules || {};
          }

          // Ensure activeWeek schedule exists
          if (!state.schedules[state.activeWeek]) {
              state.schedules[state.activeWeek] = {};
          }

      } else {
          console.log("No state found in Firestore. Starting with a new default state.");
          state.schedules[state.activeWeek] = {};
      }
    } catch (error) {
      console.error("Error loading state from Firestore:", error);
      alert("No se pudo cargar los datos. Revisa la consola para más detalles.");
    }
  }

  let saveTimeout;
  function save() {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(saveState, 1500);
  }

  const historyManager = new HistoryManager();

  function commitChange(action) {
      const currentSchedule = getActiveSchedule();
      historyManager.push(currentSchedule);
      action();
      el("#btnUndo").disabled = !historyManager.canUndo();
      save();
      renderAll();
  }

  async function saveState() {
    try {
      const stateToSave = JSON.parse(JSON.stringify(state));
      delete stateToSave.schedule; // Make sure old property is not saved
      await db.collection("schedules").doc("main").set(stateToSave);
      console.log("State saved to Firestore.");
    } catch (error) {
      console.error("Error saving state to Firestore:", error);
      alert("Error al guardar los datos. Revisa la consola para más detalles.");
    }
  }

  function getActiveSchedule() {
    if (!state.schedules[state.activeWeek]) {
        state.schedules[state.activeWeek] = {
            isLocked: false
        };
    }
    return state.schedules[state.activeWeek];
  }

  /* ====== Helpers UI ====== */
  const el = (sel)=>document.querySelector(sel);
  const empList = el("#empList");
  const empFilter = el("#empFilter");
  const weekSelector = el("#weekSelector");
  const activeRole = el("#activeRole");
  const dayTabs = el("#dayTabs");
  const thead = el("#thead");
  const tbody = el("#tbody");
  const formStart = el("#formStart");
  const formEnd = el("#formEnd");
  const shiftDuration = el("#shiftDuration");
  const projectedTickets = el("#projectedTickets");
  const projectedProductivity = el("#projectedProductivity");

  const viewScheduleEl = el('#view-schedule');
  const viewEmployeesEl = el('#view-employees');
  const viewTemplatesEl = el('#view-templates');
  const viewScheduleListEl = el('#view-schedule-list');
  const viewFrancosEl = el('#view-francos');
  const viewClockInsEl = el('#view-clock-ins');
  const viewPlanillaTurnoEl = el('#view-planilla-turno');
  const btnViewSchedule = el('#btn-view-schedule');
  const btnViewEmployees = el('#btn-view-employees');
  const btnViewTemplates = el('#btn-view-templates');
  const btnViewFrancos = el('#btn-view-francos');
  const btnScheduleList = el('#btn-schedule-list');
  const btnViewClockIns = el('#btn-view-clock-ins');
  const btnPlanillaTurno = el('#btn-planilla-turno');
  const inpTemplateName = el('#inpTemplateName');
  const btnSaveTemplate = el('#btnSaveTemplate');
  const templateList = el('#templateList');
  const printModal = el("#print-modal");
  const printModalClose = el("#print-modal-close");
  const btnPrintScheduleList = el("#btn-print-schedule-list");
  const btnPrintDailyPlanning = el("#btn-print-daily-planning");

  const importTextModal = el("#import-text-modal");
  const btnImportText = el("#btn-import-text");
  const importTextModalClose = el("#import-text-modal-close");
  const btnImportTextCancel = el("#btn-import-text-cancel");
  const btnImportTextProcess = el("#btn-import-text-process");
  const importTextArea = el("#import-text-area");

  function showView(viewName) {
    // Clear temporary planilla state if navigating away
    if (viewName !== 'planilla-turno' && state.tempPlanillaState) {
        state.tempPlanillaState = null;
        const btn = el("#btn-edit-planilla");
        if (btn) {
            btn.textContent = "Editar Planilla";
            btn.classList.remove("btn-primary");
            btn.classList.add("btn-secondary");
        }
    }

    viewScheduleEl.style.display = 'none';
    viewEmployeesEl.style.display = 'none';
    viewTemplatesEl.style.display = 'none';
    viewScheduleListEl.style.display = 'none';
    viewFrancosEl.style.display = 'none';
    viewClockInsEl.style.display = 'none';
    viewPlanillaTurnoEl.style.display = 'none';
    btnViewSchedule.className = 'btn secondary main-menu-btn';
    btnViewEmployees.className = 'btn secondary main-menu-btn';
    btnViewTemplates.className = 'btn secondary main-menu-btn';
    btnViewFrancos.className = 'btn secondary main-menu-btn';
    btnScheduleList.className = 'btn secondary main-menu-btn';
    btnViewClockIns.className = 'btn secondary main-menu-btn';
    btnPlanillaTurno.className = 'btn secondary main-menu-btn';

    if (viewName === 'schedule') {
        viewScheduleEl.style.display = 'block';
        btnViewSchedule.className = 'btn main-menu-btn';
    } else if (viewName === 'employees') {
        viewEmployeesEl.style.display = 'block';
        btnViewEmployees.className = 'btn main-menu-btn';
    } else if (viewName === 'templates') {
        viewTemplatesEl.style.display = 'block';
        btnViewTemplates.className = 'btn main-menu-btn';
    } else if (viewName === 'francos') {
        viewFrancosEl.style.display = 'block';
        btnViewFrancos.className = 'btn main-menu-btn';
    } else if (viewName === 'schedule-list') {
        viewScheduleListEl.style.display = 'block';
        btnScheduleList.className = 'btn main-menu-btn';
    } else if (viewName === 'clock-ins') {
        viewClockInsEl.style.display = 'block';
        btnViewClockIns.className = 'btn main-menu-btn';
    } else if (viewName === 'planilla-turno') {
        viewPlanillaTurnoEl.style.display = 'block';
        btnPlanillaTurno.className = 'btn main-menu-btn';
    }
    renderAll();
  }
  btnViewSchedule.addEventListener('click', () => showView('schedule'));
  btnViewEmployees.addEventListener('click', () => showView('employees'));
  btnViewTemplates.addEventListener('click', () => showView('templates'));
  btnViewFrancos.addEventListener('click', () => showView('francos'));
  btnScheduleList.addEventListener('click', () => showView('schedule-list'));
  btnViewClockIns.addEventListener('click', () => showView('clock-ins'));
  btnPlanillaTurno.addEventListener('click', () => showView('planilla-turno'));
  el("#empFilter").addEventListener("change", renderEmpList);
  if (el("#empSearch")) {
    el("#empSearch").addEventListener("input", renderEmpList);
  }


  function two(n){ return String(n).padStart(2,"0"); }

  function timeToSlotIndex(timeLabel) {
    if (!timeLabel) return -1;
    return SLOTS.findIndex(s => s.label === timeLabel);
  }

  function optionize(select, items, map=(x)=>({value:x, label:x}), includeBlank){
    select.innerHTML = "";
    if(includeBlank){ const o = document.createElement("option"); o.value=""; o.textContent=includeBlank; select.appendChild(o); }
    for(const it of items){
      const {value,label} = map(it);
      const o = document.createElement("option");
      o.value = value; o.textContent = label;
      select.appendChild(o);
    }
  }

  /* ====== Controles superiores ====== */
  optionize(empFilter, [{key:"",name:"Todos"},...ROLES.map(r=>({key:r.key,name:r.key}))], (x)=>({value:x.key,label:x.name}));
  optionize(activeRole, ROLES, (r)=>({value:r.key,label:r.key}));
  activeRole.addEventListener("change", () => {
    // We just need to re-render the table to move the new shift row
    renderTable();
  });
  optionize(formStart, SLOTS, (s)=>({value:s.index,label:s.label}));
  optionize(formEnd,   SLOTS, (s)=>({value:s.index,label:s.label}));

  function updateShiftDuration() {
      const start = Number(formStart.value);
      const end = Number(formEnd.value);
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
          const duration = (end - start) * 0.5;
          shiftDuration.textContent = `(${String(duration).replace('.', ',')}hs)`;
      } else {
          shiftDuration.textContent = "";
      }
  }
  formStart.addEventListener("change", updateShiftDuration);
  formEnd.addEventListener("change", updateShiftDuration);
  updateShiftDuration();

  el("#fileImportExcel").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            let importedCount = 0;
            json.slice(1).forEach(row => {
                const name = row[0];
                if (name && String(name).trim()) {
                    const id = crypto.randomUUID();
                    state.employees.push({ id, name: String(name).trim(), stars: [] });
                    importedCount++;
                }
            });

            save();
            renderEmpList();
            alert(`Se importaron ${importedCount} empleados.`);
        } catch (err) {
            console.error(err);
            alert("Error al importar el archivo de Excel. Verifique el formato.");
        }
    };
    reader.readAsArrayBuffer(file);
  });

  /* ====== Empleados ====== */
  el("#btnAddEmp").addEventListener("click", addEmployee);
  el("#inpName").addEventListener("keydown",(ev)=>{ if(ev.key==="Enter") addEmployee(); });

  function addEmployee(){
    const name = el("#inpName").value.trim();
    const dni = el("#inpDni").value.trim();
    const mail = el("#inpMail").value.trim();
    if(!name) return;
    const id = crypto.randomUUID();
    const nameParts = name.split(',');
    const displayName = (nameParts.length > 1) ? nameParts[1].trim() : name.split(' ')[0];
    state.employees.push({
      id,
      name,
      displayName: displayName,
      dni: dni,
      mail: mail,
      stars: [],
      isMinor: false,
      isAllStar: false,
      availability: { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
      exceptions: [],
      sanctions: [],
    });
    el("#inpName").value = "";
    el("#inpDni").value = "";
    el("#inpMail").value = "";
    save();
    renderEmpList();
  }

  function getEmployeeById(empId) {
    return state.employees.find((e) => e.id === empId);
  }

  function toggleStar(empId, roleKey){
    const emp = state.employees.find(e=>e.id===empId);
    if(!emp) return;
    emp.stars = emp.stars || [];
    const i = emp.stars.indexOf(roleKey);
    if(i>=0) emp.stars.splice(i,1); else emp.stars.push(roleKey);
    save();
  }

  function toggleIsAllStar(empId) {
    const emp = state.employees.find(e=>e.id===empId);
    if(!emp) return;
    emp.isAllStar = !emp.isAllStar;
    save();
    renderEmpList();
  }

  function toggleIsMinor(empId) {
    const emp = state.employees.find(e=>e.id===empId);
    if(!emp) return;
    emp.isMinor = !emp.isMinor;
    save();
    renderEmpList();
  }

  function removeEmployee(empId){
    if(!confirm("¿Eliminar empleado?")) return;
    state.employees = state.employees.filter(e=>e.id!==empId);
    // Remove employee from any shifts they were assigned to in ANY week
    for (const weekKey in state.schedules) {
        const schedule = state.schedules[weekKey];
        for (const day in schedule) {
            // Check if the property is an array (a day's schedule) before iterating
            if (Array.isArray(schedule[day])) {
                schedule[day].forEach(shift => {
                    if (shift.employeeId === empId) {
                        shift.employeeId = null;
                    }
                });
            }
        }
    }
    commitChange(() => {});
  }

  function deleteShift(shiftId) {
    const day = state.activeDay;
    const schedule = getActiveSchedule();
    ensureDay(day);
    const index = schedule[day].findIndex(s => s.id === shiftId);
    if (index > -1) {
        commitChange(() => {
            schedule[day].splice(index, 1);
        });
    }
  }

  function getEmployeeWeeklyHours(employeeId) {
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
  }

  function getEmployeeShiftsForWeek(employeeId) {
    const shifts = [];
    const schedule = getActiveSchedule();
    // Ensure we iterate through days in order
    const sortedDays = Object.keys(schedule).sort((a, b) => a - b);
    for (const day of sortedDays) {
        const dayShifts = schedule[day];
        // Ensure dayShifts is an array before iterating
        if (Array.isArray(dayShifts)) {
            for (const shift of dayShifts) {
                if (shift.employeeId === employeeId) {
                    shifts.push({ ...shift, day: parseInt(day, 10) });
                }
            }
        }
    }
    return shifts;
  }

  function isEmployeeAssignedOnDay(employeeId, day) {
      const schedule = getActiveSchedule();
      const dayShifts = schedule[day] || [];
      return dayShifts.some(s => s.employeeId === employeeId);
  }

  function calculateHeadcountPerSlot(day) {
      const headcount = SLOTS.map(() => ({ total: 0, allStars: 0 }));
      const schedule = getActiveSchedule();
      const dayShifts = schedule[day] || [];

      for (const shift of dayShifts) {
          const emp = shift.employeeId ? getEmployeeById(shift.employeeId) : null;
          const isAllStar = emp ? emp.isAllStar : false;

          for (let i = shift.startSlot; i <= shift.endSlot; i++) {
              headcount[i].total++;
              if (isAllStar) {
                  headcount[i].allStars++;
              }
          }
      }
      return headcount;
  }

  function calculateHeadcountByRolePerSlot(day) {
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
  }

  function calculateTotalDayHours(day) {
    let totalSlots = 0;
    const schedule = getActiveSchedule();
    const dayShifts = schedule[day] || [];
    for (const shift of dayShifts) {
        totalSlots += (shift.endSlot - shift.startSlot + 1);
    }
    return totalSlots * 0.5;
  }

  function calculateConsecutiveWorkDays(employeeId, weekId, dayIndex) {
    const isWorkingOn = (date) => {
        const dayOfWeek = date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1;
        const weekKey = toISODateString(getMonday(date));
        const scheduleForDay = state.schedules[weekKey] || {};
        const dayShifts = scheduleForDay[dayOfWeek] || [];
        return dayShifts.some(s => s.employeeId === employeeId);
    };

    let consecutiveDays = 1; // Start with the current day being assigned
    const baseDate = new Date(`${weekId}T12:00:00.000Z`);
    baseDate.setUTCDate(baseDate.getUTCDate() + dayIndex);

    // Check backwards
    const yesterday = new Date(baseDate);
    for (let i = 0; i < 14; i++) { // Check up to 2 weeks back is safe
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        if (isWorkingOn(new Date(yesterday))) {
            consecutiveDays++;
        } else {
            break;
        }
    }

    // Check forwards
    const tomorrow = new Date(baseDate);
    for (let i = 0; i < 14; i++) { // Check up to 2 weeks forward
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        if (isWorkingOn(new Date(tomorrow))) {
            consecutiveDays++;
        } else {
            break;
        }
    }
    return consecutiveDays;
  }

  function getScheduleForDate(d) {
    const monday = getMonday(d);
    const weekKey = toISODateString(monday);
    const dayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const weekSchedule = state.schedules[weekKey] || {};
    return weekSchedule[dayIndex] || [];
  }

  function checkRestTime(employeeId, newShift, weekId, dayIndex) {
    const twelveHoursInSlots = 24;

    const todayDate = new Date(`${weekId}T12:00:00.000Z`);
    todayDate.setUTCDate(todayDate.getUTCDate() + dayIndex);

    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setUTCDate(todayDate.getUTCDate() - 1);

    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setUTCDate(todayDate.getUTCDate() + 1);

    // Check against shifts from yesterday
    const shiftsYesterday = getScheduleForDate(yesterdayDate).filter(s => s.employeeId === employeeId);
    if (shiftsYesterday.length > 0) {
        const lastShiftYesterday = shiftsYesterday.reduce((latest, s) => s.endSlot > latest.endSlot ? s : latest);
        const slotsBetween = (48 - (lastShiftYesterday.endSlot + 1)) + newShift.startSlot;
        if (slotsBetween < twelveHoursInSlots) {
            return { pass: false, message: "No se cumplen las 12hs de descanso con el turno del día anterior." };
        }
    }

    // Check against shifts from tomorrow
    const shiftsTomorrow = getScheduleForDate(tomorrowDate).filter(s => s.employeeId === employeeId);
    if (shiftsTomorrow.length > 0) {
        const firstShiftTomorrow = shiftsTomorrow.reduce((earliest, s) => s.startSlot < earliest.startSlot ? s : earliest);
        const slotsBetween = (48 - (newShift.endSlot + 1)) + firstShiftTomorrow.startSlot;
        if (slotsBetween < twelveHoursInSlots) {
            return { pass: false, message: "No se cumplen las 12hs de descanso con el turno del día siguiente." };
        }
    }

    return { pass: true, message: "" };
  }

  function checkShiftOverlap(employeeId, newShift, dayIndex, shiftsToIgnore = []) {
    const schedule = getActiveSchedule();
    const dayShifts = schedule[dayIndex] || [];
    const employeeShiftsOnDay = dayShifts.filter(s =>
        s.employeeId === employeeId && !shiftsToIgnore.includes(s.id)
    );

    // If we find any other shift assigned to the employee on the same day, it's a conflict.
    const hasConflict = employeeShiftsOnDay.some(
        existingShift => existingShift.id !== newShift.id
    );

    if (hasConflict) {
        return { pass: false, message: `El empleado ya tiene un turno asignado para este día.` };
    }

    return { pass: true, message: "" };
  }

  function isDateInSanctionPeriod(date, sanctions) {
    if (!sanctions || sanctions.length === 0) {
        return false;
    }
    const dateString = toISODateString(date);
    for (const sanction of sanctions) {
        if (sanction.startDate && sanction.endDate) {
            if (dateString >= sanction.startDate && dateString <= sanction.endDate) {
                return true;
            }
        }
    }
    return false;
  }

  function canEmployeeWorkShift(employee, shift, dayIndex, options = {}) {
    const { shiftsToIgnore = [], silent = false } = options;

    const shiftDate = new Date(`${state.activeWeek}T12:00:00.000Z`);
    shiftDate.setUTCDate(shiftDate.getUTCDate() + dayIndex);

    // 0. Sanction/Leave Check
    if (isDateInSanctionPeriod(shiftDate, employee.sanctions)) {
        return { pass: false, message: `${employee.name} no puede ser asignado a este turno debido a una licencia o sanción.` };
    }

    // 1. Minor check
    if (employee.isMinor && shift.endSlot > MAX_SLOT_FOR_MINOR) {
        return { pass: false, message: `Un menor de edad no puede trabajar después de las ${SLOTS[MAX_SLOT_FOR_MINOR+1].label}.` };
    }

    // 2. Star check
    if (!(employee.stars || []).includes(shift.role)) {
        return { pass: false, message: `${employee.name} no tiene la estrella "${shift.role}".` };
    }

    // 3. Availability check
    const availabilityCheck = checkEmployeeAvailability(employee, shift, state.activeWeek, dayIndex);
    if (!availabilityCheck.isAvailable) {
        return { pass: false, message: silent ? "No disponible" : availabilityCheck.reason };
    }

    // 4. Overlap check
    const overlapCheck = checkShiftOverlap(employee.id, shift, dayIndex, shiftsToIgnore);
    if (!overlapCheck.pass) {
        return { pass: false, message: overlapCheck.message };
    }

    // 5. Rest time check
    const restCheck = checkRestTime(employee.id, shift, state.activeWeek, dayIndex);
    if (!restCheck.pass) {
        return { pass: false, message: restCheck.message };
    }

    // 6. Consecutive days check
    const consecutiveDays = calculateConsecutiveWorkDays(employee.id, state.activeWeek, dayIndex);
    if (consecutiveDays > 5) {
        if (!silent) {
            if (!confirm(`Advertencia: Al asignar este turno, ${employee.name} trabajará ${consecutiveDays} días seguidos. ¿Continuar de todos modos?`)) {
                return { pass: false, message: "Asignación cancelada por el usuario." };
            }
        } else {
            return { pass: false, message: `Trabajaría ${consecutiveDays} días seguidos.` };
        }
    }

    return { pass: true, message: "OK" };
  }

  function checkEmployeeAvailability(employee, shift, weekId, dayIndex) {
    // Defensive checks
    if (!employee.availability || Array.isArray(employee.availability) || !employee.exceptions || !Array.isArray(employee.exceptions)) {
        return { isAvailable: true, reason: '' }; // Should not happen with migration
    }

    const shiftDate = new Date(`${weekId}T12:00:00.000Z`);
    shiftDate.setUTCDate(shiftDate.getUTCDate() + dayIndex);
    const shiftDateString = toISODateString(shiftDate).slice(0, 10);

    // 1. Check exceptions (this part remains the same)
    const exception = employee.exceptions.find(ex => ex.date === shiftDateString);
    if (exception) {
        if (!exception.start && !exception.end) {
            return { isAvailable: false, reason: `${employee.name} tiene el día libre por una excepción.` };
        }
        const exceptionStartSlot = timeToSlotIndex(exception.start);
        const exceptionEndSlot = timeToSlotIndex(exception.end);
        if (exceptionStartSlot !== -1 && exceptionEndSlot !== -1) {
            if (shift.startSlot < exceptionEndSlot && shift.endSlot >= exceptionStartSlot) {
                 return { isAvailable: false, reason: `${employee.name} no está disponible en este horario por una excepción.` };
            }
        }
    }

    // 2. Check weekly availability (new logic)
    const dayAvailabilitySlots = employee.availability[dayIndex];
    if (!dayAvailabilitySlots || dayAvailabilitySlots.length === 0) {
        // If no slots are defined, employee is considered available for the whole day.
        return { isAvailable: true, reason: '' };
    }

    let isAvailableInAnySlot = false;
    for (const slot of dayAvailabilitySlots) {
        const availableStartSlot = slot.start ? timeToSlotIndex(slot.start) : 0;
        const availableEndSlot = slot.end ? timeToSlotIndex(slot.end) - 1 : SLOTS.length - 1;

        if (availableStartSlot === -1) continue; // Invalid start time in slot definition

        if (shift.startSlot >= availableStartSlot && shift.endSlot <= availableEndSlot) {
            isAvailableInAnySlot = true;
            break; // Found a valid slot, no need to check others
        }
    }

    if (isAvailableInAnySlot) {
        return { isAvailable: true, reason: '' };
    } else {
        const availableRanges = dayAvailabilitySlots.map(s => `${s.start || 'Apertura'} a ${s.end || 'Cierre'}`).join(', ');
        return { isAvailable: false, reason: `El horario del turno no coincide con la disponibilidad de ${employee.name} para este día: ${availableRanges}.` };
    }
  }

  /* ====== Horarios ====== */
  function ensureDay(d){
    const schedule = getActiveSchedule();
    schedule[d] = schedule[d] || [];
  }
  /* Form para crear turnos */
  el("#btnAddUnassignedShift").addEventListener("click", ()=>{
    const role = activeRole.value;
    const startSlot = Number(formStart.value);
    const endSlot = Number(formEnd.value);
    if(Number.isNaN(startSlot) || Number.isNaN(endSlot) || endSlot <= startSlot) {
        alert("La hora de fin debe ser posterior a la hora de inicio.");
        return;
    }

    const newShift = {
        id: crypto.randomUUID(),
        role: role,
        startSlot: startSlot,
        endSlot: endSlot - 1, // end is exclusive
        employeeId: null
    };

    const day = state.activeDay;
    ensureDay(day);
    commitChange(() => {
        getActiveSchedule()[day].push(newShift);
    });
  });

  let isPainting = false;
  let paintStartSlot = -1;
  let lastEnteredSlot = -1;

  let isUnpainting = false;
  let unpaintShiftId = null;
  let unpaintStartSlot = -1;

  function handlePaintStart(slotIndex) {
      isPainting = true;
      paintStartSlot = slotIndex;
      lastEnteredSlot = slotIndex;
      const newShiftRow = tbody.querySelector(".new-shift-row");
      const cell = newShiftRow.querySelector(`[data-slot-index='${slotIndex}']`);
      if(cell) cell.style.background = ROLES.find(r => r.key === activeRole.value)?.color || '#ccc';
  }

  function handlePaintEnter(slotIndex) {
    if (isPainting) {
        lastEnteredSlot = slotIndex;
        const newShiftRow = tbody.querySelector(".new-shift-row");
        const cells = newShiftRow.querySelectorAll('.slot');
        cells.forEach(c => c.style.background = "");

        const [start, end] = [Math.min(paintStartSlot, slotIndex), Math.max(paintStartSlot, slotIndex)];
        const roleColor = ROLES.find(r => r.key === activeRole.value)?.color || '#ccc';
        for (let i = start; i <= end; i++) {
            const cell = newShiftRow.querySelector(`[data-slot-index='${i}']`);
            if (cell) cell.style.background = roleColor;
        }
    } else if (isUnpainting) {
        lastEnteredSlot = slotIndex;
    }
  }

  function handlePaintEnd() {
      if (!isPainting) return;

      const [start, end] = [Math.min(paintStartSlot, lastEnteredSlot), Math.max(paintStartSlot, lastEnteredSlot)];

      isPainting = false;

      if (start < 0 || end < 0 || start === end) return;

      const newShift = {
          id: crypto.randomUUID(),
          role: activeRole.value,
          startSlot: start,
          endSlot: end,
          employeeId: null
      };

      const day = state.activeDay;
      ensureDay(day);
      commitChange(() => {
          getActiveSchedule()[day].push(newShift);
      });
  }

  window.addEventListener("mouseup", () => {
    if (isPainting) {
      handlePaintEnd();
    }
    if (isUnpainting) {
        handleUnpaintEnd(lastEnteredSlot);
    }
  });

  function handleUnpaintStart(shiftId, slotIndex) {
    isUnpainting = true;
    unpaintShiftId = shiftId;
    unpaintStartSlot = slotIndex;
    lastEnteredSlot = slotIndex;
  }

  function handleUnpaintEnd(endSlotIndex) {
    if (!isUnpainting) return;

    const day = state.activeDay;
    const schedule = getActiveSchedule();
    const shift = schedule[day]?.find(s => s.id === unpaintShiftId);

    // If it's a simple click (mousedown and mouseup on the same slot), do nothing here.
    if (unpaintStartSlot === endSlotIndex || !shift) {
        isUnpainting = false;
        unpaintShiftId = null;
        return;
    }

    const tempShift = { ...shift };
    let modified = false;

    if (unpaintStartSlot === tempShift.startSlot && endSlotIndex > tempShift.startSlot) {
        tempShift.startSlot = endSlotIndex;
        modified = true;
    } else if (unpaintStartSlot === tempShift.endSlot && endSlotIndex < tempShift.endSlot) {
        tempShift.endSlot = endSlotIndex;
        modified = true;
    }

    if (modified && shift.employeeId) {
        const emp = getEmployeeById(shift.employeeId);
        if (emp) {
            const availabilityCheck = checkEmployeeAvailability(emp, tempShift, state.activeWeek, day);
            if (!availabilityCheck.isAvailable) {
                if (!confirm(availabilityCheck.reason + "\n\n¿Modificar de todos modos?")) {
                    isUnpainting = false;
                    unpaintShiftId = null;
                    renderTable(); // Re-render to clear visual artifacts
                    return;
                }
            }
        }
    }

    // Apply changes if modified and checks passed
    if (modified) {
        shift.startSlot = tempShift.startSlot;
        shift.endSlot = tempShift.endSlot;

        commitChange(() => {
            if (shift.startSlot >= shift.endSlot) {
                const index = schedule[day].findIndex(s => s.id === unpaintShiftId);
                if (index > -1) schedule[day].splice(index, 1);
            }
        });
    } else {
        renderAll(); // Re-render to clear visual artifacts if no change was made
    }

    isUnpainting = false;
    unpaintShiftId = null;
    unpaintStartSlot = -1;
  }

  function handleSlotClick(shift, slotIndex) {
    const originalStart = shift.startSlot;
    const originalEnd = shift.endSlot;
    let modified = false;

    // Create a temporary copy for checks
    const tempShift = { ...shift };

    // Case 1: Click is on the start slot -> shorten from the start
    if (slotIndex === tempShift.startSlot && tempShift.startSlot < tempShift.endSlot) {
        tempShift.startSlot++;
        modified = true;
    }
    // Case 2: Click is on the end slot -> shorten from the end
    else if (slotIndex === tempShift.endSlot && tempShift.endSlot > tempShift.startSlot) {
        tempShift.endSlot--;
        modified = true;
    }
    // Case 3: Click is just before the start slot -> extend to the left
    else if (slotIndex === tempShift.startSlot - 1) {
        tempShift.startSlot--;
        modified = true;
    }
    // Case 4: Click is just after the end slot -> extend to the right
    else if (slotIndex === tempShift.endSlot + 1) {
        tempShift.endSlot++;
        modified = true;
    }

    if (!modified) {
        return; // Do nothing for other clicks
    }

    // Perform check only if an employee is assigned
    if (shift.employeeId) {
        const emp = getEmployeeById(shift.employeeId);
        if (emp) {
            const availabilityCheck = checkEmployeeAvailability(emp, tempShift, state.activeWeek, state.activeDay);
            if (!availabilityCheck.isAvailable) {
                if (!confirm(availabilityCheck.reason + "\n\n¿Modificar de todos modos?")) {
                    // Revert is not needed as we haven't changed the actual shift object yet
                    return;
                }
            }
        }
    }

    // If check passes or user confirms, apply the change
    commitChange(() => {
        shift.startSlot = tempShift.startSlot;
        shift.endSlot = tempShift.endSlot;
    });
  }

  /* ====== Render ====== */
  function renderDayTabs(){
    dayTabs.innerHTML = "";
    DAYS.forEach((d,idx)=>{
      const container = document.createElement("div");
      container.className = 'day-tab-item';

      const b = document.createElement("button");
      b.className = "pilltab" + (idx === state.activeDay ? " active" : "");
      b.textContent = d;
      b.addEventListener("click", () => { state.activeDay = idx; save(); renderAll(); });

      const hoursSpan = document.createElement("span");
      const totalHours = calculateTotalDayHours(idx);
      hoursSpan.className = 'day-tab-hours';
      hoursSpan.dataset.day = idx;
      hoursSpan.textContent = totalHours > 0 ? `${String(totalHours).replace('.', ',')}hs` : `-`;

      container.appendChild(b);
      container.appendChild(hoursSpan);

      // Check for unassigned shifts
      const schedule = getActiveSchedule();
      const dayShifts = schedule[idx] || [];
      const hasUnassigned = dayShifts.some(shift => !shift.employeeId);
      if (hasUnassigned) {
          const indicator = document.createElement('div');
          indicator.className = 'unassigned-indicator';
          indicator.title = 'Hay turnos sin asignar';
          container.appendChild(indicator);
      }

      dayTabs.appendChild(container);
    });
  }

  function updateActiveDayHoursDisplay() {
    const dayIndex = state.activeDay;
    const hoursSpan = dayTabs.querySelector(`.day-tab-hours[data-day='${dayIndex}']`);
    if (hoursSpan) {
        const totalHours = calculateTotalDayHours(dayIndex);
        hoursSpan.textContent = totalHours > 0 ? `${String(totalHours).replace('.', ',')}hs` : `-`;
    }
  }

  function updateDayTitle() {
    const dayIndex = state.activeDay;
    const dayName = DAYS[dayIndex];

    const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
    const dayDate = new Date(weekMonday);
    dayDate.setDate(weekMonday.getDate() + dayIndex);

    const formattedDate = `${dayName}, ${dayDate.getDate()} de ${dayDate.toLocaleString('es-ES', { month: 'long' })}`;

    const dayTitleEl = el("#day-title");
    if (dayTitleEl) {
      dayTitleEl.textContent = formattedDate;
    }
  }

  function renderLegend(){
    const cont = document.getElementById("legend"); cont.innerHTML="";
    ROLES.forEach(r=>{
      const row = document.createElement("div");
      const dot = document.createElement("span");
      dot.style.width="14px"; dot.style.height="14px"; dot.style.borderRadius="0";
      dot.style.background = r.color;
      const label = document.createElement("span"); label.textContent = r.key; label.style.fontSize="13px";
      row.appendChild(dot); row.appendChild(label);
      cont.appendChild(row);
    });
  }

  function renderHead(){
    const headcount = calculateHeadcountPerSlot(state.activeDay);
    const headcountByRole = calculateHeadcountByRolePerSlot(state.activeDay);
    const cols = `240px repeat(${SLOTS.length}, 1fr)`;
    const g = document.createElement("div"); g.className="rowg"; g.style.gridTemplateColumns = cols;

    const name = document.createElement("div");
    name.className="namecol";
    const totalDayHours = calculateTotalDayHours(state.activeDay);
    name.innerHTML = `<div style="line-height:1.2"><span class="muted" style="font-size:12px">Turno</span><br><span style="font-size:11px;font-weight:600;color:#374151">Total: ${String(totalDayHours).replace('.',',')}hs</span></div>`;
    g.appendChild(name);

    SLOTS.forEach((s, idx)=>{
        const c = document.createElement("div");
        c.className="slot-h";
        c.style.display = "flex";
        c.style.flexDirection = "column";
        c.style.alignItems = "center";
        c.style.justifyContent = "center";
        c.style.gap = "2px";

        const headcountSpan = document.createElement("span");
        headcountSpan.style.fontWeight = "bold";
        headcountSpan.style.fontSize = "12px";
        const count = headcount[idx].total;
        headcountSpan.textContent = count > 0 ? count : "";

        const allStarSpan = document.createElement("div");
        allStarSpan.className = "all-star-indicator";
        const allStarCount = headcount[idx].allStars;
        if (allStarCount > 0) {
          allStarSpan.innerHTML = `★ <span class="all-star-count">${allStarCount > 1 ? allStarCount : ''}</span>`;
        }

        const timeLabelSpan = document.createElement("span");
        timeLabelSpan.textContent = s.label;

        c.appendChild(headcountSpan);
        c.appendChild(allStarSpan);
        c.appendChild(timeLabelSpan);

        if (count > 0) {
          const tooltipText = Object.entries(headcountByRole[idx])
              .map(([role, num]) => `${num} ${role}`)
              .join('\n');
          c.title = tooltipText;
        }

        g.appendChild(c);
    });

    thead.innerHTML="";
    thead.appendChild(g);
  }

  function renderEmpList(){
    const starFilter = empFilter.value;
    const searchFilter = el("#empSearch") ? el("#empSearch").value.toLowerCase() : "";

    const filtered = state.employees
      .slice()
      .sort((a,b)=>a.name.localeCompare(b.name))
      .filter(e=> {
        const nameMatch = e.name.toLowerCase().includes(searchFilter);
        const starMatch = !starFilter || (e.stars||[]).includes(starFilter);
        return nameMatch && starMatch;
      });

    empList.innerHTML = "";
    if(filtered.length===0){
      const p = document.createElement("div");
      p.className="muted"; p.textContent="Agregá tu primer empleado 👇";
      empList.appendChild(p);
      return;
    }

    const table = document.createElement("table");
    table.className = "emp-table-new";

    const thead = table.createTHead();
    const headRow = thead.insertRow();
    headRow.innerHTML = "<th>Nombre</th><th>DNI/Mail</th><th>Estrellas</th><th>Acciones</th>";

    const tbody = table.createTBody();
    filtered.forEach(e=>{
      const row = tbody.insertRow();
      const isEditing = state.editingEmployeeId === e.id;

      // Name cell
      const nameCell = row.insertCell();
      if (isEditing) {
          const nameInputContainer = document.createElement('div');
          nameInputContainer.className = 'stack';
          nameInputContainer.style.gap = '4px';

          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.value = e.name;
          nameInput.className = 'input';
          nameInput.id = `edit-input-${e.id}`;
          nameInput.placeholder = "Nombre completo";

          const displayNameInput = document.createElement('input');
          displayNameInput.type = 'text';
          displayNameInput.value = e.displayName || '';
          displayNameInput.className = 'input';
          displayNameInput.id = `edit-display-name-input-${e.id}`;
          displayNameInput.placeholder = "Nombre para planilla";

          const dniInput = document.createElement('input');
          dniInput.type = 'text';
          dniInput.value = e.dni || '';
          dniInput.className = 'input';
          dniInput.id = `edit-dni-input-${e.id}`;
          dniInput.placeholder = "DNI";

          const mailInput = document.createElement('input');
          mailInput.type = 'text';
          mailInput.value = e.mail || '';
          mailInput.className = 'input';
          mailInput.id = `edit-mail-input-${e.id}`;
          mailInput.placeholder = "Mail";

          nameInputContainer.appendChild(nameInput);
          nameInputContainer.appendChild(displayNameInput);
          nameInputContainer.appendChild(dniInput);
          nameInputContainer.appendChild(mailInput);
          nameCell.appendChild(nameInputContainer);
      } else {
          nameCell.textContent = e.name;
          if (e.isAllStar) {
            const allStarBadge = document.createElement("span");
            allStarBadge.className = "badge b-all-star";
            allStarBadge.textContent = "★";
            allStarBadge.title = "All Star";
            allStarBadge.style.marginLeft = "8px";
            nameCell.appendChild(allStarBadge);
          }
          if (e.isMinor) {
              const minorBadge = document.createElement("span");
              minorBadge.className = "badge b-minor";
              minorBadge.textContent = "M";
              minorBadge.title = "Menor de edad";
              minorBadge.style.marginLeft = "8px";
              nameCell.appendChild(minorBadge);
          }
      }

      // DNI/Mail cell
      const dniMailCell = row.insertCell();
      if (!isEditing) {
        dniMailCell.innerHTML = `<div>${e.dni || '-'}</div><div class="muted" style="font-size:12px;">${e.mail || '-'}</div>`;
      }

      // Stars cell
      const starsCell = row.insertCell();
      if (e.stars && e.stars.length > 0) {
        const badges = document.createElement("div");
        badges.className="chips";
        e.stars.forEach(s=>{
          const b = document.createElement("span"); b.className="badge "+clsFor(s); b.textContent=s; badges.appendChild(b);
        });
        starsCell.appendChild(badges);
      } else {
        starsCell.className = "muted";
        starsCell.textContent="Sin estrellas";
      }

      // Actions cell
      const actionsCell = row.insertCell();
      actionsCell.className = "actions-cell-new";

      if (isEditing) {
          const bSave = document.createElement("button");
          bSave.className="btn"; bSave.textContent="Guardar";
          bSave.onclick = () => {
              const newName = el(`#edit-input-${e.id}`).value.trim();
              const newDisplayName = el(`#edit-display-name-input-${e.id}`).value.trim();
              const newDni = el(`#edit-dni-input-${e.id}`).value.trim();
              const newMail = el(`#edit-mail-input-${e.id}`).value.trim();
              if (newName) {
                  e.name = newName;
                  e.dni = newDni;
                  e.mail = newMail;
                  const nameParts = newName.split(',');
                  e.displayName = newDisplayName || (nameParts.length > 1 ? nameParts[1].trim() : newName.split(' ')[0]);
                  state.editingEmployeeId = null;
                  save();
                  renderAll();
              }
          };

          const bCancel = document.createElement("button");
          bCancel.className="btn secondary"; bCancel.textContent="Cancelar";
          bCancel.onclick = () => {
              state.editingEmployeeId = null;
              renderEmpList();
          };
          actionsCell.appendChild(bSave);
          actionsCell.appendChild(bCancel);
      } else {
          const bEdit = document.createElement("button");
          bEdit.className="btn secondary"; bEdit.textContent="Editar";
          bEdit.onclick = () => {
              state.editingEmployeeId = e.id;
              state.activeDetailEmployeeId = null;
              renderEmpList();
          };

          const bEst = document.createElement("button");
          bEst.className="btn secondary"; bEst.textContent="Estrellas";
          bEst.onclick = () => toggleDetailPanel(e.id, 'stars');

          // Dropdown for other actions
          const dropdownDiv = document.createElement("div");
          dropdownDiv.className = "dropdown";

          const dropdownButton = document.createElement("button");
          dropdownButton.className = "btn secondary";
          dropdownButton.textContent = "Gestion de empleado ▾";
          dropdownButton.onclick = (event) => {
              event.stopPropagation();
              const allDropdowns = document.querySelectorAll('.dropdown-content');
              const thisDropdown = dropdownButton.nextElementSibling;
              allDropdowns.forEach(d => {
                  if (d !== thisDropdown) d.classList.remove('show');
              });
              thisDropdown.classList.toggle("show");
          };

          const dropdownContent = document.createElement("div");
          dropdownContent.className = "dropdown-content";

          const bAvailability = document.createElement("button");
          bAvailability.className="dropdown-item"; bAvailability.textContent="Disponibilidad";
          bAvailability.onclick = () => { toggleDetailPanel(e.id, 'availability'); };

          const bExceptions = document.createElement("button");
          bExceptions.className="dropdown-item"; bExceptions.textContent="Excepciones";
          bExceptions.onclick = () => { toggleDetailPanel(e.id, 'exceptions'); };

          const bSanctions = document.createElement("button");
          bSanctions.className="dropdown-item"; bSanctions.textContent="Sanciones y licencias";
          bSanctions.onclick = () => { toggleDetailPanel(e.id, 'sanctions'); };

          const bAllStar = document.createElement("button");
          bAllStar.className="dropdown-item"; bAllStar.textContent = e.isAllStar ? "Quitar All Star" : "Hacer All Star";
          bAllStar.onclick = () => {
              toggleIsAllStar(e.id);
              dropdownContent.classList.remove("show");
          };

          const bMinor = document.createElement("button");
          bMinor.className="dropdown-item"; bMinor.textContent= e.isMinor ? "Quitar Menor" : "Hacer Menor";
          bMinor.onclick = () => {
              toggleIsMinor(e.id);
              dropdownContent.classList.remove("show");
          };

          dropdownContent.appendChild(bAvailability);
          dropdownContent.appendChild(bExceptions);
          dropdownContent.appendChild(bSanctions);
          dropdownContent.appendChild(bAllStar);
          dropdownContent.appendChild(bMinor);
          dropdownDiv.appendChild(dropdownButton);
          dropdownDiv.appendChild(dropdownContent);

          const bDel = document.createElement("button");
          bDel.className="btn secondary del"; bDel.textContent="Eliminar";
          bDel.onclick = () => removeEmployee(e.id);

          actionsCell.appendChild(bEdit);
          actionsCell.appendChild(bEst);
          actionsCell.appendChild(dropdownDiv);
          actionsCell.appendChild(bDel);
      }

      // Add detail row if this employee is active
      if (state.activeDetailEmployeeId === e.id) {
          const detailRow = tbody.insertRow();
          const detailCell = detailRow.insertCell();
          detailCell.colSpan = 4; // Span across all columns
          detailCell.className = 'employee-detail-cell';

          if (state.activeDetailSection === 'stars') {
              renderStarsPanel(detailCell, e.id);
          } else if (state.activeDetailSection === 'availability') {
              renderAvailabilityPanel(detailCell, e.id);
          } else if (state.activeDetailSection === 'exceptions') {
              renderExceptionsPanel(detailCell, e.id);
          } else if (state.activeDetailSection === 'sanctions') {
              // This function will be created in the next step.
              // For now, it won't render anything, but the button exists.
              renderSanctionsPanel(detailCell, e.id);
          }
      }
    });

    empList.appendChild(table);
  }

  function toggleDetailPanel(employeeId, section) {
      if (state.activeDetailEmployeeId === employeeId && state.activeDetailSection === section) {
          state.activeDetailEmployeeId = null;
          state.activeDetailSection = null;
      } else {
          state.activeDetailEmployeeId = employeeId;
          state.activeDetailSection = section;
          state.editingEmployeeId = null; // Close editing mode if open
      }
      renderEmpList();
  }

  function renderProjectedTicketsInput() {
    const weekTickets = state.projectedTickets[state.activeWeek] || {};
    const dayTickets = weekTickets[state.activeDay] || '';
    projectedTickets.value = dayTickets;
  }

  function updateProjectedProductivity() {
    const weekTickets = state.projectedTickets[state.activeWeek] || {};
    const tickets = Number(weekTickets[state.activeDay] || 0);
    const totalHours = calculateTotalDayHours(state.activeDay);
    if (tickets > 0 && totalHours > 0) {
        const productivity = tickets / totalHours;
        projectedProductivity.textContent = productivity.toFixed(1);
    } else {
        projectedProductivity.textContent = "-";
    }
  }

  function renderRoleFilter() {
    const dropdown = el("#role-filter-dropdown");
    dropdown.innerHTML = ""; // Clear existing

    ROLES.forEach(role => {
        const item = document.createElement('div');
        item.className = 'filter-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `filter-${role.key}`;
        checkbox.value = role.key;
        checkbox.checked = state.scheduleRoleFilters.includes(role.key);

        const label = document.createElement('label');
        label.htmlFor = `filter-${role.key}`;
        label.textContent = role.key;

        item.appendChild(checkbox);
        item.appendChild(label);
        dropdown.appendChild(item);
    });
  }

  function renderTable() {
    renderHead();
    tbody.innerHTML = "";
    updateProjectedProductivity();
    updateActiveDayHoursDisplay();
    updateDayTitle();

    const day = state.activeDay;
    ensureDay(day);
    const schedule = getActiveSchedule();
    const allShifts = schedule[day] || [];

    // --- Filtering Logic ---
    const searchTerm = state.scheduleSearchTerm.toLowerCase().trim();
    const roleFilters = state.scheduleRoleFilters;
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
            // Also match on role name or the text "unassigned"
            return shift.role.toLowerCase().includes(searchTerm) || "sin asignar".includes(searchTerm);
        });
    }
    // --- End Filtering Logic ---

    // --- Render no shifts message ---
    if (allShifts.length === 0) {
        const msgRow = document.createElement("div");
        msgRow.style.padding = "20px";
        msgRow.style.textAlign = "center";
        msgRow.className = "muted";
        msgRow.textContent = "No hay turnos creados para este día. Créalos desde el formulario de arriba.";
        tbody.appendChild(msgRow);
        return;
    }
    if (filteredShifts.length === 0 && hasFilters) {
        const msgRow = document.createElement("div");
        msgRow.style.padding = "20px";
        msgRow.style.textAlign = "center";
        msgRow.className = "muted";
        msgRow.textContent = "No se encontraron turnos que coincidan con los filtros.";
        tbody.appendChild(msgRow);
        return;
    }
    // --- End Render no shifts message ---


    const shiftsByRole = filteredShifts.reduce((acc, shift) => {
        if (!acc[shift.role]) acc[shift.role] = [];
        acc[shift.role].push(shift);
        return acc;
    }, {});

    const sortedRoles = Object.keys(shiftsByRole).sort();

    const createNewShiftRow = () => {
        const newShiftRow = document.createElement("div");
        newShiftRow.className = "rowg new-shift-row";
        newShiftRow.style.gridTemplateColumns = `240px repeat(${SLOTS.length}, 1fr)`;
        const newShiftNamecol = document.createElement("div");
        newShiftNamecol.className = "namecol";
        newShiftRow.appendChild(newShiftNamecol);

        for (let i = 0; i < SLOTS.length; i++) {
            const cell = document.createElement("div");
            cell.className = "slot ghost new-shift-slot";
            cell.dataset.slotIndex = i;
            cell.addEventListener("mousedown", () => handlePaintStart(i));
            cell.addEventListener("mouseenter", () => handlePaintEnter(i));
            newShiftRow.appendChild(cell);
        }
        return newShiftRow;
    };

    const handleAddShiftClick = (role, event) => {
        activeRole.value = role;
        document.querySelectorAll('.add-shift-btn').forEach(b => b.style.display = 'block');
        event.currentTarget.style.display = 'none';

        const existingNewShiftRow = tbody.querySelector('.new-shift-row');
        if (existingNewShiftRow) existingNewShiftRow.remove();

        const newShiftRow = createNewShiftRow();
        event.currentTarget.parentElement.insertAdjacentElement('afterend', newShiftRow);

        const newShiftNamecol = newShiftRow.querySelector('.namecol');
        const activeRoleName = escapeHtml(activeRole.value);
        newShiftNamecol.innerHTML = `<span class="muted" style="font-style: italic;">Nuevo turno para ${activeRoleName}... (pintar)</span>`;
    };

    sortedRoles.forEach(role => {
        const roleShifts = shiftsByRole[role];
        roleShifts.sort((a, b) => a.startSlot - b.startSlot);

        roleShifts.forEach((shift, index) => {
            const cols = `240px repeat(${SLOTS.length}, 1fr)`;
            const row = document.createElement("div");
            row.dataset.shiftId = shift.id;
            if (index === 0) row.style.borderTop = "2px solid #d1d5db";
            row.className = "rowg";
            row.style.gridTemplateColumns = cols;
            row.style.borderBottom = "1px solid var(--border)";

            const namecol = document.createElement("div");
            namecol.className = "namecol";
            namecol.style.flexDirection = "column";
            namecol.style.alignItems = "flex-start";
            namecol.style.justifyContent = "center";
            namecol.style.position = "relative";

            const detailsDiv = document.createElement("div");
            const roleInfo = document.createElement("div");
            roleInfo.style.fontWeight = "600";
            roleInfo.textContent = shift.role;

            const timeInfo = document.createElement("div");
            timeInfo.className = "muted";
            timeInfo.style.fontSize = "12px";
            const startTime = SLOTS[shift.startSlot].label;
            const endTime = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";
            const duration = (shift.endSlot - shift.startSlot + 1) * 0.5;
            timeInfo.textContent = `${startTime} - ${endTime} (${String(duration).replace('.',',')}hs)`;

            const assignWrapper = document.createElement("div");
            assignWrapper.style.marginTop = "4px";
            assignWrapper.className = "row";

            if (shift.employeeId) {
                const emp = state.employees.find(e => e.id === shift.employeeId);
                const empNameSpan = document.createElement("span");

                if (emp) {
                    let nameHtml = escapeHtml(emp.name);
                    if (shift.replacement && shift.replacement.originalEmployeeId) {
                        const originalEmp = getEmployeeById(shift.replacement.originalEmployeeId);
                        if (originalEmp) {
                            nameHtml = `${escapeHtml(emp.name)} <span class="muted" style="font-style: italic;">(cubre a ${escapeHtml(originalEmp.name)})</span>`;
                        }
                    }
                    const weeklyHours = getEmployeeWeeklyHours(emp.id);
                    const hoursText = ` (${String(weeklyHours).replace('.', ',')}hs)`;
                    empNameSpan.innerHTML = nameHtml + hoursText;
                } else {
                    empNameSpan.textContent = "Empleado no encontrado";
                }

                const unassignBtn = document.createElement("button");
                unassignBtn.className = "btn secondary del";
                unassignBtn.innerHTML = "&times;";
                unassignBtn.style.padding = "0px 4px";
                unassignBtn.style.fontSize = "10px";
                unassignBtn.style.lineHeight = "1";
                unassignBtn.style.marginLeft = "8px";
                unassignBtn.title = "Des-asignar empleado";
                unassignBtn.addEventListener("click", () => {
                    commitChange(() => {
                        if (shift.replacement && shift.replacement.originalEmployeeId) {
                            shift.employeeId = shift.replacement.originalEmployeeId;
                            delete shift.replacement;
                        } else {
                            shift.employeeId = null;
                        }
                    });
                });
                assignWrapper.appendChild(empNameSpan);
                assignWrapper.appendChild(unassignBtn);
            } else {
                const assignBtn = document.createElement("button");
                assignBtn.className = "btn secondary";
                assignBtn.textContent = "Asignar";
                assignBtn.style.padding = "2px 8px";
                assignBtn.addEventListener("click", () => openAssignEmployeeModal(shift.id));
                assignWrapper.appendChild(assignBtn);
            }

            detailsDiv.appendChild(roleInfo);
            detailsDiv.appendChild(timeInfo);
            detailsDiv.appendChild(assignWrapper);

            const actionsDiv = document.createElement("div");
            actionsDiv.style.position = "absolute";
            actionsDiv.style.top = "5px";
            actionsDiv.style.right = "5px";
            actionsDiv.className = "row";

            const editBtn = document.createElement("button");
            editBtn.className = "btn secondary";
            editBtn.innerHTML = "&#9998;";
            editBtn.style.padding = "2px 6px";
            editBtn.style.fontSize = "10px";
            editBtn.title = "Editar turno";
            editBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                openEditShiftModal(shift.id);
            });

            const deleteBtn = document.createElement("button");
            deleteBtn.className = "btn secondary del";
            deleteBtn.innerHTML = "&times;";
            deleteBtn.style.padding = "2px 6px";
            deleteBtn.style.fontSize = "10px";
            deleteBtn.title = "Eliminar turno";
            deleteBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if(confirm("¿Eliminar este turno?")) deleteShift(shift.id);
            });

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(deleteBtn);
            namecol.appendChild(detailsDiv);
            namecol.appendChild(actionsDiv);
            row.appendChild(namecol);

            const emp = shift.employeeId ? getEmployeeById(shift.employeeId) : null;
            const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
            const shiftDate = new Date(weekMonday);
            shiftDate.setUTCDate(weekMonday.getUTCDate() + day);
            const isInConflict = emp && isDateInSanctionPeriod(shiftDate, emp.sanctions) && !shift.replacement;

            for (let i = 0; i < SLOTS.length; i++) {
                const cell = document.createElement("div");
                cell.className = "slot";
                cell.addEventListener("click", () => handleSlotClick(shift, i));
                if (i >= shift.startSlot && i <= shift.endSlot) {
                    const roleData = ROLES.find(r => r.key === shift.role);
                    cell.className += " assigned " + (roleData ? clsFor(roleData.key) : "");
                    if(roleData && roleData.darkText) cell.className += " sandwich";
                    if (!shift.employeeId) {
                        cell.className += " unassigned";
                    } else if (isInConflict) {
                        cell.style.boxShadow = `inset 0 0 0 2px var(--c-danger)`;
                    }
                    cell.addEventListener("mousedown", () => handleUnpaintStart(shift.id, i));
                    cell.addEventListener("mouseenter", () => handlePaintEnter(i));
                    cell.addEventListener("mouseup", () => handleUnpaintEnd(i));
                }
                row.appendChild(cell);
            }
            tbody.appendChild(row);
        });

        // Add 'Add Shift' button only if there are no active filters
        if (!hasFilters) {
            const addShiftRow = document.createElement('div');
            addShiftRow.className = 'add-shift-button-row';
            const addButton = document.createElement('button');
            addButton.className = 'add-shift-btn ' + clsFor(role);
            addButton.textContent = '+';
            addButton.title = `Añadir un nuevo turno de ${role}`;
            addButton.addEventListener('click', (e) => handleAddShiftClick(role, e));
            addShiftRow.appendChild(addButton);
            tbody.appendChild(addShiftRow);
        }
    });
  }

  function renderAll(){
    const schedule = getActiveSchedule();
    const isLocked = schedule.isLocked;
    const lockButton = el("#btn-lock-week");
    if (isLocked) {
        lockButton.textContent = "🔒";
        lockButton.title = "Semana bloqueada";
    } else {
        lockButton.textContent = "🔓";
        lockButton.title = "Semana desbloqueada";
    }

    updateWeekDisplay();
    renderProjectedTicketsInput();
    renderDayTabs();
    renderLegend();
    renderEmpList();
    renderTable();
    renderTemplateList();
    if (viewScheduleListEl.style.display !== 'none') {
      renderScheduleList();
    }
    if (viewFrancosEl.style.display !== 'none') {
      renderFrancos();
    }
    if (viewClockInsEl.style.display !== 'none') {
      renderClockInReport();
    }
    if (viewPlanillaTurnoEl.style.display !== 'none') {
      renderPlanillaTurno();
    }
    updateLockUI();
  }

  function updateLockUI() {
    const schedule = getActiveSchedule();
    const isLocked = !!schedule.isLocked;

    const controlsToToggle = [
        '#activeRole', '#formStart', '#formEnd', '#btnAddUnassignedShift', '#btnUndo', '#projectedTickets',
        '#inpTemplateName', '#inpTemplateDesc', '#btnSaveTemplate',
        '#btn-import-text', '#btn-advanced-import-export'
    ];

    controlsToToggle.forEach(selector => {
        const elem = el(selector);
        if (elem) {
            elem.disabled = isLocked;
        }
    });

    el('#templateList')?.querySelectorAll('button').forEach(btn => {
        btn.disabled = isLocked;
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
}

  function renderScheduleList() {
    const content = el("#schedule-list-content");
    content.innerHTML = "";

    const schedule = getActiveSchedule();
    const searchTerm = el("#schedule-list-search").value.toLowerCase();
    const employees = state.employees
        .filter(emp => getEmployeeWeeklyHours(emp.id) > 0)
        .filter(emp => emp.name.toLowerCase().includes(searchTerm))
        .sort((a, b) => a.name.localeCompare(b.name));
    const unassignedShiftsExist = Object.values(schedule).some(day => Array.isArray(day) && day.some(s => !s.employeeId));

    if (employees.length === 0 && !unassignedShiftsExist) {
        content.innerHTML = `<p class="muted">No hay empleados ni turnos para mostrar.</p>`;
        return;
    }

    const table = document.createElement("table");
    table.className = "schedule-list-table";

    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    const weekMonday = new Date(state.activeWeek + "T12:00:00Z");

    headerRow.innerHTML = `<th>Empleado</th>` + DAYS.map((dayName, dayIndex) => {
        const dayDate = new Date(weekMonday);
        dayDate.setDate(weekMonday.getDate() + dayIndex);
        return `<th>${dayName}<br><span class="muted" style="font-size:11px;">${dayDate.getDate()}/${dayDate.getMonth() + 1}</span></th>`;
    }).join('');

    const tbody = table.createTBody();

    // Unassigned Shifts Row (at the top)
    const unassignedRow = tbody.insertRow();
    unassignedRow.dataset.employeeId = "unassigned";
    unassignedRow.insertCell().innerHTML = `<div style="font-weight: 500; font-style: italic;">Turnos sin Asignar</div>`;
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayCell = unassignedRow.insertCell();
        dayCell.dataset.day = dayIndex;
        const unassignedShifts = (schedule[dayIndex] || []).filter(s => !s.employeeId);
        if (unassignedShifts.length > 0) {
            const shiftsContainer = document.createElement('div');
            shiftsContainer.className = 'shifts-container';
            unassignedShifts.forEach(shift => {
                const shiftDiv = document.createElement('div');
                shiftDiv.className = 'schedule-list-shift unassigned-shift-item';
                shiftDiv.dataset.shiftId = shift.id;
                shiftDiv.dataset.dayIndex = dayIndex;
                shiftDiv.draggable = true;
                shiftDiv.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ shiftId: shift.id, dayIndex: dayIndex }));
                    e.dataTransfer.effectAllowed = 'move';
                    setTimeout(() => { shiftDiv.style.opacity = '0.5'; }, 0);
                });
                shiftDiv.addEventListener('dragend', () => { shiftDiv.style.opacity = '1'; });
                const roleInfo = ROLES.find(r => r.key === shift.role);
                if (roleInfo) {
                    shiftDiv.style.backgroundColor = roleInfo.color;
                    shiftDiv.style.color = roleInfo.darkText ? '#111' : '#fff';
                }
                const startTime = SLOTS[shift.startSlot].label;
                const endTime = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";
                shiftDiv.innerHTML = `<div style="font-weight: 500;">${shift.role}</div><div style="font-size: 11px;">${startTime} - ${endTime}</div>`;
                shiftDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showShiftContextMenu(e, shift.id, dayIndex, null);
                });
                shiftsContainer.appendChild(shiftDiv);
            });
            dayCell.appendChild(shiftsContainer);
        }
        addDropListeners(dayCell);
    }

    // Employee Rows
    employees.forEach(emp => {
        const row = tbody.insertRow();
        row.dataset.employeeId = emp.id;
        const weeklyHours = getEmployeeWeeklyHours(emp.id);
        row.insertCell().innerHTML = `<div style="font-weight: 500;">${escapeHtml(emp.name)}</div><div class="muted" style="font-size: 12px;" id="weekly-hours-${emp.id}">Total: ${String(weeklyHours).replace('.', ',')}hs</div>`;

        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
            const dayCell = row.insertCell();
            dayCell.dataset.day = dayIndex;
            const dayShifts = (schedule[dayIndex] || []).filter(s => s.employeeId === emp.id);
            if (dayShifts.length > 0) {
                const shiftsContainer = document.createElement('div');
                shiftsContainer.className = 'shifts-container';
                dayShifts.forEach(shift => {
                    const shiftDiv = document.createElement('div');
                    shiftDiv.className = 'schedule-list-shift';
                    shiftDiv.dataset.shiftId = shift.id;
                    shiftDiv.dataset.dayIndex = dayIndex;
                    shiftDiv.draggable = true;
                    shiftDiv.addEventListener('dragstart', (e) => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ shiftId: shift.id, dayIndex: dayIndex }));
                        e.dataTransfer.effectAllowed = 'move';
                        setTimeout(() => { shiftDiv.style.opacity = '0.5'; }, 0);
                    });
                    shiftDiv.addEventListener('dragend', () => { shiftDiv.style.opacity = '1'; });

                    // Always set role color first to fix the color bug
                    const roleInfo = ROLES.find(r => r.key === shift.role);
                    if (roleInfo) {
                        shiftDiv.style.backgroundColor = roleInfo.color;
                        shiftDiv.style.color = roleInfo.darkText ? '#111' : '#fff';
                    }

                    const startTime = SLOTS[shift.startSlot].label;
                    const endTime = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";
                    let shiftText = `<div style="font-weight: 500;">${shift.role}</div><div style="font-size: 11px;">${startTime} - ${endTime}</div>`;

                    // Display replacement info if it exists
                    if (shift.replacement && shift.replacement.originalEmployeeId) {
                        const originalEmp = getEmployeeById(shift.replacement.originalEmployeeId);
                        if (originalEmp) {
                            const originalDisplayName = originalEmp.displayName || originalEmp.name.split(' ')[0];
                            shiftText += `<div style="font-size: 10px; font-style: italic; margin-top: 2px;">(cubre a ${escapeHtml(originalDisplayName)})</div>`;
                        }
                    }
                    shiftDiv.innerHTML = shiftText;

                    // Check for sanction conflicts for the assigned employee
                    const weekMonday = new Date(state.activeWeek + "T12:00:00Z");
                    const shiftDate = new Date(weekMonday);
                    shiftDate.setUTCDate(weekMonday.getUTCDate() + dayIndex);

                    // A conflict is only shown if the current worker is sanctioned AND it's not a replacement shift
                    if (emp && isDateInSanctionPeriod(shiftDate, emp.sanctions) && !shift.replacement) {
                        shiftDiv.style.border = `2px solid var(--c-danger)`;
                        shiftDiv.title = 'Este turno está en conflicto con una sanción o licencia.';

                        const replaceBtn = document.createElement('button');
                        replaceBtn.textContent = 'Reemplazar';
                        replaceBtn.className = 'btn secondary btn-replace';
                        replaceBtn.dataset.shiftId = shift.id;
                        replaceBtn.dataset.weekId = state.activeWeek;
                        replaceBtn.dataset.dayIndex = dayIndex;
                        replaceBtn.style.padding = '1px 5px';
                        replaceBtn.style.fontSize = '10px';
                        replaceBtn.style.marginTop = '4px';
                        replaceBtn.style.backgroundColor = 'var(--c-danger-bg)';
                        replaceBtn.style.color = 'var(--c-danger-text)';
                        replaceBtn.onclick = (e) => {
                            e.stopPropagation();
                            const { shiftId, weekId, dayIndex } = e.currentTarget.dataset;
                            openReplaceEmployeeModal(shiftId, weekId, dayIndex);
                        };
                        shiftDiv.appendChild(replaceBtn);
                    }

                    shiftDiv.addEventListener('click', (e) => {
                        if (e.target.classList.contains('btn-replace')) return;
                        e.stopPropagation();
                        showShiftContextMenu(e, shift.id, dayIndex, emp.id);
                    });
                    shiftsContainer.appendChild(shiftDiv);
                });
                dayCell.appendChild(shiftsContainer);
            }
            addDropListeners(dayCell);
        }
    });
    content.appendChild(table);
  }

  function addDropListeners(dayCell) {
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

        commitChange(() => {
            // Scenario 1: Dropped on the "Unassigned" row to unassign a shift
            if (targetEmployeeId === 'unassigned') {
                if (!sourceShift.employeeId) return; // Already unassigned
                sourceShift.employeeId = null;
                return;
            }

            const targetEmployee = getEmployeeById(targetEmployeeId);
            if (!targetEmployee) return;

            // Scenario 2: Dropped on another shift (SWAP)
            if (targetShiftElement) {
                const targetShiftId = targetShiftElement.dataset.shiftId;
                if (sourceShiftId === targetShiftId) return; // Dropped on itself

                const targetShift = schedule[targetDayIndex]?.find(s => s.id === targetShiftId);
                if (!targetShift || !targetShift.employeeId) return; // Cannot swap with an unassigned shift

                const sourceEmployee = getEmployeeById(sourceShift.employeeId);
                if (!sourceEmployee) {
                    alert("No se puede intercambiar un turno sin asignar. Arrástrelo a una celda vacía para asignarlo.");
                    return;
                }

                const check1 = canEmployeeWorkShift(targetEmployee, sourceShift, targetDayIndex, { shiftsToIgnore: [targetShift.id] });
                if (!check1.pass) {
                    alert(`No se puede intercambiar: ${check1.message}`);
                    return;
                }
                const check2 = canEmployeeWorkShift(sourceEmployee, targetShift, sourceDayIndex, { shiftsToIgnore: [sourceShift.id] });
                if (!check2.pass) {
                    alert(`No se puede intercambiar: ${check2.message}`);
                    return;
                }
                [targetShift.employeeId, sourceShift.employeeId] = [sourceShift.employeeId, targetShift.employeeId];
            }
            // Scenario 3: Dropped on an empty cell (MOVE / REASSIGN)
            else {
                const sourceEmployeeId = sourceShift.employeeId;
                if (sourceEmployeeId === targetEmployeeId && sourceDayIndex === targetDayIndex) return;

                const ignoreIds = (sourceEmployeeId === targetEmployeeId) ? [sourceShift.id] : [];
                const check = canEmployeeWorkShift(targetEmployee, sourceShift, targetDayIndex, { shiftsToIgnore: ignoreIds });

                if (!check.pass) {
                    alert(`No se puede mover/asignar el turno: ${check.message}`);
                    return;
                }

                // Re-find and splice to prevent duplication bugs
                const originalDayShifts = schedule[sourceDayIndex];
                const shiftIndex = originalDayShifts.findIndex(s => s.id === sourceShift.id);
                if (shiftIndex > -1) {
                    const [shiftToMove] = originalDayShifts.splice(shiftIndex, 1);
                    shiftToMove.employeeId = targetEmployee.id;
                    ensureDay(targetDayIndex);
                    schedule[targetDayIndex].push(shiftToMove);
                }
            }
        });
    });
  }

  function showShiftContextMenu(event, shiftId, dayIndex, employeeId) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.shift-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'shift-context-menu';

    if (employeeId) {
        const btnUnassign = document.createElement('button');
        btnUnassign.textContent = 'Desasignar empleado';
        btnUnassign.onclick = () => {
            const schedule = getActiveSchedule();
            const shift = schedule[dayIndex]?.find(s => s.id === shiftId);
            if (shift) {
                shift.employeeId = null;
                save();
                renderScheduleList(); // Re-render the list to update hours and view
            }
            menu.remove();
        };
        menu.appendChild(btnUnassign);
    }

    const btnGoTo = document.createElement('button');
    btnGoTo.textContent = 'Ir al turno';
    btnGoTo.onclick = () => {
        state.activeDay = dayIndex;
        showView('schedule'); // Switch to the main schedule view

        setTimeout(() => {
            const shiftRow = document.querySelector(`[data-shift-id="${shiftId}"]`);
            if (shiftRow) {
                shiftRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                shiftRow.classList.add('highlight-shift');
                setTimeout(() => {
                    shiftRow.classList.remove('highlight-shift');
                }, 2000);
            }
        }, 100);

        menu.remove();
    };

    menu.appendChild(btnGoTo);


    document.body.appendChild(menu);

    // Position the menu
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;

    // Close the menu when clicking elsewhere
    const closeListener = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeListener);
        }
    };
    setTimeout(() => document.addEventListener('click', closeListener), 0);
  }

  function processAndCompareClockIns(data) {
    const reportDataByEmployee = {};
    const employeesByName = {};
    state.employees.forEach(emp => {
        employeesByName[emp.name.toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, ' ')] = emp;
    });

    const formatDate = (d) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    const formatTime = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;

    const clockInsByEmployee = {};
    let minDate = null, maxDate = null;

    // First pass: Process Excel data and find date range
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[0] || !row[4] || !row[7] || !(row[4] instanceof Date)) continue;

        const employeeName = row[0].toString().toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, ' ');
        const clockInDate = row[4];
        const clockOutDate = row[7];
        const dateKey = toISODateString(clockInDate);

        if (!clockInsByEmployee[employeeName]) {
            clockInsByEmployee[employeeName] = {};
        }
        clockInsByEmployee[employeeName][dateKey] = { clockInDate, clockOutDate };

        if (!minDate || clockInDate < minDate) minDate = clockInDate;
        if (!maxDate || clockInDate > maxDate) maxDate = clockInDate;
    }

    if (!minDate || !maxDate) {
        state.lastClockInReportData = {};
        renderClockInReport();
        return;
    }

    // Second pass: Iterate through all employees and all days in the range
    for (const employee of state.employees) {
        const employeeKey = employee.name;
        const employeeNameNormalized = employee.name.toLowerCase().trim().replace(/,/g, '').replace(/\s+/g, ' ');

        for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
            const dateKey = toISODateString(d);
            const scheduledShift = getScheduleForDate(d).find(s => s.employeeId === employee.id);
            const clockInData = clockInsByEmployee[employeeNameNormalized]?.[dateKey];

            if (!scheduledShift && !clockInData) continue; // Skip days with no activity

            if (!reportDataByEmployee[employeeKey]) {
                reportDataByEmployee[employeeKey] = { name: employeeKey, records: [], totalHours: 0, status: 'ok' };
            }

            const dayName = DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1];
            let scheduledTime = 'Sin turno asignado';
            if (scheduledShift) {
                const startTime = SLOTS[scheduledShift.startSlot].label;
                const endTime = SLOTS[scheduledShift.endSlot + 1] ? SLOTS[scheduledShift.endSlot + 1].label : "02:00";
                scheduledTime = `${startTime} - ${endTime} (${scheduledShift.role})`;
            }

            if (clockInData) {
                const actualHours = (clockInData.clockOutDate - clockInData.clockInDate) / (1000 * 60 * 60);
                reportDataByEmployee[employeeKey].records.push({
                    isoDate: dateKey, date: `${dayName}, ${formatDate(d)}`, scheduled: scheduledTime, clockIn: formatTime(clockInData.clockInDate), clockOut: formatTime(clockInData.clockOutDate), actual: `${actualHours.toFixed(2).replace('.',',')}hs`, status: 'ok'
                });
            } else if (scheduledShift) {
                // Absence detected
                reportDataByEmployee[employeeKey].records.push({
                    isoDate: dateKey, date: `${dayName}, ${formatDate(d)}`, scheduled: scheduledTime, clockIn: 'Ausente', clockOut: '', actual: '0,00hs', status: 'absence'
                });
            }
        }
    }

    // No need to calculate total hours here, it will be done in render
    state.lastClockInReportData = reportDataByEmployee;
    renderClockInReport();
  }

  function renderClockInReport() {
    const content = el("#clock-in-report-content");
    content.innerHTML = '';

    const reportData = state.lastClockInReportData;
    if (!reportData) {
        content.innerHTML = '<p class="muted">Sube un archivo Excel para ver el análisis de fichadas.</p>';
        return;
    }

    const dateFilter = state.clockInDateFilter;
    const searchTerm = state.clockInSearchTerm.toLowerCase();
    const filteredReportData = {};

    for (const empName of Object.keys(reportData)) {
        const originalData = reportData[empName];
        let filteredRecords = originalData.records;

        if (dateFilter) {
            filteredRecords = originalData.records.filter(r => r.isoDate === dateFilter);
        }

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

    // Sort
    if (state.clockInSortOrder === 'hours_desc') {
        employeeNames.sort((a, b) => filteredReportData[b].totalHours - filteredReportData[a].totalHours);
    } else if (state.clockInSortOrder === 'hours_asc') {
        employeeNames.sort((a, b) => filteredReportData[a].totalHours - filteredReportData[b].totalHours);
    } else {
        employeeNames.sort((a, b) => a.localeCompare(b));
    }

    if (employeeNames.length === 0) {
        content.innerHTML = '<p class="muted">No se encontraron fichadas que coincidan con los filtros.</p>';
        return;
    }

    const reportContainer = document.createElement('div');
    reportContainer.className = 'clock-in-report-container';

    employeeNames.forEach(employeeName => {
        const employeeData = filteredReportData[employeeName];
        const card = document.createElement('div');
        card.className = 'employee-clock-in-card';
        if (employeeData.status === 'error') card.classList.add('error-card');

        const title = document.createElement('h3');
        title.className = 'employee-card-title';
        title.innerHTML = `<span>${employeeName}</span><span class="muted">Total: ${employeeData.totalHours.toFixed(2).replace('.',',')}hs</span>`;
        card.appendChild(title);

        const table = document.createElement('table');
        table.className = 'clock-in-table-internal';
        table.innerHTML = `<thead><tr><th>Día</th><th>Turno Asignado</th><th>Entrada</th><th>Salida</th><th>Hs. Hechas</th></tr></thead>`;

        const tbody = table.createTBody();
        employeeData.records.forEach(record => {
            const row = tbody.insertRow();
            if (record.status === 'error') {
                row.classList.add('danger-text');
                row.title = record.message;
            } else if (record.status === 'absence') {
                row.classList.add('absence-row');
                row.title = 'El empleado tenía un turno asignado pero no hay fichada registrada.';
            }
            row.innerHTML = `<td>${record.date}</td><td>${record.scheduled}</td><td>${record.clockIn}</td><td>${record.clockOut}</td><td>${record.actual}</td>`;
        });
        card.appendChild(table);
        reportContainer.appendChild(card);
    });
    content.appendChild(reportContainer);
  }

  /* ====== Detail Panels ====== */

  function renderStarsPanel(container, employeeId) {
      const emp = state.employees.find(e => e.id === employeeId);
      if (!emp) return;

      container.innerHTML = '';
      const panel = document.createElement('div');
      panel.className = 'employee-detail-panel';

      const stars = emp.stars || [];
      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(150px, 1fr))";
      grid.style.gap = "10px";

      const isDarkMode = document.body.classList.contains("dark-mode");
      const offBgColor = isDarkMode ? '#2c2f33' : '#ffffff';
      const offInkColor = isDarkMode ? '#ffffff' : '#171717';
      const offBorderColor = isDarkMode ? '#3a3e44' : '#e5e7eb';

      ROLES.forEach(r => {
          const btn = document.createElement("button");
          const isOn = stars.includes(r.key);
          btn.className = "btn secondary";
          btn.style.justifyContent = "space-between";
          btn.style.display = "flex";
          btn.style.width = "100%";
          btn.innerHTML = `<span>${r.key}</span><span>${isOn ? "★" : ""}</span>`;

          if (isOn) {
              btn.style.background = r.color;
              btn.style.color = r.darkText ? "#111" : "#fff";
              btn.style.borderColor = "transparent";
          } else {
              btn.style.background = offBgColor;
              btn.style.color = offInkColor;
              btn.style.borderColor = offBorderColor;
          }

          btn.addEventListener("click", () => {
              toggleStar(employeeId, r.key);
              renderEmpList(); // Re-render the list to update the panel
          });
          grid.appendChild(btn);
      });

      panel.appendChild(grid);
      container.appendChild(panel);
  }

  function findAvailabilityConflicts(employeeId) {
    const conflicts = [];
    const emp = getEmployeeById(employeeId);
    if (!emp) return conflicts;

    const schedule = getActiveSchedule();
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayShifts = schedule[dayIndex] || [];
        const employeeShiftsOnDay = dayShifts.filter(s => s.employeeId === employeeId);

        for (const shift of employeeShiftsOnDay) {
            // We only check for availability, not other rules like overlap, as this is about *new* availability rules.
            const availabilityCheck = checkEmployeeAvailability(emp, shift, state.activeWeek, dayIndex);
            if (!availabilityCheck.isAvailable) {
                const dayName = DAYS[dayIndex];
                const shiftTime = `${SLOTS[shift.startSlot].label} - ${SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : '??'}`;
                conflicts.push(`Conflicto el ${dayName}: Turno de ${shift.role} (${shiftTime}) choca con la nueva disponibilidad/excepción.`);
            }
        }
    }
    return [...new Set(conflicts)]; // Return unique conflicts
  }

  function isDateInSanctionPeriod(date, sanctions) {
    if (!sanctions || sanctions.length === 0) {
        return false;
    }
    // Sanction dates are stored as 'YYYY-MM-DD' strings.
    // We convert the input date to the same format for direct comparison.
    const dateString = toISODateString(date);

    for (const sanction of sanctions) {
        if (sanction.startDate && sanction.endDate) {
            if (dateString >= sanction.startDate && dateString <= sanction.endDate) {
                return true; // The date falls within a sanction period
            }
        }
    }
    return false;
  }

  function findSanctionConflicts(employeeId) {
    const emp = getEmployeeById(employeeId);
    if (!emp || !emp.sanctions || emp.sanctions.length === 0) {
        return [];
    }

    const conflicts = [];

    // Iterate over every week in the stored schedules
    for (const weekId in state.schedules) {
        if (Object.hasOwnProperty.call(state.schedules, weekId)) {
            const weekSchedule = state.schedules[weekId];
            const weekMonday = new Date(weekId + "T12:00:00Z");

            // Iterate over each day of the week (0-6)
            for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
                const dayShifts = weekSchedule[dayIndex] || [];
                const employeeShiftsOnDay = dayShifts.filter(s => s.employeeId === employeeId);

                if (employeeShiftsOnDay.length > 0) {
                    // Calculate the actual date of the shift
                    const shiftDate = new Date(weekMonday);
                    shiftDate.setUTCDate(weekMonday.getUTCDate() + dayIndex);

                    // Check if this date falls into any sanction period
                    if (isDateInSanctionPeriod(shiftDate, emp.sanctions)) {
                        // It's a conflict. Add details for each shift on this day.
                        for (const shift of employeeShiftsOnDay) {
                            const dayName = DAYS[dayIndex];
                            const shiftTime = `${SLOTS[shift.startSlot].label} - ${SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : '??'}`;
                            const formattedDate = `${dayName} ${shiftDate.getUTCDate()}/${shiftDate.getUTCMonth() + 1}`;

                            conflicts.push({
                                employeeId: emp.id,
                                employeeName: emp.name,
                                shiftId: shift.id,
                                role: shift.role,
                                shiftTime: shiftTime,
                                date: toISODateString(shiftDate),
                                formattedDate: formattedDate,
                                dayIndex: dayIndex,
                                weekId: weekId,
                                message: `Conflicto el ${formattedDate}: Turno de ${shift.role} (${shiftTime}) durante una sanción/licencia.`
                            });
                        }
                    }
                }
            }
        }
    }
    return conflicts;
  }

  function renderAvailabilityPanel(container, employeeId) {
      const emp = getEmployeeById(employeeId);
      if (!emp) return;

      container.innerHTML = '';
      const panel = document.createElement('div');
      panel.className = 'employee-detail-panel';

      if (!emp.availability || Array.isArray(emp.availability)) {
          emp.availability = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
      }

      const conflicts = findAvailabilityConflicts(employeeId);
      let conflictHtml = '';
      if (conflicts.length > 0) {
          conflictHtml = `<div class="warning-text">${conflicts.join('<br>')}</div><div class="hr"></div>`;
      }

      const content = document.createElement('div');
      content.innerHTML = `
          ${conflictHtml}
          <div class="stack">
              <strong>Disponibilidad Semanal</strong>
              ${DAYS.map((day, dayIndex) => {
                  const dayAvailability = emp.availability[dayIndex] || [];
                  const slotsHtml = dayAvailability.length > 0
                      ? dayAvailability.map((slot, slotIndex) => `
                          <div class="row" style="justify-content: space-between; align-items: center; width:100%;">
                              <div class="row">
                                  <select class="select availability-start" data-day="${dayIndex}" data-slot="${slotIndex}">
                                      <option value="">--</option>
                                      ${SLOTS.map(s => `<option value="${s.label}" ${slot.start === s.label ? 'selected' : ''}>${s.label}</option>`).join('')}
                                  </select>
                                  <span>-</span>
                                  <select class="select availability-end" data-day="${dayIndex}" data-slot="${slotIndex}">
                                      <option value="">--</option>
                                      ${SLOTS.map(s => `<option value="${s.label}" ${slot.end === s.label ? 'selected' : ''}>${s.label}</option>`).join('')}
                                  </select>
                              </div>
                              <button class="btn secondary del remove-availability-slot" data-day="${dayIndex}" data-slot="${slotIndex}" style="padding: 2px 6px;">X</button>
                          </div>
                      `).join('')
                      : '<span class="muted" style="font-size:12px; padding-top: 8px;">Día libre / Full-time</span>';

                  return `
                      <div class="row" style="border-top: 1px solid var(--border); padding: 8px 0; align-items: flex-start;">
                          <strong style="width: 120px; padding-top: 8px;">${day}</strong>
                          <div class="stack" style="flex: 1; gap: 8px;">
                              ${slotsHtml}
                              <div style="width: 100%;">
                                  <button class="btn secondary add-availability-slot" data-day="${dayIndex}" style="padding: 2px 8px;">+</button>
                              </div>
                          </div>
                      </div>
                  `;
              }).join('')}
          </div>
          <div class="hr"></div>
          <div style="text-align: right;">
              <button class="btn" id="save-availability">Guardar y Cerrar</button>
          </div>
      `;
      panel.appendChild(content);

      const attachListeners = (p) => {
          p.querySelector("#save-availability").addEventListener("click", () => {
              save();
              const newConflicts = findAvailabilityConflicts(employeeId);
              if (newConflicts.length > 0) {
                  renderAvailabilityPanel(container, employeeId);
              } else {
                  toggleDetailPanel(null, null);
              }
          });

          p.querySelectorAll(".add-availability-slot").forEach(btn => {
              btn.addEventListener("click", (e) => {
                  const dayIndex = e.target.dataset.day;
                  if (!emp.availability[dayIndex]) {
                      emp.availability[dayIndex] = [];
                  }
                  emp.availability[dayIndex].push({ start: null, end: null });
                  renderAvailabilityPanel(container, employeeId);
              });
          });

          p.querySelectorAll(".remove-availability-slot").forEach(btn => {
              btn.addEventListener("click", (e) => {
                  const dayIndex = e.target.dataset.day;
                  const slotIndex = e.target.dataset.slot;
                  if (emp.availability[dayIndex] && emp.availability[dayIndex][slotIndex]) {
                      emp.availability[dayIndex].splice(slotIndex, 1);
                  }
                  renderAvailabilityPanel(container, employeeId);
              });
          });

          p.querySelectorAll(".availability-start, .availability-end").forEach(sel => {
              sel.addEventListener("change", (e) => {
                  const dayIndex = e.target.dataset.day;
                  const slotIndex = e.target.dataset.slot;
                  const type = e.target.classList.contains('availability-start') ? 'start' : 'end';
                  if (emp.availability[dayIndex] && emp.availability[dayIndex][slotIndex]) {
                      emp.availability[dayIndex][slotIndex][type] = e.target.value || null;
                  }
              });
          });
      };

      attachListeners(panel);
      container.appendChild(panel);
  }

  function renderExceptionsPanel(container, employeeId) {
    const emp = getEmployeeById(employeeId);
    if (!emp) return;

    container.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'employee-detail-panel';
    emp.exceptions = emp.exceptions || [];

    const conflicts = findAvailabilityConflicts(employeeId);
    let conflictHtml = '';
    if (conflicts.length > 0) {
        conflictHtml = `<div class="warning-text">${conflicts.join('<br>')}</div><div class="hr"></div>`;
    }

    const formatDate = (dateStr) => {
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    };

    const content = document.createElement('div');
    content.innerHTML = `
      ${conflictHtml}
      <div class="stack">
        <strong>Excepciones</strong>
        <div id="exceptions-list" class="stack">
          ${(emp.exceptions).map(ex => `
            <div class="row" style="justify-content: space-between;">
              <span>${formatDate(ex.date)} ${ex.start ? `de ${ex.start}` : ''} ${ex.end ? `a ${ex.end}`: (ex.start ? '' : '(Todo el día)')}</span>
              <button class="btn secondary del remove-exception" data-date="${ex.date}">X</button>
            </div>
          `).join('')}
        </div>
        <div class="row" style="gap: 8px;">
          <input type="date" id="exception-date" class="input" style="flex:1;">
          <input type="time" id="exception-start" class="input" title="Hora de inicio (opcional)">
          <input type="time" id="exception-end" class="input" title="Hora de fin (opcional)">
          <button id="add-exception" class="btn">Añadir</button>
        </div>
      </div>
      <div class="hr"></div>
      <div style="text-align: right;">
          <button class="btn" id="save-exceptions">Guardar y Cerrar</button>
      </div>
    `;
    panel.appendChild(content);

    const attachListeners = (p) => {
        p.querySelector("#save-exceptions").addEventListener("click", () => {
            save();
            // Re-check conflicts after saving
            const conflicts = findAvailabilityConflicts(employeeId);
            if (conflicts.length > 0) {
                // If conflicts exist, just re-render the panel to show them
                renderExceptionsPanel(container, employeeId);
            } else {
                // If no conflicts, close the panel
                toggleDetailPanel(null, null);
            }
        });

        p.querySelector("#add-exception").addEventListener("click", () => {
          const dateInput = p.querySelector('#exception-date');
          const startInput = p.querySelector('#exception-start');
          const endInput = p.querySelector('#exception-end');
          if (dateInput.value) {
              emp.exceptions.push({ date: dateInput.value, start: startInput.value || null, end: endInput.value || null });
              renderExceptionsPanel(container, employeeId);
          }
        });

        p.querySelectorAll(".remove-exception").forEach(btn => {
          btn.addEventListener("click", (e) => {
            const date = e.target.dataset.date;
            emp.exceptions = emp.exceptions.filter(ex => ex.date !== date);
            renderExceptionsPanel(container, employeeId);
          });
        });
    };

    attachListeners(panel);
    container.appendChild(panel);
  }

  function renderSanctionsPanel(container, employeeId) {
    const emp = getEmployeeById(employeeId);
    if (!emp) return;

    container.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'employee-detail-panel';
    emp.sanctions = emp.sanctions || [];

    const conflicts = findSanctionConflicts(employeeId);
    let conflictHtml = '';
    if (conflicts.length > 0) {
        const conflictItems = conflicts.map(c => `
            <div class="row" style="justify-content: space-between; align-items: center; padding: 4px 0;">
                <span class="warning-text" style="font-size: 13px;">${c.message}</span>
                <button class="btn secondary btn-replace" data-shift-id="${c.shiftId}" data-week-id="${c.weekId}" data-day-index="${c.dayIndex}">Reemplazar</button>
            </div>
        `).join('');
        conflictHtml = `
            <div class="stack" style="gap: 8px; border: 1px solid var(--c-danger); padding: 8px; border-radius: 4px; background-color: var(--c-danger-bg);">
                <strong style="color: var(--c-danger-text);">Conflictos de Horarios Encontrados</strong>
                ${conflictItems}
            </div>
            <div class="hr"></div>`;
    }

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    };

    const content = document.createElement('div');
    content.innerHTML = `
      ${conflictHtml}
      <div class="stack">
        <strong>Sanciones y Licencias</strong>
        <div id="sanctions-list" class="stack">
          ${(emp.sanctions).map((sanc, index) => `
            <div class="row" style="justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
              <div class="stack" style="gap: 2px;">
                <span style="font-weight: 500;">${sanc.description || 'Sin descripción'}</span>
                <span class="muted" style="font-size: 12px;">Del ${formatDate(sanc.startDate)} al ${formatDate(sanc.endDate)}</span>
                ${sanc.integra ? '<span class="badge b-minor" style="font-size: 10px; padding: 2px 4px; width: fit-content;">Pasado en Integra</span>' : ''}
              </div>
              <button class="btn secondary del remove-sanction" data-index="${index}">X</button>
            </div>
          `).join('')}
          ${emp.sanctions.length === 0 ? '<p class="muted">No hay sanciones ni licencias registradas.</p>' : ''}
        </div>
        <div class="hr"></div>
        <strong>Añadir Nueva</strong>
        <div class="row" style="gap: 8px; align-items: flex-end;">
            <div class="stack" style="gap: 4px; flex: 1;">
              <label class="muted" style="font-size:12px;">Descripción</label>
              <input type="text" id="sanction-description" class="input">
            </div>
            <div class="stack" style="gap: 4px;">
              <label class="muted" style="font-size:12px;">Fecha Inicio</label>
              <input type="date" id="sanction-start-date" class="input">
            </div>
            <div class="stack" style="gap: 4px;">
              <label class="muted" style="font-size:12px;">Fecha Fin</label>
              <input type="date" id="sanction-end-date" class="input">
            </div>
        </div>
        <div class="row" style="justify-content: space-between; margin-top: 8px;">
            <div class="row" style="align-items: center; gap: 8px;">
                <input type="checkbox" id="sanction-integra" style="width: 16px; height: 16px;">
                <label for="sanction-integra">Pasado en Integra</label>
            </div>
            <button id="add-sanction" class="btn">Añadir</button>
        </div>
      </div>
      <div class="hr"></div>
      <div style="text-align: right;">
          <button class="btn" id="save-sanctions">Guardar y Cerrar</button>
      </div>
    `;
    panel.appendChild(content);

    const attachListeners = (p) => {
        p.querySelector("#save-sanctions").addEventListener("click", () => {
            save();
            toggleDetailPanel(null, null);
        });

        p.querySelector("#add-sanction").addEventListener("click", () => {
          const descriptionInput = p.querySelector('#sanction-description');
          const startDateInput = p.querySelector('#sanction-start-date');
          const endDateInput = p.querySelector('#sanction-end-date');
          const integraInput = p.querySelector('#sanction-integra');

          if (startDateInput.value && endDateInput.value && descriptionInput.value) {
              if (new Date(endDateInput.value) < new Date(startDateInput.value)) {
                  alert("La fecha de fin no puede ser anterior a la fecha de inicio.");
                  return;
              }
              emp.sanctions.push({
                  id: crypto.randomUUID(),
                  description: descriptionInput.value,
                  startDate: startDateInput.value,
                  endDate: endDateInput.value,
                  integra: integraInput.checked
              });
              renderSanctionsPanel(container, employeeId);
          } else {
              alert("Por favor, complete todos los campos: descripción, fecha de inicio y fecha de fin.");
          }
        });

        p.querySelectorAll(".remove-sanction").forEach(btn => {
          btn.addEventListener("click", (e) => {
            const index = e.target.dataset.index;
            emp.sanctions.splice(index, 1);
            renderSanctionsPanel(container, employeeId);
          });
        });

        p.querySelectorAll(".btn-replace").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const { shiftId, weekId, dayIndex } = e.target.dataset;
                openReplaceEmployeeModal(shiftId, weekId, dayIndex);
            });
        });
    };

    attachListeners(panel);
    container.appendChild(panel);
}

  function openAssignEmployeeModal(shiftId) {
    const wrap = document.createElement("div");
    wrap.style.position="fixed"; wrap.style.inset="0"; wrap.style.background="rgba(0,0,0,.35)";
    wrap.style.display="flex"; wrap.style.alignItems="center"; wrap.style.justifyContent="center"; wrap.style.padding="16px"; wrap.style.zIndex=1000;

    const box = document.createElement("div");
    box.className="card"; box.style.maxWidth="600px"; box.style.width="100%";

    const day = state.activeDay;
    ensureDay(day);
    const schedule = getActiveSchedule();
    const shift = schedule[day].find(s => s.id === shiftId);
    if (!shift) {
        alert("No se encontró el turno.");
        return;
    }

    const shiftDate = new Date(`${state.activeWeek}T12:00:00.000Z`);
    shiftDate.setUTCDate(shiftDate.getUTCDate() + day);

    const h = document.createElement("div");
    h.className="card-h";
    h.innerHTML = `<strong>Asignar empleado a ${shift.role}</strong>`;

    const c = document.createElement("div");
    c.className="card-c stack";

    const listContainer = document.createElement("div");
    listContainer.className = "assign-employee-list";
    listContainer.style.maxHeight = "400px"; // Make the list taller
    listContainer.style.overflowY = "auto";   // And scrollable
    c.appendChild(listContainer);

    const employeesWithStar = state.employees.filter(e => (e.stars || []).includes(shift.role));

    if (employeesWithStar.length === 0) {
        listContainer.textContent = "No hay empleados con la estrella requerida.";
    } else {
        const available = [];
        const withWarnings = [];
        const unavailable = [];

        employeesWithStar.forEach(emp => {
            const minorCheck = !emp.isMinor || shift.endSlot <= MAX_SLOT_FOR_MINOR;
            const overlapCheck = checkShiftOverlap(emp.id, shift, day, []);
            const restCheck = checkRestTime(emp.id, shift, state.activeWeek, day);
            const availabilityCheck = checkEmployeeAvailability(emp, shift, state.activeWeek, day);
            const consecutiveDays = calculateConsecutiveWorkDays(emp.id, state.activeWeek, day);
            const sanctionCheck = isDateInSanctionPeriod(shiftDate, emp.sanctions);

            let hardWarningMessage = "";
            if (sanctionCheck) hardWarningMessage = "El empleado tiene una licencia o sanción para este día.";
            else if (!minorCheck) hardWarningMessage = `Menor de edad no puede trabajar después de las ${SLOTS[MAX_SLOT_FOR_MINOR+1].label}.`;
            else if (!overlapCheck.pass) hardWarningMessage = overlapCheck.message;
            else if (!restCheck.pass) hardWarningMessage = restCheck.message;

            const softWarnings = [];
            if (!availabilityCheck.isAvailable) {
                softWarnings.push(availabilityCheck.reason);
            }
            if (consecutiveDays > 5) {
                softWarnings.push(`Advertencia: Al asignar este turno, ${emp.name} trabajará ${consecutiveDays} días seguidos.`);
            }

            const employeeData = {
                emp,
                isUnavailable: hardWarningMessage !== "",
                hardWarning: hardWarningMessage,
                softWarnings: softWarnings
            };

            if (employeeData.isUnavailable) {
                unavailable.push(employeeData);
            } else if (employeeData.softWarnings.length > 0) {
                withWarnings.push(employeeData);
            } else {
                available.push(employeeData);
            }
        });

        const sortByName = (a, b) => a.emp.name.localeCompare(b.emp.name);
        available.sort(sortByName);
        withWarnings.sort(sortByName);
        unavailable.sort(sortByName);

        const sortedEmployees = [...available, ...withWarnings, ...unavailable];

        sortedEmployees.forEach(data => {
            const { emp, isUnavailable, hardWarning, softWarnings } = data;

            const btn = document.createElement("button");
            btn.className = "btn secondary";
            btn.style.flexDirection = 'column';
            btn.style.alignItems = 'flex-start';
            btn.style.textAlign = 'left';
            btn.style.width = "100%";

            const weeklyHours = getEmployeeWeeklyHours(emp.id);
            const hoursText = `(${String(weeklyHours).replace('.', ',')}hs)`;
            const mainText = document.createElement('div');
            mainText.textContent = `${emp.name} ${hoursText}`;
            btn.appendChild(mainText);

            const weekShifts = getEmployeeShiftsForWeek(emp.id);
            if (weekShifts.length > 0) {
                const summaryText = weekShifts.map(s => {
                    const dayName = DAYS[s.day].slice(0, 2);
                    const startTime = SLOTS[s.startSlot].label;
                    const endTime = SLOTS[s.endSlot + 1] ? SLOTS[s.endSlot + 1].label : '??';
                    return `${dayName} ${s.role.slice(0,3)}. ${startTime}-${endTime}`;
                }).join(' | ');
                const summaryDiv = document.createElement("div");
                summaryDiv.className = "employee-shift-summary";
                summaryDiv.textContent = summaryText;
                btn.appendChild(summaryDiv);
            }

            if (isUnavailable) {
                btn.disabled = true;
                btn.style.cursor = 'not-allowed';
                const warningDiv = document.createElement('div');
                warningDiv.className = 'warning-text';
                warningDiv.textContent = hardWarning;
                btn.appendChild(warningDiv);
            } else {
                softWarnings.forEach(warning => {
                    // We only show the text, the confirmation will bundle them.
                    const warningDiv = document.createElement('div');
                    warningDiv.className = 'warning-text';
                    warningDiv.textContent = warning.split("\n\n")[0]; // Get just the reason text
                    btn.appendChild(warningDiv);
                });
            }

            btn.addEventListener("click", () => {
                if (softWarnings.length > 0) {
                    const fullWarningText = softWarnings.join("\n\n") + "\n\n¿Asignar de todos modos?";
                    if (!confirm(fullWarningText)) {
                        return; // User cancelled
                    }
                }
                commitChange(() => {
                    shift.employeeId = emp.id;
                });
                wrap.remove();
            });

            listContainer.appendChild(btn);
        });
    }

    const f = document.createElement("div"); f.style.textAlign="right"; f.style.marginTop="12px";
    const cancel = document.createElement("button"); cancel.className="btn"; cancel.textContent="Cancelar";
    cancel.addEventListener("click", ()=> wrap.remove());
    f.appendChild(cancel);

    box.appendChild(h); box.appendChild(c); box.appendChild(f);
    wrap.appendChild(box);
    // Make modal persistent by not adding the close-on-click-outside listener
    // wrap.addEventListener("click",(e)=>{ if(e.target===wrap) wrap.remove(); });
    document.body.appendChild(wrap);
}

  function openReplaceEmployeeModal(shiftId, weekId, dayIndex) {
    const wrap = document.createElement("div");
    wrap.style.position="fixed"; wrap.style.inset="0"; wrap.style.background="rgba(0,0,0,.35)";
    wrap.style.display="flex"; wrap.style.alignItems="center"; wrap.style.justifyContent="center"; wrap.style.padding="16px"; wrap.style.zIndex=1001; // Higher z-index

    const box = document.createElement("div");
    box.className="card"; box.style.maxWidth="700px"; box.style.width="100%";

    const schedule = state.schedules[weekId];
    if (!schedule) { alert("Error: No se encontró la semana del turno."); return; }
    const daySchedule = schedule[dayIndex];
    if (!daySchedule) { alert("Error: No se encontró el día del turno."); return; }
    const shift = daySchedule.find(s => s.id === shiftId);
    if (!shift) { alert("Error: No se pudo encontrar el turno a reemplazar."); return; }

    const originalEmployee = getEmployeeById(shift.employeeId);

    const h = document.createElement("div");
    h.className="card-h";
    h.innerHTML = `<strong>Reemplazar a ${originalEmployee ? originalEmployee.name : 'N/A'}</strong>`;

    const c = document.createElement("div");
    c.className="card-c stack";
    const subheader = document.createElement("p");
    subheader.className = "muted";
    const shiftTime = `${SLOTS[shift.startSlot].label} - ${SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : '??'}`;
    subheader.innerHTML = `Buscando reemplazo para el turno de <strong>${shift.role}</strong> (${shiftTime})`;
    c.appendChild(subheader);


    const listContainer = document.createElement("div");
    listContainer.className = "assign-employee-list";
    c.appendChild(listContainer);

    // Filter for eligible employees
    const eligibleEmployees = state.employees.filter(emp => {
        if (emp.id === shift.employeeId) return false; // Can't replace with self
        if (emp.isMinor && shift.endSlot > MAX_SLOT_FOR_MINOR) {
            return false; // Minor can't work this late
        }
        return true;
    }).sort((a,b) => a.name.localeCompare(b.name));


    if (eligibleEmployees.length === 0) {
        listContainer.textContent = "No hay empleados elegibles para este reemplazo.";
    } else {
        eligibleEmployees.forEach(emp => {
            const btn = document.createElement("button");
            btn.className = "btn secondary";
            btn.style.width = "100%";
            btn.textContent = emp.name;

            btn.addEventListener("click", () => {
                if (confirm(`¿Asignar a ${emp.name} como reemplazo?`)) {
                    // If there's no replacement object yet, this is the first replacement.
                    // We store the original employee's ID.
                    if (!shift.replacement) {
                        shift.replacement = { originalEmployeeId: shift.employeeId };
                    }
                    // The main employeeId is now the person covering the shift.
                    shift.employeeId = emp.id;
                    save();
                    renderAll();
                    wrap.remove();
                }
            });

            listContainer.appendChild(btn);
        });
    }

    const f = document.createElement("div"); f.style.textAlign="right"; f.style.marginTop="12px";
    const cancel = document.createElement("button"); cancel.className="btn"; cancel.textContent="Cancelar";
    cancel.addEventListener("click", ()=> wrap.remove());
    f.appendChild(cancel);

    box.appendChild(h); box.appendChild(c); box.appendChild(f);
    wrap.appendChild(box);
    wrap.addEventListener("click",(e)=>{ if(e.target===wrap) wrap.remove(); });
    document.body.appendChild(wrap);
  }

  function openEditShiftModal(shiftId) {
    const wrap = document.createElement("div");
    wrap.style.position="fixed"; wrap.style.inset="0"; wrap.style.background="rgba(0,0,0,.35)";
    wrap.style.display="flex"; wrap.style.alignItems="center"; wrap.style.justifyContent="center"; wrap.style.padding="16px"; wrap.style.zIndex=1000;

    const box = document.createElement("div");
    box.className="card"; box.style.maxWidth="400px"; box.style.width="100%";

    const day = state.activeDay;
    ensureDay(day);
    const schedule = getActiveSchedule();
    const shift = schedule[day].find(s => s.id === shiftId);
    if (!shift) {
        alert("No se encontró el turno.");
        return;
    }

    const h = document.createElement("div"); h.className="card-h";
    h.innerHTML = `<strong>Editar turno</strong>`;
    const c = document.createElement("div"); c.className="card-c stack";

    const roleLabel = document.createElement("div"); roleLabel.className="muted"; roleLabel.textContent="Rol";
    const roleSelect = document.createElement("select"); roleSelect.className="select";
    optionize(roleSelect, ROLES, r => ({value: r.key, label: r.key}));
    roleSelect.value = shift.role;

    const startLabel = document.createElement("div"); startLabel.className="muted"; startLabel.textContent="Inicio";
    const startSelect = document.createElement("select"); startSelect.className="select";
    optionize(startSelect, SLOTS, s => ({value: s.index, label: s.label}));
    startSelect.value = shift.startSlot;

    const endLabel = document.createElement("div"); endLabel.className="muted"; endLabel.textContent="Fin (exclusivo)";
    const endSelect = document.createElement("select"); endSelect.className="select";
    optionize(endSelect, SLOTS, s => ({value: s.index, label: s.label}));
    endSelect.value = shift.endSlot + 1;

    c.appendChild(roleLabel); c.appendChild(roleSelect);
    c.appendChild(startLabel); c.appendChild(startSelect);
    c.appendChild(endLabel); c.appendChild(endSelect);

    const f = document.createElement("div"); f.style.textAlign="right"; f.style.marginTop="12px";
    const saveBtn = document.createElement("button"); saveBtn.className="btn"; saveBtn.textContent="Guardar";
    saveBtn.addEventListener("click", () => {
        const newRole = roleSelect.value;
        const newStart = Number(startSelect.value);
        const newEnd = Number(endSelect.value);

        if (newEnd <= newStart) {
            alert("La hora de fin debe ser posterior a la hora de inicio.");
            return;
        }

        const newEndSlot = newEnd - 1;
        const emp = state.employees.find(e => e.id === shift.employeeId);
        if (emp && emp.isMinor && newEndSlot > MAX_SLOT_FOR_MINOR) {
            alert("Un menor de edad no puede trabajar después de las 20:00.");
            return;
        }

        // Check 12-hour rule before saving edit
        if (emp) {
            const tempShift = { ...shift, role: newRole, startSlot: newStart, endSlot: newEndSlot };
            const { pass, message } = checkRestTime(emp.id, tempShift, state.activeWeek, day);
            if (!pass) {
                alert(message);
                return;
            }

            // Check availability before saving edit
            const availabilityCheck = checkEmployeeAvailability(emp, tempShift, state.activeWeek, day);
            if (!availabilityCheck.isAvailable) {
                if (!confirm(availabilityCheck.reason + "\n\n¿Guardar de todos modos?")) {
                    return;
                }
            }
        }

        commitChange(() => {
            shift.role = newRole;
            shift.startSlot = newStart;
            shift.endSlot = newEndSlot;

            if (shift.employeeId) {
                const emp = state.employees.find(e => e.id === shift.employeeId);
                if (emp && !(emp.stars || []).includes(newRole)) {
                    alert(`El empleado asignado (${emp.name}) no tiene la estrella "${newRole}", por lo que será des-asignado.`);
                    shift.employeeId = null;
                }
            }
        });
        wrap.remove();
    });
    const cancelBtn = document.createElement("button"); cancelBtn.className="btn secondary"; cancelBtn.textContent="Cancelar";
    cancelBtn.addEventListener("click", () => wrap.remove());

    f.appendChild(cancelBtn);
    f.appendChild(saveBtn);

    box.appendChild(h); box.appendChild(c); box.appendChild(f);
    wrap.appendChild(box);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
  }

  /* ====== Utils ====== */
  function clsFor(role){
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
  function slotCls(role){
    const k = role.toLowerCase();
    return k==="sandwich" ? " sandwich" : "";
  }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;" }[c])); }

  /* ====== Inicializa selects fijos ====== */
  // Relleno selects de cabecera
  optionize(document.getElementById("activeRole"), ROLES, r=>({value:r.key,label:r.key}));
  optionize(empFilter, [{key:"",name:"Todos"},...ROLES.map(r=>({key:r.key,name:r.key}))], x=>({value:x.key,label:x.name}));

  /* ====== Plantillas ====== */
  function renderTemplateList() {
    templateList.innerHTML = "";
    const templates = state.templates || {};
    const templateNames = Object.keys(templates).sort();

    if (templateNames.length === 0) {
        const p = document.createElement("div");
        p.className="muted"; p.textContent="No hay plantillas guardadas.";
        templateList.appendChild(p);
        return;
    }

    templateNames.forEach(name => {
        const template = templates[name];
        const templateShifts = Array.isArray(template) ? template : template.shifts || [];
        const description = Array.isArray(template) ? '' : template.description || '';

        const shiftCount = templateShifts.length;
        let totalSlots = 0;
        templateShifts.forEach(shift => {
            totalSlots += (shift.endSlot - shift.startSlot + 1);
        });
        const totalHours = totalSlots * 0.5;

        const card = document.createElement("div");
        card.style.border="1px solid var(--border)"; card.style.padding="12px";
        card.className = "row";
        card.style.justifyContent = "space-between";
        card.style.alignItems = "flex-start";

        const infoDiv = document.createElement("div");
        infoDiv.className = "stack";
        infoDiv.style.gap = "4px";

        const label = document.createElement("strong");
        label.textContent = name;

        const details = document.createElement("div");
        details.className = "muted";
        details.style.fontSize = "12px";
        details.textContent = `${shiftCount} turnos, ${String(totalHours).replace('.',',')}hs en total`;

        infoDiv.appendChild(label);
        if (description) {
            const descP = document.createElement("p");
            descP.className = 'muted';
            descP.style.fontSize = '13px';
            descP.style.margin = '4px 0 0 0';
            descP.style.maxWidth = '600px';
            descP.textContent = description;
            infoDiv.appendChild(descP);
        }
        infoDiv.appendChild(details);
        card.appendChild(infoDiv);

        const actions = document.createElement("div");
        actions.className = "row";

        const applyBtn = document.createElement("button");
        applyBtn.className = "btn";
        applyBtn.textContent = "Aplicar";
        applyBtn.addEventListener("click", () => applyTemplate(name));

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn secondary del";
        deleteBtn.textContent = "Eliminar";
        deleteBtn.addEventListener("click", () => deleteTemplate(name));

        actions.appendChild(applyBtn);
        actions.appendChild(deleteBtn);
        card.appendChild(actions);
        templateList.appendChild(card);
    });
  }

  function saveCurrentDayAsTemplate() {
    const name = inpTemplateName.value.trim();
    if (!name) {
      alert("Por favor, ingresa un nombre para la plantilla.");
      return;
    }
    if (state.templates[name] && !confirm("Ya existe una plantilla con este nombre. ¿Deseas sobreescribirla?")) {
        return;
    }

    const schedule = getActiveSchedule();
    const daySchedule = schedule[state.activeDay] || [];
    const inpTemplateDesc = el("#inpTemplateDesc");
    const description = inpTemplateDesc.value.trim();

    const templateShifts = JSON.parse(JSON.stringify(daySchedule));
    templateShifts.forEach(shift => {
      shift.employeeId = null;
    });

    state.templates = state.templates || {};
    state.templates[name] = {
        shifts: templateShifts,
        description: description
    };

    save();
    renderTemplateList();
    inpTemplateName.value = "";
    inpTemplateDesc.value = "";
    alert(`Plantilla "${name}" guardada.`);
  }

  btnSaveTemplate.addEventListener("click", saveCurrentDayAsTemplate);

  function applyTemplate(name) {
    if (!confirm(`¿Aplicar la plantilla "${name}"? Se reemplazarán todos los turnos del día actual.`)) return;

    const template = state.templates[name];
    if (!template) {
      alert("No se encontró la plantilla.");
      return;
    }

    // Handle both old and new template formats for backward compatibility
    const templateShifts = Array.isArray(template) ? template : template.shifts || [];

    // Deep copy and assign new IDs
    const newShifts = JSON.parse(JSON.stringify(templateShifts));
    newShifts.forEach(shift => {
      shift.id = crypto.randomUUID();
    });

    commitChange(() => {
        const schedule = getActiveSchedule();
        schedule[state.activeDay] = newShifts;
    });
    showView('schedule');
  }

  function deleteTemplate(name) {
    if (!confirm(`¿Estás seguro de que quieres eliminar la plantilla "${name}"?`)) return;

    if (state.templates && state.templates[name]) {
      delete state.templates[name];
      save();
      renderTemplateList();
    }
  }

  /* ====== Impresión ====== */
  function printSchedule() {
    const schedule = getActiveSchedule();
    const employees = state.employees
        .filter(emp => getEmployeeWeeklyHours(emp.id) > 0)
        .sort((a,b) => a.name.localeCompare(b.name));

    const monday = new Date(state.activeWeek + "T12:00:00Z");
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const formatDate = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

    let tableRows = '';
    employees.forEach(emp => {
      let row = `<tr><td>${escapeHtml(emp.name)}</td>`;
      for (let i = 0; i < 7; i++) {
        const dayShifts = (schedule[i] || []).filter(s => s.employeeId === emp.id);
        if (dayShifts.length > 0) {
          const shift = dayShifts[0]; // Assume one shift per day per employee
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

    const printWindow = window.open('', '', 'height=800,width=1200');
    printWindow.document.write(`
      <html>
        <head>
          <title>Planilla de Horarios</title>
          <style>
            body { font-family: sans-serif; margin: 20px; font-size: 10px; }
            h1, h2, p { text-align: center; margin: 2px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #ccc; padding: 5px; text-align: center; }
            th { background-color: #f2f2f2; }
            @media print {
              @page {
                margin: 0;
              }
              body {
                margin: 0.5in;
              }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <h2>Departamento: KFC LA PLATA</h2>
          <h1 style="font-size: 11px;">PLANILLA DE HORARIOS CONFORME AL ART. 6 DE LEY 11544</h1>
          <p style="font-size: 11px;">Semana del: ${formatDate(monday)} al ${formatDate(sunday)}</p>
          <table>
            <thead>
              <tr>
                <th>Apellido y Nombre</th>
                ${DAYS.map(d => `<th>${d}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
          <script>
            setTimeout(() => { window.print(); window.close(); }, 250);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  function printDailyPlanning() {
    const schedule = getActiveSchedule();
    const employees = state.employees;
    const weekMonday = new Date(state.activeWeek + "T12:00:00Z");

    let pagesHtml = '';

    for (let i = 0; i < 7; i++) {
      const dayShifts = (schedule[i] || []).filter(s => s.employeeId);
      if (dayShifts.length === 0) continue; // Skip days with no assigned shifts

      const dayDate = new Date(weekMonday);
      dayDate.setDate(weekMonday.getDate() + i);
      const dayName = DAYS[i];
      const formattedDate = `${dayName} ${dayDate.getDate()} de ${dayDate.toLocaleString('es-ES', { month: 'long' })} de ${dayDate.getFullYear()}`;

      let tableRows = '';
      dayShifts.sort((a, b) => a.startSlot - b.startSlot).forEach(shift => {
        const emp = employees.find(e => e.id === shift.employeeId);
        if (!emp) return;

        const shiftHours = (shift.endSlot - shift.startSlot + 1) * 0.5;
        const startTimeLabel = SLOTS[shift.startSlot].label;
        const endTimeLabel = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";

        let timelineCells = '';
        for (let j = 0; j < SLOTS.length; j++) {
          const inShift = j >= shift.startSlot && j <= shift.endSlot;
          timelineCells += `<td class="${inShift ? 'in-shift' : ''}">${inShift ? 'A' : ''}</td>`;
        }

        tableRows += `
          <tr>
            <td>${escapeHtml(emp.name)}<br><span class="time-range">${startTimeLabel} a ${endTimeLabel}</span></td>
            <td>${escapeHtml(shift.role)}</td>
            <td>${String(shiftHours).replace('.', ',')}</td>
            ${timelineCells}
          </tr>
        `;
      });

      const headcount = calculateHeadcountPerSlot(i);
      let headcountHeader = '';
      headcount.forEach(count => {
        headcountHeader += `<th>${count > 0 ? count : ''}</th>`;
      });

      let timelineHeader = '';
      SLOTS.forEach(slot => {
        timelineHeader += `<th>${slot.label.split(':')[0]}</th>`;
      });

      const totalHours = calculateTotalDayHours(i);
      const weekTickets = state.projectedTickets[state.activeWeek] || {};
      const tickets = Number(weekTickets[i] || 0);
      let productivity = '-';
      if (tickets > 0 && totalHours > 0) {
          productivity = (tickets / totalHours).toFixed(1);
      }

      pagesHtml += `
        <div class="page">
          <div class="page-header">
            <span>Departamento: KFC LA PLATA</span>
            <span>${formattedDate}</span>
          </div>
          <div style="text-align: center; margin: 5px 0; font-size: 11px; padding-bottom: 5px; border-bottom: 1px solid #ccc;">
            <span style="margin-right: 15px;">Horas Totales: <strong>${String(totalHours).replace('.',',')}hs</strong></span>
            <span style="margin-right: 15px;">Tickets Proyectados: <strong>${tickets}</strong></span>
            <span>Productividad: <strong>${productivity}</strong></span>
          </div>
          <table class="daily-planning-table">
            <thead>
              <tr>
                <th style="width: 200px; border: none; background: none;"></th>
                <th style="width: 100px; border: none; background: none;"></th>
                <th style="width: 50px; border: none; background: none;"></th>
                ${headcountHeader}
              </tr>
              <tr>
                <th style="width: 200px;">Empleado</th>
                <th style="width: 100px;">Pos.</th>
                <th style="width: 50px;">Hs.</th>
                ${timelineHeader}
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      `;
    }

    const printWindow = window.open('', '', 'height=800,width=1200');
    printWindow.document.write(`
      <html>
        <head>
          <title>Planificación Diaria</title>
          <style>
            body { font-family: sans-serif; }
            @media print {
              @page {
                size: landscape;
                margin: 0;
              }
              body {
                margin: 0.5in;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
            .page {
              page-break-after: always;
              width: 100%;
            }
            .page:last-child {
              page-break-after: auto;
            }
            .page-header {
              display: flex;
              justify-content: space-between;
              font-weight: bold;
              margin-bottom: 10px;
              font-size: 14px;
            }
            .daily-planning-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 9px;
            }
            .daily-planning-table th, .daily-planning-table td {
              border: 1px solid #999;
              padding: 3px;
              text-align: center;
              white-space: nowrap;
            }
            .daily-planning-table th {
              background-color: #f0f0f0;
            }
            .daily-planning-table td:first-child {
                text-align: left;
                font-weight: bold;
            }
            .daily-planning-table .time-range {
              font-size: 8px;
              font-weight: normal;
              color: #333;
            }
            .daily-planning-table td.in-shift {
              background-color: #c9e6b3 !important;
            }
          </style>
        </head>
        <body>
          ${pagesHtml}
          <script>
            setTimeout(() => { window.print(); window.close(); }, 250);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  el("#btnPrint").addEventListener("click", () => {
    printModal.style.display = "flex";
  });

  printModalClose.addEventListener("click", () => {
    printModal.style.display = "none";
  });

  printModal.addEventListener("click", (e) => {
    if (e.target === printModal) {
      printModal.style.display = "none";
    }
  });

  btnPrintScheduleList.addEventListener("click", () => {
    printSchedule();
    printModal.style.display = "none";
  });

  btnPrintDailyPlanning.addEventListener("click", () => {
    printDailyPlanning();
    printModal.style.display = "none";
  });

  /* ====== Import from Text Modal ====== */
  function importShiftsFromText() {
    const text = importTextArea.value.trim();
    if (!text) {
      alert("El área de texto está vacía.");
      return;
    }

    const lines = text.split('\n');
    const newShifts = [];
    const errors = [];

    // Regex to capture HH:MM a HH:MM      ROLE
    const timeRegex = /(\d{2}:\d{2})\s+a\s+(\d{2}:\d{2})\s+(.+)/;

    lines.forEach((line, index) => {
      line = line.trim();
      if (!line) return; // Skip empty lines

      const match = line.match(timeRegex);
      if (!match) {
        errors.push(`Línea ${index + 1}: Formato incorrecto. Debe ser "HH:MM a HH:MM ROL".`);
        return;
      }

      const [, startTime, endTime, roleRaw] = match;
      const roleName = roleRaw.trim();

      // Find the role in ROLES, case-insensitive, and also trying to match without diacritics
      let role = ROLES.find(r => r.key.toLowerCase() === roleName.toLowerCase());
      if (!role) {
        const normalizedRoleName = roleName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        role = ROLES.find(r => r.key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === normalizedRoleName);
      }

      if (!role) {
        errors.push(`Línea ${index + 1}: Rol "${roleName}" no reconocido.`);
        return;
      }

      const startSlot = timeToSlotIndex(startTime);
      const endSlotIndex = timeToSlotIndex(endTime);

      if (startSlot === -1 || endSlotIndex === -1) {
        errors.push(`Línea ${index + 1}: Hora inválida ("${startTime}" o "${endTime}"). Use formato HH:MM.`);
        return;
      }

      if (endSlotIndex <= startSlot) {
        errors.push(`Línea ${index + 1}: La hora de fin debe ser posterior a la de inicio.`);
        return;
      }

      newShifts.push({
        id: crypto.randomUUID(),
        role: role.key, // Use the canonical role name from ROLES
        startSlot: startSlot,
        endSlot: endSlotIndex - 1, // end is inclusive
        employeeId: null
      });
    });

    if (errors.length > 0) {
      alert("Se encontraron errores al procesar el texto:\n\n" + errors.join("\n"));
      return;
    }

    if (newShifts.length === 0) {
      alert("No se encontraron turnos válidos para importar.");
      return;
    }

    if (!confirm(`Se procesaron ${newShifts.length} turnos. ¿Desea reemplazar los turnos del día actual con estos?`)) {
      return;
    }

    const activeSchedule = getActiveSchedule();
    activeSchedule[state.activeDay] = newShifts;

    save();
    renderAll();
    importTextModal.style.display = "none"; // Close modal on success
    alert(`${newShifts.length} turnos importados con éxito.`);
  }

  btnImportText.addEventListener("click", () => {
    importTextArea.value = '';
    importTextModal.style.display = "flex";
  });

  const closeImportTextModal = () => {
    importTextModal.style.display = "none";
  };
  importTextModalClose.addEventListener("click", closeImportTextModal);
  btnImportTextCancel.addEventListener("click", closeImportTextModal);
  importTextModal.addEventListener("click", (e) => {
    if (e.target === importTextModal) {
      closeImportTextModal();
    }
  });
  btnImportTextProcess.addEventListener("click", importShiftsFromText);

  /* ====== Advanced Import/Export Modal ====== */
  const advancedImportExportModal = el("#advanced-import-export-modal");
  const btnAdvancedImportExport = el("#btn-advanced-import-export");
  const advancedImportExportModalClose = el("#advanced-import-export-modal-close");

  btnAdvancedImportExport.addEventListener("click", () => {
    advancedImportExportModal.style.display = "flex";
  });

  /* ====== New Import/Export handlers ====== */

  function exportEmployees() {
    const dataStr = JSON.stringify(state.employees, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `empleados-${toISODateString(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  el("#btn-export-employees").addEventListener("click", exportEmployees);

  function importEmployees(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedEmployees = JSON.parse(e.target.result);
        if (!Array.isArray(importedEmployees)) {
          alert("Error: El archivo no contiene una lista de empleados válida.");
          return;
        }

        const existingIds = new Set(state.employees.map(emp => emp.id));
        const newEmployees = importedEmployees.filter(emp => emp.id && !existingIds.has(emp.id));

        if (newEmployees.length === 0) {
          alert("No se encontraron nuevos empleados para importar. Todos los IDs en el archivo ya existen.");
          return;
        }

        if (confirm(`Se encontraron ${newEmployees.length} empleados nuevos. ¿Desea importarlos?`)) {
          state.employees.push(...newEmployees);
          save();
          renderAll();
          alert(`${newEmployees.length} empleados importados con éxito.`);
          closeAdvancedImportExportModal();
        }
      } catch (err) {
        console.error("Error al importar empleados:", err);
        alert("Error al procesar el archivo. Asegúrese de que sea un JSON válido.");
      } finally {
        // Reset the file input so the user can select the same file again
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  }
  el("#file-import-employees").addEventListener("change", importEmployees);

  function exportDay() {
    const activeSchedule = getActiveSchedule();
    const dayShifts = activeSchedule[state.activeDay] || [];
    const dataStr = JSON.stringify(dayShifts, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dayName = DAYS[state.activeDay];
    a.download = `dia-${dayName}-${toISODateString(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  el("#btn-export-day").addEventListener("click", exportDay);

  function importDay(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedShifts = JSON.parse(e.target.result);

        // Basic validation
        if (!Array.isArray(importedShifts) || (importedShifts.length > 0 && (!importedShifts[0].hasOwnProperty('role') || !importedShifts[0].hasOwnProperty('startSlot')))) {
          alert("Error: El archivo no parece contener una lista de turnos válida para un día.");
          return;
        }

        if (confirm(`¿Importar ${importedShifts.length} turnos al día actual? Los turnos existentes en este día serán reemplazados.`)) {
          const activeSchedule = getActiveSchedule();
          // Assign new IDs to prevent duplicates and issues with other features
          const newShifts = importedShifts.map(shift => ({...shift, id: crypto.randomUUID()}));
          activeSchedule[state.activeDay] = newShifts;
          save();
          renderAll();
          alert(`Se importaron ${newShifts.length} turnos con éxito.`);
          closeAdvancedImportExportModal();
        }
      } catch (err) {
        console.error("Error al importar el día:", err);
        alert("Error al procesar el archivo. Asegúrese de que sea un JSON válido.");
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  }
  el("#file-import-day").addEventListener("change", importDay);

  function exportWeek() {
    const includeAssignments = el("#chk-include-assignments").checked;
    let weekSchedule = getActiveSchedule();

    if (!includeAssignments) {
      // Deep copy to avoid modifying the current state
      weekSchedule = JSON.parse(JSON.stringify(weekSchedule));
      for (const day in weekSchedule) {
        weekSchedule[day].forEach(shift => {
          shift.employeeId = null;
        });
      }
    }

    const dataStr = JSON.stringify(weekSchedule, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `semana-${state.activeWeek}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  el("#btn-export-week").addEventListener("click", exportWeek);

  function importWeek(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedWeek = JSON.parse(e.target.result);

        // Basic validation: check if it's an object and its keys are numbers (day indices)
        if (typeof importedWeek !== 'object' || importedWeek === null || Array.isArray(importedWeek)) {
          alert("Error: El archivo no parece ser un objeto de semana válido.");
          return;
        }

        if (confirm(`¿Importar esta semana? Se reemplazarán todos los turnos de la semana actual.`)) {
          // Deep copy and assign new IDs to all shifts
          const newWeekSchedule = JSON.parse(JSON.stringify(importedWeek));
          for (const day in newWeekSchedule) {
            if (Array.isArray(newWeekSchedule[day])) {
              newWeekSchedule[day].forEach(shift => {
                shift.id = crypto.randomUUID();
              });
            }
          }

          state.schedules[state.activeWeek] = newWeekSchedule;
          save();
          renderAll();
          alert(`La semana se importó con éxito.`);
          closeAdvancedImportExportModal();
        }
      } catch (err) {
        console.error("Error al importar la semana:", err);
        alert("Error al procesar el archivo. Asegúrese de que sea un JSON válido.");
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  }
  el("#file-import-week").addEventListener("change", importWeek);


  const closeAdvancedImportExportModal = () => {
    advancedImportExportModal.style.display = "none";
  };

  advancedImportExportModalClose.addEventListener("click", closeAdvancedImportExportModal);
  advancedImportExportModal.addEventListener("click", (e) => {
    if (e.target === advancedImportExportModal) {
      closeAdvancedImportExportModal();
    }
  });


  /* ====== Dark Mode ====== */
  const darkModeBtn = el("#btn-dark-mode");
  const body = document.body;

  function setDarkMode(isDark) {
    if (isDark) {
      body.classList.add("dark-mode");
      darkModeBtn.textContent = "☀️";
      localStorage.setItem("darkMode", "enabled");
    } else {
      body.classList.remove("dark-mode");
      darkModeBtn.textContent = "🌙";
      localStorage.setItem("darkMode", "disabled");
    }
  }

  darkModeBtn.addEventListener("click", () => {
    setDarkMode(!body.classList.contains("dark-mode"));
  });

  // Load theme preference on start
  if (localStorage.getItem("darkMode") === "enabled") {
    setDarkMode(true);
  }

  /* ====== Dropdown ====== */
  const actionsButton = el("#btn-actions");
  const actionsDropdown = el("#actions-dropdown");

  if(actionsButton) {
    actionsButton.addEventListener("click", (e) => {
      e.stopPropagation();
      actionsDropdown.classList.toggle("show");
      roleFilterDropdown.classList.remove("show");
    });
  }

  projectedTickets.addEventListener("input", () => {
    const { activeWeek, activeDay } = state;
    const tickets = projectedTickets.value;

    if (!state.projectedTickets[activeWeek]) {
        state.projectedTickets[activeWeek] = {};
    }
    state.projectedTickets[activeWeek][activeDay] = tickets;

    save();
    updateProjectedProductivity();
  });

  /* ====== Resumen Semanal ====== */
  const weeklySummaryModal = el("#weekly-summary-modal");
  const btnWeeklySummary = el("#btn-weekly-summary");
  const weeklySummaryModalClose = el("#weekly-summary-modal-close");
  const weeklySummaryContent = el("#weekly-summary-content");
  const weeklySummaryTitle = el("#weekly-summary-title");

  function renderWeeklySummary() {
    // Set title
    const monday = new Date(state.activeWeek + "T12:00:00Z");
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const formatDate = (d) => `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}`;
    if(weeklySummaryTitle) weeklySummaryTitle.textContent = `Semana del ${formatDate(monday)} al ${formatDate(sunday)}`;

    const sortOrder = state.weeklySummarySort || 'alpha';
    let employees = state.employees.slice();

    if (employees.length === 0) {
      weeklySummaryContent.innerHTML = `<p class="muted">No hay empleados para mostrar.</p>`;
      return;
    }

    // Pre-calculate data for sorting
    const employeeData = employees.map(emp => ({
        ...emp,
        weeklyHours: getEmployeeWeeklyHours(emp.id),
        workingDaysCount: new Set(getEmployeeShiftsForWeek(emp.id).map(s => s.day)).size
    }));

    if (sortOrder === 'hours') {
        employeeData.sort((a, b) => b.weeklyHours - a.weeklyHours);
    } else if (sortOrder === 'days') {
        employeeData.sort((a, b) => b.workingDaysCount - a.workingDaysCount);
    } else { // alpha
        employeeData.sort((a, b) => a.name.localeCompare(b.name));
    }
    employees = employeeData;

    const middleIndex = Math.ceil(employees.length / 2);
    const leftColumnEmployees = employees.slice(0, middleIndex);
    const rightColumnEmployees = employees.slice(middleIndex);

    const generateTableFor = (employeeList) => {
      let tableHTML = `
        <table class="emp-table-new">
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Horas Semanales</th>
              <th>Días de Trabajo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
      `;
      const dayShortNames = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
      employeeList.forEach(emp => {
        const weeklyHours = emp.weeklyHours;
        const shifts = getEmployeeShiftsForWeek(emp.id);
        const workingDays = new Set(shifts.map(s => s.day));
        const workingDaysStr = dayShortNames.filter((day, i) => workingDays.has(i)).join(', ');
        const hoursClass = weeklyHours < 12 ? 'danger' : '';
        tableHTML += `
          <tr class="employee-summary-row">
            <td>${escapeHtml(emp.name)}</td>
            <td class="${hoursClass}">${String(weeklyHours).replace('.', ',')}hs</td>
            <td>${workingDaysStr || 'Sin turnos'}</td>
            <td><button class="btn secondary btn-details" data-employee-id="${emp.id}">Detalles</button></td>
          </tr>
          <tr class="details-row" id="details-row-${emp.id}" style="display: none;">
            <td colspan="4" class="details-content"></td>
          </tr>
        `;
      });
      tableHTML += `</tbody></table>`;
      return tableHTML;
    }

    weeklySummaryContent.innerHTML = `
      <div class="summary-grid">
        <div>${generateTableFor(leftColumnEmployees)}</div>
        <div>${generateTableFor(rightColumnEmployees)}</div>
      </div>
    `;
  }

  if (btnWeeklySummary) {
    btnWeeklySummary.addEventListener("click", () => {
      renderWeeklySummary();
      weeklySummaryModal.style.display = "flex";
    });
  }

  if (weeklySummaryModalClose) {
    weeklySummaryModalClose.addEventListener("click", () => {
      weeklySummaryModal.style.display = "none";
    });
  }

  if (weeklySummaryModal) {
    weeklySummaryModal.addEventListener("click", (e) => {
      if (e.target === weeklySummaryModal) {
        weeklySummaryModal.style.display = "none";
      }
    });
  }

  const weeklySummarySort = el("#weekly-summary-sort");
  if (weeklySummarySort) {
      weeklySummarySort.addEventListener("change", () => {
          state.weeklySummarySort = weeklySummarySort.value;
          renderWeeklySummary();
      });
  }

  weeklySummaryContent.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-go-to-shift')) {
      const btn = e.target;
      const shiftId = btn.dataset.shiftId;
      const dayIndex = parseInt(btn.dataset.dayIndex, 10);

      state.activeDay = dayIndex;
      weeklySummaryModal.style.display = 'none'; // Close the modal
      showView('schedule');

      // Use a short timeout to ensure the view has rendered before scrolling
      setTimeout(() => {
        const shiftRow = document.querySelector(`[data-shift-id="${shiftId}"]`);
        if (shiftRow) {
          shiftRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
          shiftRow.classList.add('highlight-shift');
          setTimeout(() => {
            shiftRow.classList.remove('highlight-shift');
          }, 2000); // Highlight for 2 seconds
        }
      }, 100);

      return;
    }

    if (!e.target.classList.contains('btn-details')) {
      return;
    }

    const btn = e.target;
    const empId = btn.dataset.employeeId;
    if (!empId) return;

    const detailsRow = el(`#details-row-${empId}`);
    if (!detailsRow) return;

    const isVisible = detailsRow.style.display !== 'none';

    if (isVisible) {
      detailsRow.style.display = 'none';
      btn.textContent = 'Detalles';
    } else {
      const shifts = getEmployeeShiftsForWeek(empId);
      if (shifts.length === 0) {
        detailsRow.querySelector('.details-content').innerHTML = '<span>No hay turnos asignados en la semana.</span>';
      } else {
        const dayShortNames = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
        const detailsHtml = shifts.map(s => {
          const dayName = dayShortNames[s.day];
          const startTime = SLOTS[s.startSlot].label;
          const endTime = SLOTS[s.endSlot + 1] ? SLOTS[s.endSlot + 1].label : '??';
          return `
            <div class="shift-detail-item">
              <span><strong>${dayName}:</strong> ${escapeHtml(s.role)} (${startTime}-${endTime})</span>
              <button class="btn secondary btn-go-to-shift" data-shift-id="${s.id}" data-day-index="${s.day}" style="padding: 1px 6px; font-size: 11px; margin-left: 8px;">Ir</button>
            </div>
          `;
        }).join('');
        detailsRow.querySelector('.details-content').innerHTML = `<div class="shift-detail-container">${detailsHtml}</div>`;
      }

      detailsRow.style.display = 'table-row';
      btn.textContent = 'Ocultar';
    }
  });

  /* ====== Week Selector & Calendar Modal ====== */
  const weekDisplay = el("#week-display");
  const btnPrevWeek = el("#btn-prev-week");
  const btnNextWeek = el("#btn-next-week");
  const calendarModal = el("#calendar-modal");
  const calendarGrid = el("#calendar-grid");
  const calendarMonthYear = el("#calendar-month-year");
  const btnCalendarPrevMonth = el("#calendar-prev-month");
  const btnCalendarNextMonth = el("#calendar-next-month");
  let calendarDate = new Date();

  function updateWeekDisplay() {
    const monday = new Date(state.activeWeek + "T12:00:00Z");
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const format = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    weekDisplay.textContent = `${format(monday)} - ${format(sunday)}`;
  }

  function changeWeek(days) {
    const currentMonday = new Date(state.activeWeek + "T12:00:00Z");
    currentMonday.setDate(currentMonday.getDate() + days);
    state.activeWeek = toISODateString(getMonday(currentMonday));
    if (!state.schedules[state.activeWeek]) {
        state.schedules[state.activeWeek] = {};
    }
    save();
    renderAll();
  }

  btnPrevWeek.addEventListener("click", () => changeWeek(-7));
  btnNextWeek.addEventListener("click", () => changeWeek(7));

  function toggleWeekLock() {
    const schedule = getActiveSchedule();
    schedule.isLocked = !schedule.isLocked;
    save();
    renderAll();
  }

  el("#btn-lock-week").addEventListener("click", toggleWeekLock);

  weekDisplay.addEventListener("click", () => {
    calendarDate = new Date(state.activeWeek + "T12:00:00Z");
    renderCalendar();
    calendarModal.style.display = "flex";
  });

  function renderCalendar() {
    calendarGrid.innerHTML = '';
    const month = calendarDate.getMonth();
    const year = calendarDate.getFullYear();
    calendarMonthYear.textContent = `${new Date(year, month).toLocaleString('es-ES', { month: 'long' })} ${year}`;

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const firstDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // 0=Monday
    const totalDays = lastDayOfMonth.getDate();

    ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].forEach(day => {
        const dayNameEl = document.createElement('div');
        dayNameEl.className = 'day-name';
        dayNameEl.textContent = day;
        calendarGrid.appendChild(dayNameEl);
    });

    for (let i = 0; i < firstDayOfWeek; i++) {
        const emptyEl = document.createElement('div');
        calendarGrid.appendChild(emptyEl);
    }

    for (let day = 1; day <= totalDays; day++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'day';
        dayEl.textContent = day;
        const currentDate = new Date(year, month, day);
        if (currentDate.getDay() === 1) { // It's a Monday
            dayEl.classList.add('monday');
            if (toISODateString(currentDate) === state.activeWeek) {
                dayEl.classList.add('selected');
            }
            dayEl.addEventListener('click', () => {
                state.activeWeek = toISODateString(currentDate);
                if (!state.schedules[state.activeWeek]) {
                    state.schedules[state.activeWeek] = {};
                }
                save();
                renderAll();
                calendarModal.style.display = 'none';
            });
        }
        calendarGrid.appendChild(dayEl);
    }
  }

  btnCalendarPrevMonth.addEventListener("click", () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();
  });
  btnCalendarNextMonth.addEventListener("click", () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendar();
  });
  calendarModal.addEventListener("click", (e) => {
    if (e.target === calendarModal) {
      calendarModal.style.display = "none";
    }
  });


  function renderPlanillaTurno(isEditing = false) {
    const rappiCodeInput = el("#rappi-code-input");
    rappiCodeInput.value = state.rappiCode || '';
    el("#rappi-code-print").textContent = `Cód. Rappi: ${state.rappiCode || '____'}`;

    const datePicker = el("#planilla-date-picker");
    if (!datePicker.value) {
        datePicker.value = toISODateString(new Date());
    }
    const selectedDate = new Date(datePicker.value + "T12:00:00Z");

    const dayName = DAYS[selectedDate.getUTCDay() === 0 ? 6 : selectedDate.getUTCDay() - 1];
    const formattedDate = `${dayName}, ${selectedDate.getUTCDate()} de ${selectedDate.toLocaleString('es-ES', { month: 'long' })} de ${selectedDate.getUTCFullYear()}`;
    el("#planilla-title").textContent = formattedDate;

    const shifts = (state.tempPlanillaState ? state.tempPlanillaState.shifts : getScheduleForDate(selectedDate))
        .filter(s => s.employeeId);
    shifts.sort((a, b) => a.startSlot - b.startSlot);

    const mananaTbody = el("#tabla-manana tbody");
    const tardeTbody = el("#tabla-tarde tbody");
    mananaTbody.innerHTML = "";
    tardeTbody.innerHTML = "";

    const slot1600 = 20; // 16:00 is the 21st slot, index 20
    let totalSlotsManana = 0;
    let totalSlotsTarde = 0;

    shifts.forEach(shift => {
        const emp = getEmployeeById(shift.employeeId);
        if (!emp) return;

        // Hour calculations remain the same for the totals
        if (shift.startSlot < slot1600) {
            const endSlotForCalc = Math.min(shift.endSlot, slot1600 - 1);
            totalSlotsManana += (endSlotForCalc - shift.startSlot + 1);
        }
        if (shift.endSlot >= slot1600) {
            const startSlotForCalc = Math.max(shift.startSlot, slot1600);
            totalSlotsTarde += (shift.endSlot - startSlotForCalc + 1);
        }

        const tr = document.createElement("tr");
        tr.dataset.shiftId = shift.id;
        const shiftHours = (shift.endSlot - shift.startSlot + 1) * 0.5;

        if (isEditing) {
            const startOptions = SLOTS.map(s => `<option value="${s.index}" ${s.index === shift.startSlot ? 'selected' : ''}>${s.label}</option>`).join('');
            const endOptions = SLOTS.map(s => `<option value="${s.index}" ${s.index === (shift.endSlot + 1) ? 'selected' : ''}>${s.label}</option>`).join('');
            const roleOptions = ROLES.map(r => `<option value="${r.key}" ${r.key === shift.role ? 'selected' : ''}>${escapeHtml(r.key)}</option>`).join('');
            const employeeOptions = state.employees
                .slice()
                .sort((a,b) => a.name.localeCompare(b.name))
                .map(e => `<option value="${e.id}" ${e.id === emp.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`)
                .join('');

            tr.innerHTML = `
                <td><select class="select planilla-edit-employee">${employeeOptions}</select></td>
                <td>
                    <select class="select planilla-edit-start">${startOptions}</select> a
                    <select class="select planilla-edit-end">${endOptions}</select>
                </td>
                <td class="hs-cell">${String(shiftHours).replace('.', ',')}</td>
                <td><select class="select planilla-edit-role">${roleOptions}</select></td>
                <td></td>
            `;

            const updateHours = () => {
                const start = parseInt(tr.querySelector(".planilla-edit-start").value, 10);
                const end = parseInt(tr.querySelector(".planilla-edit-end").value, 10);
                if (end > start) {
                    const duration = (end - start) * 0.5;
                    tr.querySelector('.hs-cell').textContent = String(duration).replace('.', ',');
                } else {
                    tr.querySelector('.hs-cell').textContent = 'Error';
                }
            };
            tr.querySelector(".planilla-edit-start").addEventListener('change', updateHours);
            tr.querySelector(".planilla-edit-end").addEventListener('change', updateHours);

        } else {
            let displayName = emp.displayName || emp.name.split(' ')[0];
            if (shift.replacement && shift.replacement.originalEmployeeId) {
                const originalEmp = getEmployeeById(shift.replacement.originalEmployeeId);
                if (originalEmp) {
                    const originalDisplayName = originalEmp.displayName || originalEmp.name.split(' ')[0];
                    displayName = `${displayName} (cubre a ${originalDisplayName})`;
                }
            }

            const startTime = SLOTS[shift.startSlot].label;
            const endTime = SLOTS[shift.endSlot + 1] ? SLOTS[shift.endSlot + 1].label : "02:00";
            let bksCellContent = '';

            // A shift is in conflict if the assigned employee has a sanction AND it hasn't been replaced yet.
            if (isDateInSanctionPeriod(selectedDate, emp.sanctions) && !shift.replacement) {
                tr.style.backgroundColor = 'var(--c-danger-bg)';
                tr.style.color = 'var(--c-danger-text)';
                tr.title = 'Este turno está en conflicto con una sanción o licencia.';
                const weekId = toISODateString(getMonday(selectedDate));
                const dayIndex = selectedDate.getUTCDay() === 0 ? 6 : selectedDate.getUTCDay() - 1;
                bksCellContent = `<button class="btn secondary btn-replace" data-shift-id="${shift.id}" data-week-id="${weekId}" data-day-index="${dayIndex}">Reemplazar</button>`;
            }

            tr.innerHTML = `
                <td>${escapeHtml(displayName)}</td>
                <td>${startTime} a ${endTime}</td>
                <td>${String(shiftHours).replace('.', ',')}</td>
                <td>${escapeHtml(shift.role)}</td>
                <td>${bksCellContent}</td>
            `;

            if (bksCellContent) {
                const btn = tr.querySelector('.btn-replace');
                btn.style.padding = '1px 5px';
                btn.style.fontSize = '10px';
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const { shiftId, weekId, dayIndex } = e.currentTarget.dataset;
                    openReplaceEmployeeModal(shiftId, weekId, dayIndex);
                };
            }
        }

        if (shift.startSlot < slot1600) {
            mananaTbody.appendChild(tr);
        } else {
            tardeTbody.appendChild(tr);
        }
    });

    const addEmptyRows = (tbody, numRows) => {
        const existingRows = tbody.children.length;
        const rowsToAdd = Math.max(0, numRows - existingRows);
        for (let i = 0; i < rowsToAdd; i++) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
            `;
            tbody.appendChild(tr);
        }
    };

    const totalRowsInTable = 15; // A reasonable number to fill the page
    addEmptyRows(mananaTbody, totalRowsInTable);
    addEmptyRows(tardeTbody, totalRowsInTable);


    el("#total-hs-manana").textContent = String(totalSlotsManana * 0.5).replace('.', ',');
    el("#total-hs-tarde").textContent = String(totalSlotsTarde * 0.5).replace('.', ',');
    renderBreaksSection(); // Assumes this is not editable at the same time
  }

  function renderBreaksSection(isEditing = false) {
      const breaksTable = el("#breaks-table");
      breaksTable.innerHTML = "";
      const breaks9250 = state.breaks["9250"] || [];
      const breaks1245 = state.breaks["1245"] || [];
      const maxRows = Math.max(breaks9250.length, breaks1245.length);

      let headerHtml = `
        <thead>
            <tr>
                <th colspan="2">Cod. Rappi: 9250</th>
                <th colspan="2">1245</th>
            </tr>
        </thead>
      `;
      let bodyHtml = '<tbody>';

      for (let i = 0; i < maxRows; i++) {
          const item9250 = breaks9250[i] || { id: '', text: '' };
          const item1245 = breaks1245[i] || { id: '', text: '' };
          if (isEditing) {
              bodyHtml += `
                  <tr>
                      <td><input type="text" class="input break-input" data-code="9250" data-index="${i}" data-field="id" value="${item9250.id}"></td>
                      <td><input type="text" class="input break-input" data-code="9250" data-index="${i}" data-field="text" value="${item9250.text}"></td>
                      <td><input type="text" class="input break-input" data-code="1245" data-index="${i}" data-field="id" value="${item1245.id}"></td>
                      <td><input type="text" class="input break-input" data-code="1245" data-index="${i}" data-field="text" value="${item1245.text}"></td>
                  </tr>`;
          } else {
              bodyHtml += `
                  <tr>
                      <td>${item9250.id}</td>
                      <td>${item9250.text}</td>
                      <td>${item1245.id}</td>
                      <td>${item1245.text}</td>
                  </tr>`;
          }
      }
       if (isEditing) {
        // Add a row for a new break
        bodyHtml += `
            <tr>
                <td><input type="text" class="input break-input" data-code="9250" data-index="${breaks9250.length}" data-field="id" placeholder="ID"></td>
                <td><input type="text" class="input break-input" data-code="9250" data-index="${breaks9250.length}" data-field="text" placeholder="Texto"></td>
                <td><input type="text" class="input break-input" data-code="1245" data-index="${breaks1245.length}" data-field="id" placeholder="ID"></td>
                <td><input type="text" class="input break-input" data-code="1245" data-index="${breaks1245.length}" data-field="text" placeholder="Texto"></td>
            </tr>`;
    }

      bodyHtml += '</tbody>';
      breaksTable.innerHTML = headerHtml + bodyHtml;
  }

  function toggleBreaksEdit() {
      const btn = el("#btn-edit-breaks");
      const isEditing = btn.textContent === "Guardar Breaks";

      if (isEditing) {
          // Save logic
          const newBreaks = { "9250": [], "1245": [] };
          const inputs = document.querySelectorAll(".break-input");
          const items = {};

          inputs.forEach(input => {
              const { code, index, field, value } = input.dataset;
              const key = `${code}-${index}`;
              if (!items[key]) items[key] = {};
              items[key][field] = value;
          });

          for (const key in items) {
              const [code, index] = key.split('-');
              const item = items[key];
              if (item.id || item.text) {
                  newBreaks[code].push({ id: item.id || '', text: item.text || '' });
              }
          }

          state.breaks = newBreaks;
          save();
          renderBreaksSection(false);
          btn.textContent = "Editar Breaks";
          btn.classList.remove("btn-primary");
          btn.classList.add("btn-secondary");

      } else {
          // Enter edit mode
          renderBreaksSection(true);
          btn.textContent = "Guardar Breaks";
          btn.classList.remove("btn-secondary");
          btn.classList.add("btn-primary");
      }
  }

  el("#btn-edit-breaks").addEventListener("click", toggleBreaksEdit);
  el("#planilla-date-picker").addEventListener("change", () => {
      // Clear temporary state when date changes
      state.tempPlanillaState = null;
      const btn = el("#btn-edit-planilla");
      if (btn) {
          btn.textContent = "Editar Planilla";
          btn.classList.remove("btn-primary");
          btn.classList.add("btn-secondary");
      }
      renderPlanillaTurno(false);
  });


  function togglePlanillaEdit() {
      const btn = el("#btn-edit-planilla");
      const isCurrentlyEditing = btn.textContent === "Aplicar Cambios";

      if (isCurrentlyEditing) {
          // --- APPLY TEMPORARY CHANGES (from Edit to View mode) ---
          const editedRows = document.querySelectorAll("#view-planilla-turno tbody tr[data-shift-id]");
          let allValid = true;
          const errors = [];
          const updatedShifts = JSON.parse(JSON.stringify(state.tempPlanillaState.shifts));

          editedRows.forEach(row => {
              const shiftId = row.dataset.shiftId;
              const shift = updatedShifts.find(s => s.id === shiftId);
              if (!shift) return;

              const newEmployeeId = row.querySelector(".planilla-edit-employee").value;
              const newStart = parseInt(row.querySelector(".planilla-edit-start").value, 10);
              const newEndIndex = parseInt(row.querySelector(".planilla-edit-end").value, 10);
              const newRole = row.querySelector(".planilla-edit-role").value;

              if (newEndIndex <= newStart) {
                  allValid = false;
                  const emp = getEmployeeById(newEmployeeId);
                  errors.push(`Error en el turno de ${emp.displayName}: La hora de fin debe ser mayor que la de inicio.`);
                  return;
              }

              shift.employeeId = newEmployeeId;
              shift.startSlot = newStart;
              shift.endSlot = newEndIndex - 1;
              shift.role = newRole;
          });

          if (!allValid) {
              alert("No se pudieron aplicar los cambios. Se encontraron los siguientes errores:\n\n" + errors.join("\n"));
              return;
          }

          state.tempPlanillaState.shifts = updatedShifts;

          renderPlanillaTurno(false);
          btn.textContent = "Editar Planilla";
          btn.classList.remove("btn-primary");
          btn.classList.add("btn-secondary");

      } else {
          // --- ENTER EDIT MODE (from View to Edit mode) ---
          if (!state.tempPlanillaState) {
              const datePicker = el("#planilla-date-picker");
              const selectedDate = new Date(datePicker.value + "T12:00:00Z");
              const originalShifts = getScheduleForDate(selectedDate);
              state.tempPlanillaState = {
                  shifts: JSON.parse(JSON.stringify(originalShifts)),
              };
          }

          renderPlanillaTurno(true);
          btn.textContent = "Aplicar Cambios";
          btn.classList.remove("btn-secondary");
          btn.classList.add("btn-primary");
      }
  }

  el("#btn-edit-planilla").addEventListener("click", togglePlanillaEdit);

  function printPlanillaTurno() {
    window.print();
  }

  el("#btn-print-planilla").addEventListener("click", printPlanillaTurno);

  el("#rappi-code-input").addEventListener('input', () => {
      state.rappiCode = el("#rappi-code-input").value;
      el("#rappi-code-print").textContent = `Cód. Rappi: ${state.rappiCode || '____'}`;
      save();
  });

  /* ====== Inicialización ====== */
  await loadState();
  renderAll();

  el("#clockInSearch").addEventListener('input', (e) => {
    state.clockInSearchTerm = e.target.value;
    renderClockInReport();
  });

  el("#clockInSort").addEventListener('change', (e) => {
    state.clockInSortOrder = e.target.value;
    renderClockInReport();
  });

  el("#clockInDateFilter").addEventListener('change', (e) => {
    state.clockInDateFilter = e.target.value || null; // Store as YYYY-MM-DD or null if empty
    renderClockInReport();
  });

  el("#fileImportClockIns").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            processAndCompareClockIns(json);

        } catch (err) {
            console.error("Error processing clock-in file:", err);
            alert("Error al procesar el archivo Excel. Asegúrese de que el formato es correcto.");
        }
    };
    reader.readAsArrayBuffer(file);
  });


  /* ====== Schedule Filters ====== */


  el("#schedule-list-search").addEventListener("input", renderScheduleList);

  function undoLastAction() {
    if (historyManager.canUndo()) {
        const lastState = historyManager.pop();
        state.schedules[state.activeWeek] = lastState;
        save();
        renderAll();
    }
    el("#btnUndo").disabled = !historyManager.canUndo();
  }

  el("#btnUndo").addEventListener("click", undoLastAction);

  // Close dropdowns when clicking elsewhere
  window.addEventListener("click", (e) => {
    // If the click is outside ANY dropdown component, close them all.
    if (!e.target.closest('.dropdown')) {
      actionsDropdown.classList.remove('show');
    }
  });

  function renderFrancos() {
    const content = el("#francos-content");
    content.innerHTML = "";

    const schedule = getActiveSchedule();
    const employees = state.employees.slice().sort((a, b) => a.name.localeCompare(b.name));

    if (employees.length === 0) {
        content.innerHTML = `<p class="muted">No hay empleados para mostrar.</p>`;
        return;
    }

    const table = document.createElement("table");
    table.className = "schedule-list-table"; // Re-use existing styles

    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    const weekMonday = new Date(state.activeWeek + "T12:00:00Z");

    headerRow.innerHTML = DAYS.map((dayName, dayIndex) => {
        const dayDate = new Date(weekMonday);
        dayDate.setDate(weekMonday.getDate() + dayIndex);
        return `<th>${dayName}<br><span class="muted" style="font-size:11px;">${dayDate.getDate()}/${dayDate.getMonth() + 1}</span></th>`;
    }).join('');

    const tbody = table.createTBody();
    const maxRowsPerDay = [0, 0, 0, 0, 0, 0, 0];
    const employeesByDay = [[], [], [], [], [], [], []];

    // First, find which employees have a day off on which day
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayShifts = schedule[dayIndex] || [];
        const assignedEmployeeIds = new Set(dayShifts.map(s => s.employeeId));

        employees.forEach(emp => {
            if (!assignedEmployeeIds.has(emp.id)) {
                employeesByDay[dayIndex].push(emp.name);
            }
        });
        maxRowsPerDay[dayIndex] = employeesByDay[dayIndex].length;
    }

    const maxRows = Math.max(...maxRowsPerDay);

    for (let i = 0; i < maxRows; i++) {
        const row = tbody.insertRow();
        for (let j = 0; j < 7; j++) {
            const cell = row.insertCell();
            cell.textContent = employeesByDay[j][i] || '';
        }
    }

    content.appendChild(table);
  }
})();
