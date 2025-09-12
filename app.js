const firebaseConfig = {
  apiKey: "AIzaSyBbMWJbE6VWqPg4LeKBO7WUz3H6e8GcPQw",
  authDomain: "horarios-data.firebaseapp.com",
  projectId: "horarios-data",
  storageBucket: "horarios-data.appspot.com",
  messagingSenderId: "246551180733",
  appId: "1:246551180733:web:98d9f2187f245f37f20ed4"
};

const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

(async function(){
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

  function generateTimeSlots(){
    const out = [];
    let h=6, m=0;                 // 06:00
    for(let i=0;i<40;i++){        // hasta 02:00 del siguiente (20 horas = 40 medias horas)
      out.push({index:i,label:two(h)+":"+two(m),h,m});
      m+=30; if(m>=60){m=0; h++; if(h===24) h=0;}
    }
    return out;
  }
  const SLOTS = generateTimeSlots();

  /* ====== Estado (Firestore) ====== */
  const state = {
    employees: [],
    schedules: {},
    templates: {},
    activeWeek: toISODateString(getMonday(new Date())),
    activeDay:0
  };

  async function loadState() {
    const docRef = db.collection("schedules").doc("main");
    try {
      const doc = await docRef.get();
      if (doc.exists) {
          const data = doc.data();
          state.employees = data.employees || [];
          state.templates = data.templates || {};
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
        state.schedules[state.activeWeek] = {};
    }
    return state.schedules[state.activeWeek];
  }

  /* ====== Helpers UI ====== */
  const el = (sel)=>document.querySelector(sel);
  const empList = el("#empList");
  const empFilter = el("#empFilter");
  const roleFilter = el("#roleFilter");
  const weekSelector = el("#weekSelector");
  const activeRole = el("#activeRole");
  const dayTabs = el("#dayTabs");
  const thead = el("#thead");
  const tbody = el("#tbody");
  const formStart = el("#formStart");
  const formEnd = el("#formEnd");
  const shiftDuration = el("#shiftDuration");

  const viewScheduleEl = el('#view-schedule');
  const viewEmployeesEl = el('#view-employees');
  const viewTemplatesEl = el('#view-templates');
  const btnViewSchedule = el('#btn-view-schedule');
  const btnViewEmployees = el('#btn-view-employees');
  const btnViewTemplates = el('#btn-view-templates');
  const inpTemplateName = el('#inpTemplateName');
  const btnSaveTemplate = el('#btnSaveTemplate');
  const templateList = el('#templateList');

  function showView(viewName) {
    viewScheduleEl.style.display = 'none';
    viewEmployeesEl.style.display = 'none';
    viewTemplatesEl.style.display = 'none';
    btnViewSchedule.className = 'btn secondary';
    btnViewEmployees.className = 'btn secondary';
    btnViewTemplates.className = 'btn secondary';

    if (viewName === 'schedule') {
        viewScheduleEl.style.display = 'block';
        btnViewSchedule.className = 'btn';
    } else if (viewName === 'employees') {
        viewEmployeesEl.style.display = 'block';
        btnViewEmployees.className = 'btn';
    } else if (viewName === 'templates') {
        viewTemplatesEl.style.display = 'block';
        btnViewTemplates.className = 'btn';
    }
    renderAll();
  }
  btnViewSchedule.addEventListener('click', () => showView('schedule'));
  btnViewEmployees.addEventListener('click', () => showView('employees'));
  btnViewTemplates.addEventListener('click', () => showView('templates'));

  function two(n){ return String(n).padStart(2,"0"); }

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
  function getMondaysOfYear(year) {
      const mondays = [];
      let date = new Date(year, 0, 1);
      while (date.getDay() !== 1) {
          date.setDate(date.getDate() + 1);
      }
      while (date.getFullYear() === year) {
          mondays.push(new Date(date.getTime()));
          date.setDate(date.getDate() + 7);
      }
      return mondays;
  }

  function populateWeekSelector() {
      const year = new Date().getFullYear();
      const mondays = getMondaysOfYear(year);
      const options = mondays.map(m => {
          const weekKey = toISODateString(m);
          const label = `Sem. ${String(m.getDate()).padStart(2,'0')}/${String(m.getMonth()+1).padStart(2,'0')}`;
          return { value: weekKey, label: label };
      });
      optionize(weekSelector, options, o => o);
      weekSelector.value = state.activeWeek;
  }

  weekSelector.addEventListener("change", () => {
      state.activeWeek = weekSelector.value;
      if (!state.schedules[state.activeWeek]) {
          state.schedules[state.activeWeek] = {};
      }
      save();
      renderAll();
  });

  optionize(roleFilter, [{key:"",name:"Todos"},...ROLES.map(r=>({key:r.key,name:r.key}))], (x)=>({value:x.key,label:x.name}));
  optionize(empFilter, [{key:"",name:"Todos"},...ROLES.map(r=>({key:r.key,name:r.key}))], (x)=>({value:x.key,label:x.name}));
  optionize(activeRole, ROLES, (r)=>({value:r.key,label:r.key}));
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

  el("#btnExport").addEventListener("click", ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `planilla-horarios-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
  el("#fileImport").addEventListener("change", (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const r = new FileReader();
    r.onload = ()=>{
      try{
        const data = JSON.parse(r.result);
        if(Array.isArray(data.employees) && typeof data.schedule === "object"){
          state.employees = data.employees;
          state.schedule = data.schedule || {};
          state.activeDay = data.activeDay ?? 0;
          save(); renderAll();
        } else alert("Archivo inválido.");
      }catch{ alert("Archivo inválido."); }
    };
    r.readAsText(f);
  });

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
    if(!name) return;
    const id = crypto.randomUUID();
    state.employees.push({id, name, stars: [], isMinor: false});
    el("#inpName").value = "";
    save();
    renderEmpList();
  }

  function toggleStar(empId, roleKey){
    const emp = state.employees.find(e=>e.id===empId);
    if(!emp) return;
    emp.stars = emp.stars || [];
    const i = emp.stars.indexOf(roleKey);
    if(i>=0) emp.stars.splice(i,1); else emp.stars.push(roleKey);
    save();
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
        for(const day in schedule){
            schedule[day].forEach(shift => {
                if(shift.employeeId === empId){
                    shift.employeeId = null;
                }
            });
        }
    }
    save(); renderAll();
  }

  function deleteShift(shiftId) {
    const day = state.activeDay;
    const schedule = getActiveSchedule();
    ensureDay(day);
    const index = schedule[day].findIndex(s => s.id === shiftId);
    if (index > -1) {
        schedule[day].splice(index, 1);
        save();
        renderTable();
    }
  }

  function getEmployeeWeeklyHours(employeeId) {
      let totalSlots = 0;
      const schedule = getActiveSchedule();
      for (const day in schedule) {
          const dayShifts = schedule[day] || [];
          for (const shift of dayShifts) {
              if (shift.employeeId === employeeId) {
                  totalSlots += (shift.endSlot - shift.startSlot + 1);
              }
          }
      }
      return totalSlots * 0.5;
  }

  function isEmployeeAssignedOnDay(employeeId, day) {
      const schedule = getActiveSchedule();
      const dayShifts = schedule[day] || [];
      return dayShifts.some(s => s.employeeId === employeeId);
  }

  function calculateHeadcountPerSlot(day) {
      const headcount = new Array(SLOTS.length).fill(0);
      const schedule = getActiveSchedule();
      const dayShifts = schedule[day] || [];

      for (const shift of dayShifts) {
          for (let i = shift.startSlot; i <= shift.endSlot; i++) {
              headcount[i]++;
          }
      }
      return headcount;
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

  function countConsecutiveWorkDaysEndingBefore(employeeId, weekId, dayIndex) {
      let consecutiveDays = 0;
      // Use midday UTC to avoid timezone crossover issues
      let checkDate = new Date(`${weekId}T12:00:00.000Z`);
      checkDate.setUTCDate(checkDate.getUTCDate() + dayIndex - 1); // Start from the day before the target day

      for (let i = 0; i < 7; i++) { // Check up to 7 previous days is enough for a 5-day rule
          const dayToCheck = new Date(checkDate);

          const mondayOfWeek = getMonday(dayToCheck);
          const weekKey = toISODateString(mondayOfWeek);

          // dayjs: 0=Sun, 1=Mon... In our app: 0=Mon... 6=Sun
          const dayOfWeek = dayToCheck.getUTCDay() === 0 ? 6 : dayToCheck.getUTCDay() - 1;

          const schedule = state.schedules[weekKey] || {};
          const dayShifts = schedule[dayOfWeek] || [];
          const isWorking = dayShifts.some(s => s.employeeId === employeeId);

          if (isWorking) {
              consecutiveDays++;
          } else {
              break; // Streak broken
          }

          checkDate.setUTCDate(checkDate.getUTCDate() - 1);
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
    getActiveSchedule()[day].push(newShift);
    save();
    renderTable();
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
      getActiveSchedule()[day].push(newShift);
      save();
      renderTable();
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

    // If it's a simple click (mousedown and mouseup on the same slot), do nothing here.
    if (unpaintStartSlot === endSlotIndex) {
        isUnpainting = false;
        return;
    }

    const day = state.activeDay;
    const schedule = getActiveSchedule();
    const shift = schedule[day].find(s => s.id === unpaintShiftId);

    if (shift) {
        if (unpaintStartSlot === shift.startSlot && endSlotIndex > shift.startSlot) {
            shift.startSlot = endSlotIndex;
        } else if (unpaintStartSlot === shift.endSlot && endSlotIndex < shift.endSlot) {
            shift.endSlot = endSlotIndex;
        }

        if (shift.startSlot >= shift.endSlot) {
            const index = schedule[day].findIndex(s => s.id === unpaintShiftId);
            if (index > -1) schedule[day].splice(index, 1);
        }

        save();
        renderTable();
    }

    isUnpainting = false;
    unpaintShiftId = null;
    unpaintStartSlot = -1;
  }

  function handleSlotClick(shift, slotIndex) {
    const { startSlot, endSlot } = shift;

    // Case 1: Click is on the start slot -> shorten from the start
    if (slotIndex === startSlot && startSlot < endSlot) {
        shift.startSlot++;
    }
    // Case 2: Click is on the end slot -> shorten from the end
    else if (slotIndex === endSlot && endSlot > startSlot) {
        shift.endSlot--;
    }
    // Case 3: Click is just before the start slot -> extend to the left
    else if (slotIndex === startSlot - 1) {
        shift.startSlot--;
    }
    // Case 4: Click is just after the end slot -> extend to the right
    else if (slotIndex === endSlot + 1) {
        shift.endSlot++;
    } else {
        return; // Do nothing for other clicks
    }

    save();
    renderTable();
  }

  /* ====== Render ====== */
  function renderDayTabs(){
    dayTabs.innerHTML = "";
    DAYS.forEach((d,idx)=>{
      const b = document.createElement("button");
      b.className = "pilltab"+(idx===state.activeDay?" active":"");
      b.textContent = d;
      b.addEventListener("click", ()=>{ state.activeDay=idx; save(); renderAll(); });
      dayTabs.appendChild(b);
    });
  }

  function renderLegend(){
    const cont = document.getElementById("legend"); cont.innerHTML="";
    ROLES.forEach(r=>{
      const row = document.createElement("div");
      const dot = document.createElement("span");
      dot.style.width="14px"; dot.style.height="14px"; dot.style.borderRadius="3px";
      dot.style.background = r.color;
      const label = document.createElement("span"); label.textContent = r.key; label.style.fontSize="13px";
      row.appendChild(dot); row.appendChild(label);
      cont.appendChild(row);
    });
  }

  function renderHead(){
    const headcount = calculateHeadcountPerSlot(state.activeDay);
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
        const count = headcount[idx];
        headcountSpan.textContent = count > 0 ? count : "";

        const timeLabelSpan = document.createElement("span");
        timeLabelSpan.textContent = s.label;

        c.appendChild(headcountSpan);
        c.appendChild(timeLabelSpan);
        g.appendChild(c);
    });

    thead.innerHTML="";
    thead.appendChild(g);
  }

  function renderEmpList(){
    const filter = empFilter.value;
    const filtered = state.employees
      .slice()
      .sort((a,b)=>a.name.localeCompare(b.name))
      .filter(e=> !filter || (e.stars||[]).includes(filter));

    empList.innerHTML = "";
    if(filtered.length===0){
      const p = document.createElement("div");
      p.className="muted"; p.textContent="Agregá tu primer empleado 👇";
      empList.appendChild(p);
    }

    filtered.forEach(e=>{
      const card = document.createElement("div");
      card.style.border="1px solid var(--border)"; card.style.borderRadius="12px"; card.style.padding="10px";

      const top = document.createElement("div"); top.className="row"; top.style.justifyContent="space-between"; top.style.alignItems="center";

      const nameAndMinor = document.createElement("div"); nameAndMinor.className="row"; nameAndMinor.style.alignItems="center";
      const nm = document.createElement("div"); nm.className="name"; nm.textContent=e.name;
      nameAndMinor.appendChild(nm);

      if (e.isMinor) {
        const minorBadge = document.createElement("span");
        minorBadge.className = "badge b-minor";
        minorBadge.textContent = "Menor";
        minorBadge.style.marginLeft = "8px";
        nameAndMinor.appendChild(minorBadge);
      }
      top.appendChild(nameAndMinor);


      const actions = document.createElement("div"); actions.className="row";
      const bEst = document.createElement("button"); bEst.className="btn secondary"; bEst.textContent="Estrellas";
      const bDel = document.createElement("button"); bDel.className="btn secondary del"; bDel.textContent="Eliminar";

      actions.appendChild(bEst); actions.appendChild(bDel); top.appendChild(actions);

      const bottom = document.createElement("div"); bottom.className="row"; bottom.style.justifyContent="space-between"; bottom.style.marginTop="8px";

      const badges = document.createElement("div"); badges.className="chips";
      if(!e.stars || e.stars.length===0){
        const m = document.createElement("span"); m.className="muted"; m.style.fontSize="12px"; m.textContent="Sin estrellas";
        badges.appendChild(m);
      } else {
        e.stars.forEach(s=>{
          const b = document.createElement("span"); b.className="badge "+clsFor(s); b.textContent=s; badges.appendChild(b);
        });
      }
      bottom.appendChild(badges);

      const minorToggle = document.createElement("label");
      minorToggle.className = "row";
      minorToggle.style.cursor = "pointer"; minorToggle.style.alignItems = "center";
      const minorCheckbox = document.createElement("input");
      minorCheckbox.type = "checkbox";
      minorCheckbox.checked = e.isMinor;
      minorCheckbox.addEventListener("change", () => toggleIsMinor(e.id));
      const minorLabel = document.createElement("span");
      minorLabel.textContent = "Menor de edad";
      minorLabel.style.fontSize = "12px";
      minorLabel.style.marginLeft = "4px";
      minorToggle.appendChild(minorCheckbox);
      minorToggle.appendChild(minorLabel);
      bottom.appendChild(minorToggle);

      bEst.addEventListener("click", ()=> openStarsModal(e.id, e.name));
      bDel.addEventListener("click", ()=> removeEmployee(e.id));

      card.appendChild(top); card.appendChild(bottom);
      empList.appendChild(card);
    });
  }

  function renderTable(){
    renderHead();
    tbody.innerHTML = "";

    const day = state.activeDay;
    ensureDay(day);
    const schedule = getActiveSchedule();
    const shifts = schedule[day] || [];

    if (shifts.length === 0) {
        const msgRow = document.createElement("div");
        msgRow.style.padding = "20px";
        msgRow.style.textAlign = "center";
        msgRow.className = "muted";
        msgRow.textContent = "No hay turnos creados para este día. Créalos desde el formulario de arriba o pintando en la fila 'Nuevo Turno'.";
        tbody.appendChild(msgRow);
    } else {
        const shiftsByRole = shifts.reduce((acc, shift) => {
            if (!acc[shift.role]) {
                acc[shift.role] = [];
            }
            acc[shift.role].push(shift);
            return acc;
        }, {});

        const sortedRoles = Object.keys(shiftsByRole).sort();

        sortedRoles.forEach(role => {
            const roleShifts = shiftsByRole[role];
            roleShifts.sort((a, b) => a.startSlot - b.startSlot);

            roleShifts.forEach((shift, index) => {
                const cols = `240px repeat(${SLOTS.length}, 1fr)`;
                const row = document.createElement("div");
                if (index === 0) {
                    row.style.borderTop = "2px solid #d1d5db";
                }
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
                timeInfo.textContent = `${startTime} - ${endTime}`;

                const assignWrapper = document.createElement("div");
                assignWrapper.style.marginTop = "4px";
                assignWrapper.className = "row";

                if (shift.employeeId) {
                    const emp = state.employees.find(e => e.id === shift.employeeId);
                    const empName = document.createElement("span");
                    if (emp) {
                        const weeklyHours = getEmployeeWeeklyHours(emp.id);
                        const hoursText = `(${String(weeklyHours).replace('.', ',')}hs)`;
                        empName.textContent = `${emp.name} ${hoursText}`;
                    } else {
                        empName.textContent = "Empleado no encontrado";
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
                        shift.employeeId = null;
                        save();
                        renderTable();
                    });

                    assignWrapper.appendChild(empName);
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

                // Render the slots
                for (let i = 0; i < SLOTS.length; i++) {
                    const cell = document.createElement("div");
                    cell.className = "slot";

                    cell.addEventListener("click", () => handleSlotClick(shift, i));

                    if (i >= shift.startSlot && i <= shift.endSlot) {
                        const roleData = ROLES.find(r => r.key === shift.role);
                        cell.className += " assigned " + (roleData ? clsFor(roleData.key) : "");
                        if(roleData && roleData.darkText) cell.className += " sandwich";

                        cell.addEventListener("mousedown", () => handleUnpaintStart(shift.id, i));
                        cell.addEventListener("mouseenter", () => handlePaintEnter(i));
                        cell.addEventListener("mouseup", () => handleUnpaintEnd(i));
                    }
                    row.appendChild(cell);
                }

                tbody.appendChild(row);
            });
        });
    }

    // Add the new shift row for painting
    const newShiftRow = document.createElement("div");
    newShiftRow.className = "rowg new-shift-row";
    newShiftRow.style.gridTemplateColumns = `240px repeat(${SLOTS.length}, 1fr)`;
    const newShiftNamecol = document.createElement("div");
    newShiftNamecol.className = "namecol";
    newShiftNamecol.innerHTML = '<span class="muted">Nuevo Turno (pintar)...</span>';
    newShiftRow.appendChild(newShiftNamecol);

    for (let i = 0; i < SLOTS.length; i++) {
        const cell = document.createElement("div");
        cell.className = "slot ghost new-shift-slot";
        cell.dataset.slotIndex = i;
        cell.addEventListener("mousedown", () => handlePaintStart(i));
        cell.addEventListener("mouseenter", () => handlePaintEnter(i));
        newShiftRow.appendChild(cell);
    }
    tbody.appendChild(newShiftRow);
  }

  function renderAll(){
    renderDayTabs();
    renderLegend();
    renderEmpList();
    renderTable();
    renderTemplateList();
  }

  /* ====== Modal Estrellas ====== */
  function openStarsModal(empId, name){
    const wrap = document.createElement("div");
    wrap.style.position="fixed"; wrap.style.inset="0"; wrap.style.background="rgba(0,0,0,.35)";
    wrap.style.display="flex"; wrap.style.alignItems="center"; wrap.style.justifyContent="center"; wrap.style.padding="16px"; wrap.style.zIndex=1000;

    const box = document.createElement("div");
    box.className="card"; box.style.maxWidth="560px"; box.style.width="100%";

    function renderModalContent(){
      const emp = state.employees.find(e=>e.id===empId);
      const stars = emp?.stars || [];
      box.innerHTML = ""; // Limpia contenido

      const h = document.createElement("div"); h.className="card-h";
      h.innerHTML = `<strong>Estrellas de ${escapeHtml(name)}</strong>`;
      const c = document.createElement("div"); c.className="card-c";
      const grid = document.createElement("div"); grid.style.display="grid"; grid.style.gridTemplateColumns="1fr 1fr"; grid.style.gap="10px";

      ROLES.forEach(r=>{
        const btn = document.createElement("button");
        const isOn = stars.includes(r.key);
        btn.className = "btn secondary";
        btn.style.justifyContent="space-between"; btn.style.display="flex"; btn.style.width="100%";
        btn.style.borderRadius="12px"; btn.style.border = isOn ? "1px solid transparent" : "1px solid var(--border)";
        btn.style.background = isOn ? r.color : "#fff";
        btn.style.color = isOn ? (r.darkText?"#111":"#fff") : "var(--ink)";
        btn.innerHTML = `<span>${r.key}</span><span>${isOn?"★":""}</span>`;
        btn.addEventListener("click", ()=>{
          toggleStar(empId, r.key);
          renderModalContent();
        });
        grid.appendChild(btn);
      });

      const f = document.createElement("div"); f.style.textAlign="right"; f.style.marginTop="12px";
      const done = document.createElement("button"); done.className="btn"; done.textContent="Listo";
      done.addEventListener("click", ()=> {
        wrap.remove();
        renderAll();
      });
      f.appendChild(done);

      c.appendChild(grid); c.appendChild(f);
      box.appendChild(h); box.appendChild(c);
    }

    renderModalContent();
    wrap.appendChild(box);
    wrap.addEventListener("click",(e)=>{
        if(e.target===wrap) {
            wrap.remove();
            renderAll();
        }
    });
    document.body.appendChild(wrap);
  }

  function openAssignEmployeeModal(shiftId) {
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

    const qualifiedEmployees = state.employees.filter(e => {
        const hasStar = (e.stars || []).includes(shift.role);
        if (!hasStar) return false;

        if (isEmployeeAssignedOnDay(e.id, day)) return false;

        const consecutiveDays = countConsecutiveWorkDaysEndingBefore(e.id, state.activeWeek, day);
        if (consecutiveDays >= 5) return false;

        if (e.isMinor && shift.endSlot > MAX_SLOT_FOR_MINOR) {
            return false;
        }

        return true;
    });

    const h = document.createElement("div"); h.className="card-h";
    h.innerHTML = `<strong>Asignar empleado a ${shift.role}</strong>`;
    const c = document.createElement("div"); c.className="card-c stack";

    if (qualifiedEmployees.length === 0) {
        c.textContent = "No hay empleados con la estrella requerida.";
    } else {
        qualifiedEmployees.forEach(emp => {
            const btn = document.createElement("button");
            btn.className = "btn secondary";
            const weeklyHours = getEmployeeWeeklyHours(emp.id);
            const hoursText = `(${String(weeklyHours).replace('.', ',')}hs)`;
            btn.textContent = `${emp.name} ${hoursText}`;
            btn.style.width = "100%";
            btn.addEventListener("click", () => {
                const { pass, message } = checkRestTime(emp.id, shift, state.activeWeek, day);
                if (!pass) {
                    alert(message);
                    return;
                }
                shift.employeeId = emp.id;
                save();
                renderTable();
                wrap.remove();
            });
            c.appendChild(btn);
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
        }

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

        save();
        renderTable();
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
    const templateNames = Object.keys(state.templates || {}).sort();

    if (templateNames.length === 0) {
      const p = document.createElement("div");
      p.className="muted"; p.textContent="No hay plantillas guardadas.";
      templateList.appendChild(p);
      return;
    }

    templateNames.forEach(name => {
      const card = document.createElement("div");
      card.style.border="1px solid var(--border)"; card.style.borderRadius="12px"; card.style.padding="10px";
      card.className = "row";
      card.style.justifyContent = "space-between";

      const label = document.createElement("span");
      label.textContent = name;
      card.appendChild(label);

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
    if (state.templates[name]) {
      if (!confirm("Ya existe una plantilla con este nombre. ¿Deseas sobreescribirla?")) {
        return;
      }
    }

    const schedule = getActiveSchedule();
    const daySchedule = schedule[state.activeDay] || [];

    const templateShifts = JSON.parse(JSON.stringify(daySchedule));
    templateShifts.forEach(shift => {
      shift.employeeId = null;
    });

    state.templates = state.templates || {};
    state.templates[name] = templateShifts;

    save();
    renderTemplateList();
    inpTemplateName.value = "";
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

    // Deep copy and assign new IDs
    const newShifts = JSON.parse(JSON.stringify(template));
    newShifts.forEach(shift => {
      shift.id = crypto.randomUUID();
    });

    const schedule = getActiveSchedule();
    schedule[state.activeDay] = newShifts;

    save();
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

  /* ====== Inicialización ====== */
  await loadState();
  populateWeekSelector();
  renderAll();

})();
