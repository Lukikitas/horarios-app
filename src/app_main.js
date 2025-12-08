import { DataManager, initFirebase } from './services/DataManager.js';
import { store } from './store/Store.js';
import { UIManager } from './modules/UIManager.js';
import { EmployeeManager } from './modules/EmployeeManager.js';
import { ScheduleManager } from './modules/ScheduleManager.js';
import { RequestsManager } from './modules/RequestsManager.js';
import { StatsManager } from './modules/StatsManager.js';
import { ImportExportManager } from './modules/ImportExportManager.js';
import { el } from './utils/dom.js';

// Init
async function init() {
    console.log("App Main: Starting Init");
    initFirebase();

    // Bind global managers
    UIManager.init();
    EmployeeManager.init();
    ScheduleManager.init();
    RequestsManager.init();
    StatsManager.init();
    ImportExportManager.init();

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
        // (This is a simplified approach to mimic the original monolithic renderAll)
        if (state.activeView === 'employees') EmployeeManager.renderList();
        if (state.activeView === 'schedule') ScheduleManager.render();
        // ... etc

        // Always update some common UI?
        // Like the Week Selector label
    });

    // Initial Load
    await DataManager.loadState();

    // Force initial render (store subscribe might trigger on loadState but let's be sure)
    UIManager.showView('schedule');
}

// Start
init();
