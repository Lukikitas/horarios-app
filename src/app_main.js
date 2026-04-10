import { DataManager } from './services/DataManager.js';
import { initFirebase } from './services/firebase.js';
import { SessionService } from './services/SessionService.js';
import { store } from './store/Store.js';
import { UIManager } from './modules/UIManager.js';
import { EmployeeManager } from './modules/EmployeeManager.js';
import { ScheduleManager } from './modules/ScheduleManager.js';
import { RequestsManager } from './modules/RequestsManager.js';
import { StatsManager } from './modules/StatsManager.js';
import { ImportExportManager } from './modules/ImportExportManager.js';
import { OptionsManager } from './modules/OptionsManager.js';
import { el } from './utils/dom.js';

// Init
async function init() {
    console.log("App Main: Starting Init");
    initFirebase();
    try {
        await SessionService.requireSession();
    } catch (err) {
        console.error('No se pudo iniciar sesión/seleccionar local', err);
        return;
    }

    // Bind global managers
    UIManager.init();
    EmployeeManager.init();
    ScheduleManager.init();
    RequestsManager.init();
    StatsManager.init();
    ImportExportManager.init();
    OptionsManager.init();

    // Subscribe renderers to store changes
    store.subscribe((state) => {
        // Simple global render for now, optimized later
        if (!state.isLoading) {
             const overlay = el("#loading-overlay");
             if (overlay) overlay.classList.add("hidden");
        }

        // Conditional rendering based on active view to avoid heavy work
        // Ideally each manager subscribes to what it needs.

        // For now, call specific render methods based on view
        if (state.activeView === 'employees') EmployeeManager.renderList();
        if (state.activeView === 'schedule' || state.activeView === 'schedule-list') ScheduleManager.render();
        if (state.activeView === 'francos' || state.activeView === 'clock-ins' || state.activeView === 'planilla-turno') StatsManager.render();
        if (state.activeView === 'requests') RequestsManager.render();
        // ... etc

        // Always update some common UI?
        // Like the Week Selector label
    });

    // Initial Load
    await DataManager.loadState(store.getState().activeStoreId);

    // Try to persist pending cambios antes de salir/cerrar pestaña
    window.addEventListener('beforeunload', () => {
        // Best-effort flush (still async, but avoids waiting for debounce window)
        DataManager.flushSaveState?.();
    });

    document.addEventListener('store-changed', async (event) => {
        const storeId = event.detail?.storeId;
        if (!storeId) return;
        store.setState({ isLoading: true });
        await DataManager.loadState(storeId);
        UIManager.showView(store.getState().activeView || 'schedule');
    });

    // Force initial render (store subscribe might trigger on loadState but let's be sure)
    UIManager.showView('schedule');
}

// Start
init();
