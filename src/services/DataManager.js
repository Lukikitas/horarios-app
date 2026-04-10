import { store, getActiveSchedule } from '../store/Store.js';
import { ROLES, setRoles, DEFAULT_ROLES } from '../config.js';
import { getDb, initFirebase } from './firebase.js';
import { showToast } from '../utils/feedback.js';
export { getDb } from './firebase.js';
import {
    legacyEmployeesRef,
    legacySchedulesRef,
    legacyWeeksRef,
    storeDoc,
    storeEmployeesRef,
    storeSchedulesRef,
    storeWeeksRef
} from './firestoreRefs.js';
import { normalizeSchedulingRules } from '../utils/rules.js';

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
    // --- Save coalescing (low-risk perf win) ---
    // Many UI actions call saveState() repeatedly in bursts.
    // We coalesce them into a single write after a short debounce.
    _saveTimer: null,
    _savePendingPromise: null,
    _savePendingResolve: null,
    _savePendingReject: null,
    _saveDebounceMs: 600,
    _writeCacheByStore: {},
    _realtimeStoreId: '',
    _mainRealtimeUnsubscribe: null,
    _storeRootRealtimeUnsubscribe: null,
    _employeesRealtimeUnsubscribe: null,
    _weekRealtimeUnsubscribers: {},
    _weekRealtimeFirstSnapshotDone: {},
    _focusedWeekIds: [],
    _lastRealtimeToastAt: 0,

    _safeStringify(value) {
        try {
            return JSON.stringify(value ?? null);
        } catch (_) {
            return String(Date.now());
        }
    },

    _getStoreWriteCache(storeId) {
        if (!this._writeCacheByStore[storeId]) {
            this._writeCacheByStore[storeId] = {
                mainSignature: '',
                storeNameSignature: '',
                weeks: {},
                employees: {}
            };
        }
        return this._writeCacheByStore[storeId];
    },

    _primeWriteCacheFromState(storeId, state) {
        if (!storeId || !state) return;
        const cache = this._getStoreWriteCache(storeId);

        const mainData = {
            templates: state.templates,
            projectedTickets: state.projectedTickets,
            activeDay: state.activeDay,
            activeWeek: state.activeWeek,
            breaks: state.breaks,
            rappiCode: state.rappiCode,
            roles: state.roles && state.roles.length ? state.roles : ROLES,
            storeName: (state.storeName || storeId || '').trim(),
            schedulingRules: normalizeSchedulingRules(state.schedulingRules || {}),
            schedulingPeriodWeeks: [1, 2, 4].includes(Number(state.schedulingPeriodWeeks)) ? Number(state.schedulingPeriodWeeks) : 1,
        };

        cache.mainSignature = this._safeStringify(mainData);
        cache.storeNameSignature = this._safeStringify({
            displayName: (state.storeName || storeId || '').trim() || storeId,
        });

        const activeWeek = state.activeWeek;
        if (activeWeek) {
            cache.weeks[activeWeek] = this._safeStringify(state.schedules?.[activeWeek] || {});
        }

        cache.employees = {};
        (state.employees || []).forEach(emp => {
            if (!emp?.id) return;
            cache.employees[emp.id] = this._safeStringify(emp);
        });
    },

    async loadState(storeId) {
        console.log("DataManager: Loading state...");
        store.setState({ isLoading: true });

        try {
            const db = getDb();
            if (!db) throw new Error("Firebase not initialized");

            if (!storeId) throw new Error('Falta storeId activo');

            const schedulesRef = storeSchedulesRef(storeId);
            const employeesRef = storeEmployeesRef(storeId);
            const weeksRef = storeWeeksRef(storeId);
            const storeRootRef = storeDoc(storeId);

            // 1. Load Main Doc (Settings, Templates, etc.)
            const mainDocRef = schedulesRef.doc("main");
            const [mainDoc, storeRootSnap] = await Promise.all([
                mainDocRef.get(),
                storeRootRef.get(),
            ]);

            // 2. Load Employees
            const employeesSnapshot = await employeesRef.get();
            const employeesArray = [];
            employeesSnapshot.forEach(doc => {
                employeesArray.push({ id: doc.id, ...doc.data() });
            });

            const currentState = store.getState();
            let newState = { ...currentState };

            let data = null;
            if (mainDoc.exists) {
                data = mainDoc.data();
            } else {
                // TODO MIGRACION MULTI-LOCAL: fallback a estructura legacy
                console.warn('DataManager: usando schedules/main legacy');
                const legacyMain = await legacySchedulesRef().doc('main').get();
                if (legacyMain.exists) {
                    data = legacyMain.data();
                }
            }

            if (data) {

                // Legacy employees handling
                let legacyEmployees = [];
                if (data.employees) {
                    legacyEmployees = Array.isArray(data.employees) ? data.employees : Object.values(data.employees);
                }

                if (!employeesArray.length && legacyEmployees.length) {
                    console.warn('DataManager: empleados desde estructura legacy');
                }
                newState.employees = employeesArray.length > 0 ? employeesArray : legacyEmployees;

                const loadedRoles = Array.isArray(data.roles) && data.roles.length > 0 ? data.roles : DEFAULT_ROLES;
                setRoles(loadedRoles);
                newState.roles = [...ROLES];

                // Normalize employees
                newState.employees.forEach(emp => {
                    if (!emp.id) emp.id = crypto.randomUUID();
                    if (!emp.displayName) {
                        const name = emp.name || 'Sin Nombre';
                        const nameParts = name.split(',');
                        emp.displayName = nameParts.length > 1 ? nameParts[1].trim() : name.split(' ')[0];
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
                newState.storeName = (storeRootSnap.data()?.displayName || data.storeName || storeId || '').trim();
                newState.schedulingRules = normalizeSchedulingRules(data.schedulingRules || {});
                newState.schedulingPeriodWeeks = [1, 2, 4].includes(Number(data.schedulingPeriodWeeks)) ? Number(data.schedulingPeriodWeeks) : 1;

                // Initialize active week
                if (!newState.activeWeek) {
                     newState.activeWeek = toISODateString(getMonday(new Date()));
                }

                // --- SCHEDULE LOADING STRATEGY ---
                const weekDocRef = weeksRef.doc(newState.activeWeek);
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
                        // Intentar levantar semana de estructura legacy weeks
                        const legacyWeekDoc = await legacyWeeksRef().doc(newState.activeWeek).get();
                        if (legacyWeekDoc.exists) {
                            newState.schedules[newState.activeWeek] = legacyWeekDoc.data();
                        } else {
                            // New week
                            newState.schedules[newState.activeWeek] = {};
                        }
                    }
                }
            } else {
                 newState.activeWeek = toISODateString(getMonday(new Date()));
                 newState.schedules = { [newState.activeWeek]: {} };
                 newState.employees = employeesArray;
                 setRoles(DEFAULT_ROLES);
                 newState.roles = [...ROLES];
                 newState.storeName = (storeRootSnap.data()?.displayName || storeId || '').trim();
                 newState.schedulingRules = normalizeSchedulingRules();
                 newState.schedulingPeriodWeeks = 1;
            }

            store.setState(newState);
            this._primeWriteCacheFromState(storeId, newState);
            this._startCoreRealtime(storeId);
            this.setRealtimeFocusWeeks([newState.activeWeek]);
            console.log("DataManager: State loaded.");

        } catch (error) {
            console.error("Error loading state:", error);
            // alert("Error cargando datos: " + error.message); // Disabled alert to avoid blocking
        } finally {
            store.setState({ isLoading: false });
            console.log("DataManager: Loading finished.");
        }
    },

    async _saveStateNow() {
        const db = getDb();
        const state = store.getState();
        const storeId = state.activeStoreId;
        if (!storeId) {
            console.warn('Intento de guardar sin store activo');
            return;
        }
        const schedulesRef = storeSchedulesRef(storeId);
        const employeesRef = storeEmployeesRef(storeId);
        const weeksRef = storeWeeksRef(storeId);
        const storeRootRef = storeDoc(storeId);
        const activeWeek = state.activeWeek;
        const currentSchedule = state.schedules[activeWeek];
        const cache = this._getStoreWriteCache(storeId);

        try {
            if (activeWeek && currentSchedule) {
                const weekSignature = this._safeStringify(currentSchedule);
                if (cache.weeks[activeWeek] !== weekSignature) {
                    await weeksRef.doc(activeWeek).set(currentSchedule);
                    cache.weeks[activeWeek] = weekSignature;
                }
            }

            const mainData = {
                templates: state.templates,
                projectedTickets: state.projectedTickets,
                activeDay: state.activeDay,
                activeWeek: state.activeWeek,
                breaks: state.breaks,
                rappiCode: state.rappiCode,
                roles: state.roles && state.roles.length ? state.roles : ROLES,
                storeName: (state.storeName || storeId || '').trim(),
                schedulingRules: normalizeSchedulingRules(state.schedulingRules || {}),
                schedulingPeriodWeeks: [1, 2, 4].includes(Number(state.schedulingPeriodWeeks)) ? Number(state.schedulingPeriodWeeks) : 1,
            };
            const nextMainSignature = this._safeStringify(mainData);
            const nextStoreNamePayload = {
                displayName: (state.storeName || storeId || '').trim() || storeId,
            };
            const nextStoreNameSignature = this._safeStringify(nextStoreNamePayload);

            const mainOps = [];
            if (cache.mainSignature !== nextMainSignature) {
                mainOps.push(schedulesRef.doc("main").set(mainData, { merge: true }));
                cache.mainSignature = nextMainSignature;
            }
            if (cache.storeNameSignature !== nextStoreNameSignature) {
                mainOps.push(storeRootRef.set(nextStoreNamePayload, { merge: true }));
                cache.storeNameSignature = nextStoreNameSignature;
            }
            if (mainOps.length > 0) {
                await Promise.all(mainOps);
            }

            const batch = db.batch();
            let opCount = 0;
            const seenEmployeeIds = new Set();
            state.employees.forEach(emp => {
                if (!emp?.id) return;
                seenEmployeeIds.add(emp.id);
                const empSignature = this._safeStringify(emp);
                if (cache.employees[emp.id] === empSignature) return;
                const empRef = employeesRef.doc(emp.id);
                batch.set(empRef, emp, { merge: true });
                cache.employees[emp.id] = empSignature;
                opCount++;
                if (opCount >= 400) {
                     // In a real generic util we would handle multiple batches.
                }
            });
            // Clean cache entries for employees no longer in state.
            Object.keys(cache.employees).forEach(empId => {
                if (!seenEmployeeIds.has(empId)) delete cache.employees[empId];
            });
            if (opCount > 0) await batch.commit();

            console.log("State saved.");
        } catch (error) {
            console.error("Error saving state:", error);
            showToast("Error guardando: " + error.message, "error");
        }
    },

    /**
     * Persists current state to Firestore.
     * By default it's debounced to avoid write storms; pass `{ immediate: true }` to flush now.
     */
    async saveState(options = {}) {
        const immediate = options?.immediate === true;

        if (immediate) {
            if (this._saveTimer) {
                clearTimeout(this._saveTimer);
                this._saveTimer = null;
            }
            // If there's a pending debounced promise, reuse it and resolve/reject accordingly.
            if (!this._savePendingPromise) {
                this._savePendingPromise = new Promise((resolve, reject) => {
                    this._savePendingResolve = resolve;
                    this._savePendingReject = reject;
                });
            }

            try {
                await this._saveStateNow();
                this._savePendingResolve?.(true);
            } catch (err) {
                this._savePendingReject?.(err);
                throw err;
            } finally {
                this._savePendingPromise = null;
                this._savePendingResolve = null;
                this._savePendingReject = null;
            }
            return true;
        }

        if (this._savePendingPromise) return this._savePendingPromise;

        this._savePendingPromise = new Promise((resolve, reject) => {
            this._savePendingResolve = resolve;
            this._savePendingReject = reject;
        });

        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(async () => {
            this._saveTimer = null;
            try {
                await this._saveStateNow();
                this._savePendingResolve?.(true);
            } catch (err) {
                this._savePendingReject?.(err);
            } finally {
                this._savePendingPromise = null;
                this._savePendingResolve = null;
                this._savePendingReject = null;
            }
        }, this._saveDebounceMs);

        return this._savePendingPromise;
    },

    /**
     * Best-effort flush. Useful when you want to save sooner than the debounce window.
     */
    async flushSaveState() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        return this.saveState({ immediate: true });
    },

    async saveWeek(weekId) {
        const state = store.getState();
        const storeId = state.activeStoreId;
        if (!storeId || !weekId) return;
        const weeksRef = storeWeeksRef(storeId);
        const cache = this._getStoreWriteCache(storeId);
        try {
            const weekPayload = state.schedules[weekId] || {};
            const sig = this._safeStringify(weekPayload);
            if (cache.weeks[weekId] === sig) return;
            await weeksRef.doc(weekId).set(weekPayload);
            cache.weeks[weekId] = sig;
        } catch (error) {
            console.error("Error guardando semana:", error);
            showToast("Error guardando semana: " + error.message, "error");
        }
    },

    async loadWeek(weekId) {
        const db = getDb();
        const state = store.getState();
        const storeId = state.activeStoreId;
        if (!storeId) {
            console.warn('Intento de cargar semana sin store activo');
            return;
        }
        const weeksRef = storeWeeksRef(storeId);

        if (state.schedules[weekId]) {
            store.setState({ activeWeek: weekId });
            return;
        }

        store.setState({ isLoading: true });
        try {
            const weekDoc = await weeksRef.doc(weekId).get();
            let weekData = {};

            if (weekDoc.exists) {
                weekData = weekDoc.data();
            } else {
                 // TODO MIGRACION MULTI-LOCAL: fallback a estructura legacy
                 const mainDoc = await legacySchedulesRef().doc("main").get();
                 if (mainDoc.exists) {
                     const data = mainDoc.data();
                     const legacySchedules = data.schedules || {};
                     if (legacySchedules[weekId]) {
                         weekData = legacySchedules[weekId];
                         await weeksRef.doc(weekId).set(weekData);
                     }
                 } else {
                     const legacyWeekDoc = await legacyWeeksRef().doc(weekId).get();
                     if (legacyWeekDoc.exists) {
                        weekData = legacyWeekDoc.data();
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
            this.setRealtimeFocusWeeks([weekId]);
        } catch (err) {
            console.error(err);
        } finally {
            store.setState({ isLoading: false });
        }
    },

    async getWeekData(weekId) {
        const state = store.getState();
        const storeId = state.activeStoreId;
        if (!storeId) {
            console.warn('Intento de obtener semana sin store activo');
            return {};
        }

        if (state.schedules[weekId]) return state.schedules[weekId];

        const weeksRef = storeWeeksRef(storeId);
        let weekData = {};

        try {
            const weekDoc = await weeksRef.doc(weekId).get();
            if (weekDoc.exists) {
                weekData = weekDoc.data();
            } else {
                const mainDoc = await legacySchedulesRef().doc("main").get();
                if (mainDoc.exists) {
                    const data = mainDoc.data();
                    const legacySchedules = data.schedules || {};
                    if (legacySchedules[weekId]) {
                        weekData = legacySchedules[weekId];
                        await weeksRef.doc(weekId).set(weekData);
                    }
                } else {
                    const legacyWeekDoc = await legacyWeeksRef().doc(weekId).get();
                    if (legacyWeekDoc.exists) weekData = legacyWeekDoc.data();
                }
            }

            store.setState({
                schedules: {
                    ...store.getState().schedules,
                    [weekId]: weekData
                }
            });
            this.setRealtimeFocusWeeks([store.getState().activeWeek, weekId]);
        } catch (err) {
            console.error(err);
        }

        return weekData;
    },

    _stopStoreRealtime() {
        [this._mainRealtimeUnsubscribe, this._storeRootRealtimeUnsubscribe, this._employeesRealtimeUnsubscribe].forEach((unsub) => {
            if (!unsub) return;
            try { unsub(); } catch (error) { console.error('Error cerrando listener realtime', error); }
        });
        this._mainRealtimeUnsubscribe = null;
        this._storeRootRealtimeUnsubscribe = null;
        this._employeesRealtimeUnsubscribe = null;
        Object.values(this._weekRealtimeUnsubscribers).forEach((unsub) => {
            if (!unsub) return;
            try { unsub(); } catch (error) { console.error('Error cerrando listener de semana', error); }
        });
        this._weekRealtimeUnsubscribers = {};
        this._weekRealtimeFirstSnapshotDone = {};
        this._focusedWeekIds = [];
        this._realtimeStoreId = '';
    },

    _startCoreRealtime(storeId) {
        if (!storeId) {
            this._stopStoreRealtime();
            return;
        }
        if (this._realtimeStoreId === storeId && this._mainRealtimeUnsubscribe && this._employeesRealtimeUnsubscribe) return;

        this._stopStoreRealtime();
        this._realtimeStoreId = storeId;

        this._mainRealtimeUnsubscribe = storeSchedulesRef(storeId).doc('main').onSnapshot((snapshot) => {
            if (!snapshot.exists) return;
            const data = snapshot.data() || {};
            const state = store.getState();
            const incomingMain = {
                templates: data.templates || {},
                projectedTickets: data.projectedTickets || {},
                breaks: data.breaks || {},
                rappiCode: data.rappiCode || '',
                roles: Array.isArray(data.roles) && data.roles.length ? data.roles : DEFAULT_ROLES,
                schedulingRules: normalizeSchedulingRules(data.schedulingRules || {}),
                schedulingPeriodWeeks: [1, 2, 4].includes(Number(data.schedulingPeriodWeeks)) ? Number(data.schedulingPeriodWeeks) : 1,
            };
            const currentMain = {
                templates: state.templates || {},
                projectedTickets: state.projectedTickets || {},
                breaks: state.breaks || {},
                rappiCode: state.rappiCode || '',
                roles: state.roles && state.roles.length ? state.roles : DEFAULT_ROLES,
                schedulingRules: normalizeSchedulingRules(state.schedulingRules || {}),
                schedulingPeriodWeeks: [1, 2, 4].includes(Number(state.schedulingPeriodWeeks)) ? Number(state.schedulingPeriodWeeks) : 1,
            };
            if (this._safeStringify(currentMain) === this._safeStringify(incomingMain)) return;
            setRoles(incomingMain.roles);
            store.setState(incomingMain);
            this._primeWriteCacheFromState(storeId, store.getState());
            this._maybeShowRealtimeToast(snapshot.metadata);
        });

        this._storeRootRealtimeUnsubscribe = storeDoc(storeId).onSnapshot((snapshot) => {
            if (!snapshot.exists) return;
            const displayName = (snapshot.data()?.displayName || storeId || '').trim();
            if (displayName && displayName !== (store.getState().storeName || '').trim()) {
                store.setState({ storeName: displayName });
                this._maybeShowRealtimeToast(snapshot.metadata);
            }
        });

        this._employeesRealtimeUnsubscribe = storeEmployeesRef(storeId).onSnapshot((snapshot) => {
            const employees = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            employees.forEach((emp) => {
                if (!emp.displayName) {
                    const name = emp.name || 'Sin Nombre';
                    const nameParts = String(name).split(',');
                    emp.displayName = nameParts.length > 1 ? nameParts[1].trim() : String(name).split(' ')[0];
                }
                if (!emp.availability) emp.availability = {};
                if (!emp.exceptions) emp.exceptions = [];
                if (!emp.sanctions) emp.sanctions = [];
                if (!emp.priority) emp.priority = 'medium';
            });
            const current = store.getState().employees || [];
            if (this._safeStringify(current) === this._safeStringify(employees)) return;
            const cache = this._getStoreWriteCache(storeId);
            cache.employees = {};
            employees.forEach((emp) => { if (emp?.id) cache.employees[emp.id] = this._safeStringify(emp); });
            store.setState({ employees });
            this._maybeShowRealtimeToast(snapshot.metadata);
        });
    },

    _startWeekRealtime(storeId, weekId) {
        if (!storeId || !weekId) return;
        if (this._weekRealtimeUnsubscribers[weekId]) return;
        this._weekRealtimeFirstSnapshotDone[weekId] = false;
        const weekRef = storeWeeksRef(storeId).doc(weekId);
        this._weekRealtimeUnsubscribers[weekId] = weekRef.onSnapshot((snapshot) => {
            if (!snapshot.exists) return;
            const incomingWeek = snapshot.data() || {};
            const incomingSignature = this._safeStringify(incomingWeek);
            const cache = this._getStoreWriteCache(storeId);
            const state = store.getState();
            const currentWeek = state.schedules?.[weekId] || {};
            const currentSignature = this._safeStringify(currentWeek);

            if (!this._weekRealtimeFirstSnapshotDone[weekId]) {
                this._weekRealtimeFirstSnapshotDone[weekId] = true;
                cache.weeks[weekId] = incomingSignature;
                if (currentSignature !== incomingSignature) {
                    store.setState({ schedules: { ...state.schedules, [weekId]: incomingWeek } });
                }
                return;
            }
            if (currentSignature === incomingSignature) return;
            cache.weeks[weekId] = incomingSignature;
            store.setState({ schedules: { ...state.schedules, [weekId]: incomingWeek } });
            this._maybeShowRealtimeToast(snapshot.metadata);
        }, (error) => {
            console.error('Error en realtime de semana', error);
        });
    },

    _stopWeekRealtime(weekId) {
        const unsub = this._weekRealtimeUnsubscribers[weekId];
        if (!unsub) return;
        try { unsub(); } catch (error) { console.error('Error cerrando listener de semana', error); }
        delete this._weekRealtimeUnsubscribers[weekId];
        delete this._weekRealtimeFirstSnapshotDone[weekId];
    },

    _maybeShowRealtimeToast(metadata) {
        const now = Date.now();
        if (!metadata?.hasPendingWrites && now - this._lastRealtimeToastAt > 2200) {
            this._lastRealtimeToastAt = now;
            showToast('Se aplicaron cambios en tiempo real de otro manager.', 'info');
        }
    },

    setRealtimeFocusWeeks(weekIds = []) {
        const state = store.getState();
        const storeId = state.activeStoreId;
        if (!storeId) return;
        this._startCoreRealtime(storeId);
        const normalized = [...new Set((weekIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
        const activeWeek = String(state.activeWeek || '').trim();
        if (activeWeek && !normalized.includes(activeWeek)) normalized.unshift(activeWeek);
        const limited = normalized.slice(0, 8);
        const target = new Set(limited);
        Object.keys(this._weekRealtimeUnsubscribers).forEach((existingWeekId) => {
            if (!target.has(existingWeekId)) this._stopWeekRealtime(existingWeekId);
        });
        limited.forEach((weekId) => this._startWeekRealtime(storeId, weekId));
        this._focusedWeekIds = limited;
    },
};
