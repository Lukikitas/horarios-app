export const firebaseConfig = {
  apiKey: "AIzaSyBbMWJbE6VWqPg4LeKBO7WUz3H6e8GcPQw",
  authDomain: "horarios-data.firebaseapp.com",
  projectId: "horarios-data",
  storageBucket: "horarios-data.appspot.com",
  messagingSenderId: "246551180733",
  appId: "1:246551180733:web:98d9f2187f245f37f20ed4"
};

function generateTimeSlots(){
  const out = [];
  let h=6, m=0;
  for(let i=0;i<40;i++){
    out.push({index:i,label:String(h).padStart(2,'0')+":"+String(m).padStart(2,'0'),h,m});
    m+=30; if(m>=60){m=0; h++; if(h===24) h=0;}
  }
  return out;
}

export const SLOTS = generateTimeSlots();

// Need to create logic for computing colors based on css variables
// Since this runs in module scope, we can try to read them, but DOM might not be ready or styles not applied.
// We will hardcode fallback or read on init.
// For config, better to hardcode defaults or use a function.

export let ROLES = [
    { key: "Cocina",       cls: "b-cocina",       color: "#ef4444",       darkText:false },
    { key: "Empaque",      cls: "b-empaque",      color: "#f97316",      darkText:false },
    { key: "Sandwich",     cls: "b-sandwich",     color: "#facc15",     darkText:true  },
    { key: "Lobby",        cls: "b-lobby",        color: "#10b981",        darkText:false },
    { key: "Presentación", cls: "b-presentación", color: "#0ea5e9", darkText:false },
    { key: "Delivery",     cls: "b-delivery",     color: "#6366f1",     darkText:false },
    { key: "Caja",         cls: "b-caja",         color: "#8b5cf6",         darkText:false },
    { key: "Anfitriona",   cls: "b-anfitriona",   color: "#ec4899",   darkText:false },
    { key: "Descarga",     cls: "b-descarga",     color: "#14b8a6",     darkText:false },
];

export const DEFAULT_ROLES = [...ROLES];

export const DEFAULT_SCHEDULING_RULES = {
  maxConsecutiveDays: {
    enabled: true,
    limit: 5,
  },
};

export function setRoles(newRoles = []) {
  ROLES.splice(0, ROLES.length, ...newRoles);
}

export const DAYS = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
export const MAX_SLOT_FOR_MINOR = 27;
