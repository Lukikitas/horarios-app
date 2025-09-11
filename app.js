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
  const state = { employees: [], schedule: {}, activeDay:0 };

  async function loadState() {
    const docRef = db.collection("schedules").doc("main");
    try {
      const doc = await docRef.get();
      if (doc.exists) {
          const data = doc.data();
          state.employees = data.employees || [];
          state.schedule = data.schedule || {};
          state.activeDay = data.activeDay || 0;
      } else {
          console.log("No state found in Firestore. Starting with a new default state.");
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
      await db.collection("schedules").doc("main").set(stateToSave);
      console.log("State saved to Firestore.");
    } catch (error) {
      console.error("Error saving state to Firestore:", error);
      alert("Error al guardar los datos. Revisa la consola para más detalles.");
    }
  }

  /* ====== Helpers UI ====== */
  const el = (sel)=>document.querySelector(sel);
  const empList = el("#empList");
  const empFilter = el("#empFilter");
  const roleFilter = el("#roleFilter");
  const activeRole = el("#activeRole");
  const dayTabs = el("#dayTabs");
  const thead = el("#thead");
  const tbody = el("#tbody");
  const formStart = el("#formStart");
  const formEnd = el("#formEnd");

  const viewScheduleEl = el('#view-schedule');
  const viewEmployeesEl = el('#view-employees');
  const btnViewSchedule = el('#btn-view-schedule');
  const btnViewEmployees = el('#btn-view-employees');

  function showView(viewName) {
    if (viewName === 'schedule') {
        viewScheduleEl.style.display = 'block';
        viewEmployeesEl.style.display = 'none';
        btnViewSchedule.className = 'btn';
        btnViewEmployees.className = 'btn secondary';
    } else { // employees
        viewScheduleEl.style.display = 'none';
        viewEmployeesEl.style.display = 'block';
        btnViewSchedule.className = 'btn secondary';
        btnViewEmployees.className = 'btn';
    }
    renderAll();
  }
  btnViewSchedule.addEventListener('click', () => showView('schedule'));
  btnViewEmployees.addEventListener('click', () => showView('employees'));

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
  optionize(roleFilter, [{key:"",name:"Todos"},...ROLES.map(r=>({key:r.key,name:r.key}))], (x)=>({value:x.key,label:x.name}));
  optionize(empFilter, [{key:"",name:"Todos"},...ROLES.map(r=>({key:r.key,name:r.key}))], (x)=>({value:x.key,label:x.name}));
  optionize(activeRole, ROLES, (r)=>({value:r.key,label:r.key}));
  optionize(formStart, SLOTS, (s)=>({value:s.index,label:s.label}));
  optionize(formEnd,   SLOTS, (s)=>({value:s.index,label:s.label}));

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
            json.forEach(row => {
                const name = row[0];
                const starsStr = row[1] || "";
                if (name && String(name).trim()) {
                    const stars = starsStr.split(',').map(s => s.trim()).filter(Boolean);
                    const id = crypto.randomUUID();
                    state.employees.push({ id, name: String(name).trim(), stars });
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
    state.employees.push({id, name, stars: []});
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

  function removeEmployee(empId){
    if(!confirm("¿Eliminar empleado?")) return;
    state.employees = state.employees.filter(e=>e.id!==empId);
    // Remove employee from any shifts they were assigned to
    for(const day in state.schedule){
        state.schedule[day].forEach(shift => {
            if(shift.employeeId === empId){
                shift.employeeId = null;
            }
        });
    }
    save(); renderAll();
  }

  function deleteShift(shiftId) {
    const day = state.activeDay;
    ensureDay(day);
    const index = state.schedule[day].findIndex(s => s.id === shiftId);
    if (index > -1) {
        state.schedule[day].splice(index, 1);
        save();
        renderTable();
    }
  }

  /* ====== Horarios ====== */
  function ensureDay(d){
    state.schedule[d] = state.schedule[d] || [];
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
    state.schedule[day].push(newShift);
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
      state.schedule[day].push(newShift);
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

    const day = state.activeDay;
    const shift = state.schedule[day].find(s => s.id === unpaintShiftId);

    if (shift) {
        if (unpaintStartSlot === shift.startSlot && endSlotIndex > shift.startSlot) {
            shift.startSlot = endSlotIndex;
        } else if (unpaintStartSlot === shift.endSlot && endSlotIndex < shift.endSlot) {
            shift.endSlot = endSlotIndex;
        }

        if (shift.startSlot >= shift.endSlot) {
            const index = state.schedule[day].findIndex(s => s.id === unpaintShiftId);
            if (index > -1) state.schedule[day].splice(index, 1);
        }

        save();
        renderTable();
    }

    isUnpainting = false;
    unpaintShiftId = null;
    unpaintStartSlot = -1;
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
    const cols = `240px repeat(${SLOTS.length}, 1fr)`;
    const g = document.createElement("div"); g.className="rowg"; g.style.gridTemplateColumns = cols;

    const name = document.createElement("div");
    name.className="namecol"; name.innerHTML = '<span class="muted" style="font-size:12px">Turno</span>';
    g.appendChild(name);

    SLOTS.forEach(s=>{
      const c = document.createElement("div"); c.className="slot-h"; c.textContent = s.label;
      g.appendChild(c);
    });

    thead.innerHTML=""; thead.appendChild(g);
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

      const top = document.createElement("div"); top.className="row"; top.style.justifyContent="space-between";
      const nm = document.createElement("div"); nm.className="name"; nm.textContent=e.name; top.appendChild(nm);

      const actions = document.createElement("div"); actions.className="row";
      const bEst = document.createElement("button"); bEst.className="btn secondary"; bEst.textContent="Estrellas";
      const bDel = document.createElement("button"); bDel.className="btn secondary del"; bDel.textContent="Eliminar";

      actions.appendChild(bEst); actions.appendChild(bDel); top.appendChild(actions);

      const badges = document.createElement("div"); badges.className="chips"; badges.style.marginTop="8px";
      if(!e.stars || e.stars.length===0){
        const m = document.createElement("span"); m.className="muted"; m.style.fontSize="12px"; m.textContent="Sin estrellas";
        badges.appendChild(m);
      } else {
        e.stars.forEach(s=>{
          const b = document.createElement("span"); b.className="badge "+clsFor(s); b.textContent=s; badges.appendChild(b);
        });
      }

      bEst.addEventListener("click", ()=> openStarsModal(e.id, e.name));
      bDel.addEventListener("click", ()=> removeEmployee(e.id));

      card.appendChild(top); card.appendChild(badges);
      empList.appendChild(card);
    });
  }

  function renderTable(){
    renderHead();
    tbody.innerHTML = "";

    const day = state.activeDay;
    ensureDay(day);
    const shifts = state.schedule[day] || [];

    if (shifts.length === 0) {
        const msgRow = document.createElement("div");
        msgRow.style.padding = "20px";
        msgRow.style.textAlign = "center";
        msgRow.className = "muted";
        msgRow.textContent = "No hay turnos creados para este día. Créalos desde el formulario de arriba o pintando en la fila 'Nuevo Turno'.";
        tbody.appendChild(msgRow);
    }

    shifts.forEach(shift => {
        const cols = `240px repeat(${SLOTS.length}, 1fr)`;
        const row = document.createElement("div");
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
            empName.textContent = emp ? emp.name : "Empleado no encontrado";

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
    const shift = state.schedule[day].find(s => s.id === shiftId);
    if (!shift) {
        alert("No se encontró el turno.");
        return;
    }

    const qualifiedEmployees = state.employees.filter(e => (e.stars || []).includes(shift.role));

    const h = document.createElement("div"); h.className="card-h";
    h.innerHTML = `<strong>Asignar empleado a ${shift.role}</strong>`;
    const c = document.createElement("div"); c.className="card-c stack";

    if (qualifiedEmployees.length === 0) {
        c.textContent = "No hay empleados con la estrella requerida.";
    } else {
        qualifiedEmployees.forEach(emp => {
            const btn = document.createElement("button");
            btn.className = "btn secondary";
            btn.textContent = emp.name;
            btn.style.width = "100%";
            btn.addEventListener("click", () => {
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
    const shift = state.schedule[day].find(s => s.id === shiftId);
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

        shift.role = newRole;
        shift.startSlot = newStart;
        shift.endSlot = newEnd - 1;

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

  /* ====== Inicialización ====== */
  await loadState();
  renderAll();

})();
