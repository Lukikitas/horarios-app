import { el, create, clear } from '../utils/dom.js';
import { store } from '../store/Store.js';
import { ROLES, setRoles, DEFAULT_ROLES } from '../config.js';
import { DataManager } from '../services/DataManager.js';
import { showToast, showConfirmDialog } from '../utils/feedback.js';
import { AdminService } from '../services/AdminService.js';
import { normalizeSchedulingRules } from '../utils/rules.js';

export const OptionsManager = {
    adminStores: [],

    init() {
        const addBtn = el('#btn-add-role');
        const resetBtn = el('#btn-reset-roles');
        addBtn?.addEventListener('click', () => this.handleAddRole());
        resetBtn?.addEventListener('click', () => this.handleReset());
        el('#store-settings-form')?.addEventListener('submit', (event) => this.handleStoreSettingsSubmit(event));
        el('#rule-max-consecutive-enabled')?.addEventListener('change', () => this.renderStoreSettings());
        el('#admin-create-user-form')?.addEventListener('submit', (event) => this.handleCreateUser(event));
        el('#admin-store-mode')?.addEventListener('change', () => this.syncAdminStoreMode());
        this.renderRoles();
        this.renderStoreSettings();
        this.renderAdminPanel();
        store.subscribe(() => this.renderRoles());
        store.subscribe(() => this.renderStoreSettings());
        store.subscribe(() => this.renderAdminPanel());
        this.loadStores();
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
    },

    async loadStores() {
        if (store.getState().currentUser?.role !== 'admin') return;
        try {
            this.adminStores = await AdminService.listStores();
            this.renderAdminStoreOptions();
        } catch (error) {
            console.error('No se pudieron cargar los locales.', error);
            showToast('No se pudieron cargar los locales.', 'warning');
        }
    },

    renderAdminPanel() {
        const wrapper = el('#admin-user-management');
        if (!wrapper) return;
        const isAdmin = store.getState().currentUser?.role === 'admin';
        wrapper.style.display = isAdmin ? 'block' : 'none';
        if (!isAdmin) return;
        this.renderAdminStoreOptions();
        this.syncAdminStoreMode();
    },

    renderStoreSettings() {
        const storeNameInput = el('#store-display-name');
        const consecutiveEnabledInput = el('#rule-max-consecutive-enabled');
        const consecutiveLimitInput = el('#rule-max-consecutive-limit');
        if (!storeNameInput || !consecutiveEnabledInput || !consecutiveLimitInput) return;

        const state = store.getState();
        const rules = normalizeSchedulingRules(state.schedulingRules || {});
        const safeStoreName = state.storeName || state.activeStoreId || '';

        if (document.activeElement !== storeNameInput) {
            storeNameInput.value = safeStoreName;
        }
        if (document.activeElement !== consecutiveLimitInput) {
            consecutiveLimitInput.value = String(rules.maxConsecutiveDays.limit);
        }
        consecutiveEnabledInput.checked = !!rules.maxConsecutiveDays.enabled;
        consecutiveLimitInput.disabled = !consecutiveEnabledInput.checked;
    },

    async handleStoreSettingsSubmit(event) {
        event.preventDefault();
        const state = store.getState();
        if (!state.activeStoreId) {
            showToast('No hay un local activo para configurar.', 'warning');
            return;
        }

        const submitBtn = el('#btn-save-store-settings');
        const storeName = (el('#store-display-name')?.value || '').trim();
        const consecutiveEnabled = !!el('#rule-max-consecutive-enabled')?.checked;
        const consecutiveLimit = Number(el('#rule-max-consecutive-limit')?.value || 0);

        const schedulingRules = normalizeSchedulingRules({
            maxConsecutiveDays: {
                enabled: consecutiveEnabled,
                limit: consecutiveLimit,
            },
        });

        if (consecutiveEnabled && (!Number.isFinite(consecutiveLimit) || consecutiveLimit < 1)) {
            showToast('Ingresá un límite válido de días consecutivos.', 'warning');
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Guardando...';
            }

            store.setState({
                storeName: storeName || state.activeStoreId,
                schedulingRules,
            });

            await DataManager.saveState();
            showToast('Configuración del local guardada.', 'success');
        } catch (error) {
            console.error('Error guardando configuración del local.', error);
            showToast(error.message || 'No se pudo guardar la configuración.', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Guardar configuración';
            }
        }
    },

    renderAdminStoreOptions() {
        const select = el('#admin-store-select');
        if (!select) return;
        const currentValue = select.value;
        clear(select);

        select.appendChild(create('option', {
            value: '',
            textContent: this.adminStores.length ? 'Seleccioná un local' : 'No hay locales cargados',
            disabled: true,
            attrs: this.adminStores.length ? {} : { selected: 'selected' }
        }));

        this.adminStores.forEach(storeItem => {
            select.appendChild(create('option', {
                value: storeItem.id,
                textContent: `${storeItem.displayName} (${storeItem.id})`,
                attrs: currentValue === storeItem.id ? { selected: 'selected' } : {}
            }));
        });

        if (currentValue && this.adminStores.some(storeItem => storeItem.id === currentValue)) {
            select.value = currentValue;
        }
    },

    syncAdminStoreMode() {
        const mode = el('#admin-store-mode')?.value || 'existing';
        const existingRow = el('#admin-existing-store-row');
        const newRow = el('#admin-new-store-row');
        const storeSelect = el('#admin-store-select');
        const newStoreId = el('#admin-new-store-id');
        const newStoreName = el('#admin-new-store-name');

        if (existingRow) existingRow.style.display = mode === 'existing' ? 'grid' : 'none';
        if (newRow) newRow.style.display = mode === 'new' ? 'grid' : 'none';

        if (storeSelect) storeSelect.disabled = mode !== 'existing';
        if (newStoreId) newStoreId.disabled = mode !== 'new';
        if (newStoreName) newStoreName.disabled = mode !== 'new';
    },

    async handleCreateUser(event) {
        event.preventDefault();
        if (store.getState().currentUser?.role !== 'admin') {
            showToast('Solo administradores pueden crear usuarios.', 'error');
            return;
        }

        const submitBtn = el('#admin-create-user-btn');
        const mode = el('#admin-store-mode')?.value || 'existing';
        const displayName = el('#admin-user-name')?.value || '';
        const email = el('#admin-user-email')?.value || '';
        const password = el('#admin-user-password')?.value || '';
        const role = el('#admin-user-role')?.value || 'manager';
        const storeId = mode === 'new'
            ? (el('#admin-new-store-id')?.value || '')
            : (el('#admin-store-select')?.value || '');
        const storeName = mode === 'new' ? (el('#admin-new-store-name')?.value || '') : '';

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Creando...';
            }

            const result = await AdminService.createUserWithStore({
                displayName,
                email,
                password,
                role,
                storeId,
                createNewStore: mode === 'new',
                storeName,
            });

            showToast(
                result.createdStore
                    ? `Usuario creado y local ${result.storeId} inicializado.`
                    : `Usuario creado para el local ${result.storeId}.`,
                'success'
            );

            el('#admin-create-user-form')?.reset();
            el('#admin-user-role') && (el('#admin-user-role').value = 'manager');
            el('#admin-store-mode') && (el('#admin-store-mode').value = 'existing');
            this.syncAdminStoreMode();
            await this.loadStores();
        } catch (error) {
            console.error('Error creando usuario/local.', error);
            showToast(error.message || 'No se pudo crear el usuario.', 'error', 5000);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Crear usuario';
            }
        }
    }
};
