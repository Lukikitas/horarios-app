import { store, getActiveSchedule } from '../store/Store.js';
import { firebaseConfig } from '../config.js';

let firestore = null;

export function initFirebase() {
    if (typeof firebase === 'undefined') {
        console.error("Firebase SDK not loaded.");
        return null;
    }
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    firestore = firebase.firestore();
    return firestore;
}

export function getDb() {
    if (!firestore) return initFirebase();
    return firestore;
}

function getMonday(d) {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function toISODateString(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export const DataManager = {
    async loadState() {
        console.log("DataManager: Loading state...");
        store.setState({ isLoading: true });

        try {
            const db = getDb();
            if (!db) throw new Error("Firebase not initialized");

            // 1. Load Main Doc (Settings, Templates, etc.)
            const mainDocRef = db.collection("schedules").doc("main");
            const mainDoc = await mainDocRef.get();

            // 2. Load Employees
            const employeesSnapshot = await db.collection('employees').get();
            const employeesArray = [];
            employeesSnapshot.forEach(doc => {
                employeesArray.push({ id: doc.id, ...doc.data() });
            });

            const currentState = store.getState();
            let newState = { ...currentState };

            if (mainDoc.exists) {
                const data = mainDoc.data();

                // Legacy employees handling
                let legacyEmployees = [];
                if (data.employees) {
                    legacyEmployees = Array.isArray(data.employees) ? data.employees : Object.values(data.employees);
                }

                newState.employees = employeesArray.length > 0 ? employeesArray : legacyEmployees;

                // Normalize employees
                newState.employees.forEach(emp => {
                    if (!emp.id) emp.id = crypto.randomUUID();
                    if (!emp.displayName) {
                        const nameParts = emp.name.split(',');
                        emp.displayName = nameParts.length > 1 ? nameParts[1].trim() : emp.name.split(' ')[0];
                    }
                    if (!emp.availability) emp.availability = {};
                     if (Array.isArray(emp.availability)) {
                        const newAv = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
                        for (let i = 0; i < 7; i++) {
                            const dayData = emp.availability[i];
                            if (dayData && (dayData.start || dayData.end)) {
                                newAv[i] = [dayData];
                            }
                        }
                        emp.availability = newAv;
                    }
                    if (!emp.exceptions) emp.exceptions = [];
                    if (!emp.sanctions) emp.sanctions = [];
                    if (!emp.priority) emp.priority = 'medium';
                });

                newState.breaks = data.breaks || {
                    "9250": [
                        { "id": 1, "text": "POP + PAPAS" }, { "id": 2, "text": "RUSTER + PAPAS" },
                        { "id": 3, "text": "5 ALITAS + PAPAS" }, { "id": 4, "text": "2 PIEZAS + PAPAS" },
                        { "id": 5, "text": "ENSALADA TEAM" }, { "id": 6, "text": "CAFE + 3 MED" },
                        { "id": 7, "text": "TOSTADO REGULAR" }
                    ],
                    "1245": [
                        { "id": 1, "text": "ENTRENADORES" }, { "id": 2, "text": "SUPER PAPAS" },
                        { "id": 3, "text": "3 ALITAS + PAPAS" }, { "id": 8, "text": "9" },
                        { "id": 9, "text": "2 PIEZAS + PAPAS" }, { "id": 10, "text": "ENSALADA + PAPAS" },
                        { "id": 11, "text": "11" }
                    ]
                };
                newState.rappiCode = data.rappiCode || '';
                newState.templates = data.templates || {};
                newState.projectedTickets = data.projectedTickets || {};

                // Initialize active week
                if (!newState.activeWeek) {
                     newState.activeWeek = toISODateString(getMonday(new Date()));
                }

                // --- SCHEDULE LOADING STRATEGY ---
                const weekDocRef = db.collection("weeks").doc(newState.activeWeek);
                const weekDoc = await weekDocRef.get();

                newState.schedules = {}; // Reset schedules cache

                if (weekDoc.exists) {
                    newState.schedules[newState.activeWeek] = weekDoc.data();
                } else {
                    // Fallback
                    let legacySchedules = data.schedules || {};
                    if (data.schedule && !data.schedules) {
                        const weekKey = toISODateString(getMonday(new Date()));
                         legacySchedules = { [weekKey]: data.schedule };
                    }

                    if (legacySchedules[newState.activeWeek]) {
                        newState.schedules[newState.activeWeek] = legacySchedules[newState.activeWeek];
                    } else {
                        // New week
                        newState.schedules[newState.activeWeek] = {};
                    }
                }
            } else {
                 newState.activeWeek = toISODateString(getMonday(new Date()));
                 newState.schedules = { [newState.activeWeek]: {} };
                 newState.employees = employeesArray;
            }

            store.setState(newState);
            console.log("DataManager: State loaded.");

        } catch (error) {
            console.error("Error loading state:", error);
            // alert("Error cargando datos: " + error.message); // Disabled alert to avoid blocking
        } finally {
            store.setState({ isLoading: false });
            console.log("DataManager: Loading finished.");
        }
    },

    async saveState() {
        const db = getDb();
        const state = store.getState();
        const activeWeek = state.activeWeek;
        const currentSchedule = state.schedules[activeWeek];

        try {
            if (activeWeek && currentSchedule) {
                await db.collection("weeks").doc(activeWeek).set(currentSchedule);
            }

            const mainData = {
                templates: state.templates,
                projectedTickets: state.projectedTickets,
                activeDay: state.activeDay,
                activeWeek: state.activeWeek,
                breaks: state.breaks,
                rappiCode: state.rappiCode,
            };
            await db.collection("schedules").doc("main").set(mainData, { merge: true });

            const batch = db.batch();
            let opCount = 0;
            state.employees.forEach(emp => {
                const empRef = db.collection('employees').doc(emp.id);
                batch.set(empRef, emp, { merge: true });
                opCount++;
                if (opCount >= 400) {
                     // In a real generic util we would handle multiple batches.
                }
            });
            if (opCount > 0) await batch.commit();

            console.log("State saved.");
        } catch (error) {
            console.error("Error saving state:", error);
            alert("Error guardando: " + error.message);
        }
    },

    async loadWeek(weekId) {
        const db = getDb();
        const state = store.getState();

        if (state.schedules[weekId]) {
            store.setState({ activeWeek: weekId });
            return;
        }

        store.setState({ isLoading: true });
        try {
            const weekDoc = await db.collection("weeks").doc(weekId).get();
            let weekData = {};

            if (weekDoc.exists) {
                weekData = weekDoc.data();
            } else {
                 const mainDoc = await db.collection("schedules").doc("main").get();
                 if (mainDoc.exists) {
                     const data = mainDoc.data();
                     const legacySchedules = data.schedules || {};
                     if (legacySchedules[weekId]) {
                         weekData = legacySchedules[weekId];
                         await db.collection("weeks").doc(weekId).set(weekData);
                     }
                 }
            }

            store.setState({
                activeWeek: weekId,
                schedules: {
                    ...state.schedules,
                    [weekId]: weekData
                }
            });
        } catch (err) {
            console.error(err);
        } finally {
            store.setState({ isLoading: false });
        }
    }
};
