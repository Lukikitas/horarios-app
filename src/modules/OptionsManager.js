import { el, create, clear } from '../utils/dom.js';
import { store } from '../store/Store.js';
import { ROLES, setRoles, DEFAULT_ROLES } from '../config.js';
import { DataManager } from '../services/DataManager.js';
import { showToast, showConfirmDialog } from '../utils/feedback.js';

export const OptionsManager = {
    init() {
        const addBtn = el('#btn-add-role');
        const resetBtn = el('#btn-reset-roles');
        addBtn?.addEventListener('click', () => this.handleAddRole());
        resetBtn?.addEventListener('click', () => this.handleReset());
        this.renderRoles();
        store.subscribe(() => this.renderRoles());
    },

    getRoles() {
        const current = store.getState().roles;
        return current && current.length ? current : ROLES;
    },

    persistRoles(nextRoles) {
        setRoles(nextRoles);
        store.setState({ roles: [...nextRoles] });
        DataManager.saveState();
    },

    handleAddRole() {
        const nameInput = el('#new-role-name');
        const colorInput = el('#new-role-color');
        const darkTextInput = el('#new-role-darktext');
        if (!nameInput || !colorInput || !darkTextInput) return;

        const name = nameInput.value.trim();
        if (!name) return showToast('Ingresá un nombre para el puesto.', 'warning');

        const roles = this.getRoles();
        if (roles.some(r => r.key.toLowerCase() === name.toLowerCase())) {
            return showToast('Ya existe un puesto con ese nombre.', 'warning');
        }

        const newRole = {
            key: name,
            cls: `b-${name.toLowerCase().replace(/\s+/g, '-')}`,
            color: colorInput.value || '#6b7280',
            darkText: !!darkTextInput.checked,
        };

        this.persistRoles([...roles, newRole]);
        nameInput.value = '';
    },

    async handleReset() {
        const confirmed = await showConfirmDialog({
            title: 'Restaurar puestos',
            message: '¿Restaurar la lista de puestos original?'
        });
        if (!confirmed) return;
        this.persistRoles([...DEFAULT_ROLES]);
    },

    updateRole(index, partial) {
        const roles = [...this.getRoles()];
        roles[index] = { ...roles[index], ...partial };
        this.persistRoles(roles);
    },

    moveRole(index, dir) {
        const roles = [...this.getRoles()];
        const target = index + dir;
        if (target < 0 || target >= roles.length) return;
        const [item] = roles.splice(index, 1);
        roles.splice(target, 0, item);
        this.persistRoles(roles);
    },

    async deleteRole(index) {
        const roles = [...this.getRoles()];
        const role = roles[index];
        if (!role) return;
        const confirmed = await showConfirmDialog({
            title: 'Eliminar puesto',
            message: `¿Eliminar el puesto "${role.key}"?`
        });
        if (!confirmed) return;
        roles.splice(index, 1);
        this.persistRoles(roles);
    },

    renderRoles() {
        const list = el('#roles-list');
        if (!list) return;
        clear(list);
        const roles = this.getRoles();

        roles.forEach((role, idx) => {
            const row = create('div', { className: 'role-row' });
            const name = create('input', {
                className: 'input input-compact',
                value: role.key,
                onChange: (e) => this.updateRole(idx, { key: e.target.value })
            });
            const color = create('input', {
                type: 'color',
                className: 'input color-input',
                value: role.color || '#6b7280',
                onChange: (e) => this.updateRole(idx, { color: e.target.value })
            });
            const darkText = create('label', { className: 'muted', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                create('input', {
                    type: 'checkbox',
                    checked: !!role.darkText,
                    onChange: (e) => this.updateRole(idx, { darkText: e.target.checked })
                }),
                document.createTextNode('Texto oscuro')
            ]);

            const preview = create('div', {
                className: 'role-preview',
                textContent: role.key,
                style: {
                    background: role.color || '#6b7280',
                    color: role.darkText ? '#111' : '#fff'
                }
            });

            const controls = create('div', { className: 'row role-actions' });
            controls.appendChild(create('button', { className: 'btn secondary', textContent: '▲', onClick: () => this.moveRole(idx, -1) }));
            controls.appendChild(create('button', { className: 'btn secondary', textContent: '▼', onClick: () => this.moveRole(idx, 1) }));
            controls.appendChild(create('button', { className: 'btn secondary del', textContent: '✕', onClick: () => this.deleteRole(idx) }));

            row.appendChild(preview);
            row.appendChild(name);
            row.appendChild(color);
            row.appendChild(darkText);
            row.appendChild(controls);

            list.appendChild(row);
        });
    }
};
