export class Store {
    constructor(initialState = {}) {
        this.state = initialState;
        this.listeners = new Set();
    }

    getState() {
        return this.state;
    }

    setState(partialState) {
        this.state = { ...this.state, ...partialState };
        this.notify();
    }

    // Update a specific property of the state (shallow merge if it's an object is not automatic here,
    // but setState does a shallow merge of the root.
    // This helper is for nested updates or clearer intent)
    update(key, value) {
        this.setState({ [key]: value });
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        this.listeners.forEach(listener => listener(this.state));
    }
}

// Create a singleton instance with default state
// Default state structure matches the original app.js state
import { HistoryManager } from '../history.js';
import { ROLES } from '../config.js';

const defaultState = {
    currentUser: null,
    activeStoreId: null,
    employees: [],
    schedules: {}, // Will now act as a cache or hold only current week?
                   // Plan: schedules will hold loaded weeks. activeWeek points to current.
    templates: {},
    projectedTickets: {},
    activeWeek: null, // Set on init
    activeDay: 0,
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
    scheduleSelectedEmployeeIds: [],
    scheduleSelectedEmployeeSearch: '',
    breaks: {},
    tempPlanillaState: null,
    rappiCode: '',
    roles: [...ROLES],
    // Data loaded flags
    isLoading: true,
};

export const store = new Store(defaultState);
export const historyManager = new HistoryManager();

// Helper to get active schedule safely
export function getActiveSchedule() {
    const s = store.getState();
    if (!s.activeWeek) return null;
    if (!s.schedules[s.activeWeek]) {
        // Return a default empty schedule structure if not found (or should we create it?)
        // In the original app, it created it on the fly.
        return { isLocked: false };
        // Note: We should probably ensure it exists in the state via DataManager
    }
    return s.schedules[s.activeWeek];
}
