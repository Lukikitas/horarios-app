import { el } from '../utils/dom.js';
import { store } from '../store/Store.js';
import { DataManager } from '../services/DataManager.js';

export const UIManager = {
    init() {
        this.bindEvents();
    },

    bindEvents() {
        const views = [
            { id: 'schedule', btn: '#btn-view-schedule' },
            { id: 'employees', btn: '#btn-view-employees' },
            { id: 'schedule-list', btn: '#btn-schedule-list' },
            { id: 'clock-ins', btn: '#btn-view-clock-ins' },
            { id: 'requests', btn: '#btn-view-requests' },
            { id: 'templates', btn: '#btn-view-templates' },
            { id: 'francos', btn: '#btn-view-francos' },
            { id: 'planilla-turno', btn: '#btn-planilla-turno' },
            { id: 'options', btn: '#btn-view-options' }
        ];

        views.forEach(v => {
            const btn = el(v.btn);
            if (btn) {
                btn.addEventListener('click', () => this.showView(v.id));
            }
        });

        el("#btn-dark-mode")?.addEventListener("click", () => this.toggleDarkMode());

        this.bindActionsDropdown();
        this.bindMoreDropdown();

        // Init Dark Mode
        if (localStorage.getItem("darkMode") === "enabled") {
            this.setDarkMode(true);
        }
    },

    bindActionsDropdown() {
        this.setupDropdown('#btn-actions', '#actions-dropdown');
    },

    bindMoreDropdown() {
        this.setupDropdown('#btn-more', '#more-dropdown');
    },

    setupDropdown(btnSelector, dropdownSelector) {
        const btn = el(btnSelector);
        const dropdown = el(dropdownSelector);
        if (!btn || !dropdown) return;

        const hide = () => dropdown.classList.remove('show');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('show');
            document.querySelectorAll('.dropdown-content').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
            dropdown.classList.toggle('show', !isOpen);
        });

        dropdown.querySelectorAll('.dropdown-item').forEach(item => item.addEventListener('click', hide));

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== btn) hide();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hide();
        });
    },

    showView(viewName) {
        // Hide all views
        const allViews = [
            'view-schedule', 'view-employees', 'view-templates',
            'view-schedule-list', 'view-francos', 'view-clock-ins',
            'view-planilla-turno', 'view-requests', 'view-options'
        ];
        allViews.forEach(id => {
            const elem = el('#' + id);
            if(elem) elem.style.display = 'none';
        });

        // Reset buttons
        document.querySelectorAll('.main-menu-btn').forEach(btn => {
            btn.classList.add('secondary');
        });

        // Show specific view
        let viewId = '';
        let btnId = '';

        switch(viewName) {
            case 'schedule': viewId='view-schedule'; btnId='#btn-view-schedule'; break;
            case 'employees': viewId='view-employees'; btnId='#btn-view-employees'; break;
            case 'templates': viewId='view-templates'; btnId='#btn-view-templates'; break;
            case 'francos': viewId='view-francos'; btnId='#btn-view-francos'; break;
            case 'schedule-list': viewId='view-schedule-list'; btnId='#btn-schedule-list'; break;
            case 'clock-ins': viewId='view-clock-ins'; btnId='#btn-view-clock-ins'; break;
            case 'requests': viewId='view-requests'; btnId='#btn-view-requests'; break;
            case 'planilla-turno': viewId='view-planilla-turno'; btnId='#btn-planilla-turno'; break;
            case 'options': viewId='view-options'; btnId='#btn-view-options'; break;
        }

        const viewEl = el('#' + viewId);
        if(viewEl) viewEl.style.display = 'block';

        const btnEl = el(btnId);
        if(btnEl) btnEl.classList.remove('secondary');

        // Handle special logic (like cleaning temp state)
        if (viewName !== 'planilla-turno') {
             store.setState({ tempPlanillaState: null });
             const btn = el("#btn-edit-planilla");
             if (btn) {
                 btn.textContent = "Editar Planilla";
                 btn.classList.remove("btn-primary");
                 btn.classList.add("btn-secondary");
             }
        }

        store.setState({ activeView: viewName }); // Optional: store current view

        // Trigger render for the specific view?
        // Ideally we just trigger a global render or the store listeners handle it.
        // But for now, let's call the global render via a custom event or callback if we can't import it.
        // Actually, we can assume components listen to store, BUT view switching doesn't change data, only visibility.
        // Components should know to render if their container is visible.
        // We will dispatch a custom event 'view-changed'.
        document.dispatchEvent(new CustomEvent('view-changed', { detail: { view: viewName } }));
    },

    toggleDarkMode() {
        const isDark = document.body.classList.contains("dark-mode");
        this.setDarkMode(!isDark);
    },

    setDarkMode(isDark) {
        const btn = el("#btn-dark-mode");
        if (isDark) {
            document.body.classList.add("dark-mode");
            if(btn) btn.textContent = "☀️";
            localStorage.setItem("darkMode", "enabled");
        } else {
            document.body.classList.remove("dark-mode");
            if(btn) btn.textContent = "🌙";
            localStorage.setItem("darkMode", "disabled");
        }
    }
};
