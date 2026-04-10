import { el, create, clear } from '../utils/dom.js';
import { store } from '../store/Store.js';
import { ROLES, setRoles, DEFAULT_ROLES } from '../config.js';
import { DataManager } from '../services/DataManager.js';
import { showToast, showConfirmDialog } from '../utils/feedback.js';
import { AdminService } from '../services/AdminService.js';
import { normalizeSchedulingRules } from '../utils/rules.js';
import { getDb } from '../services/firebase.js';

export const OptionsManager = {
    adminStores: [],
    contacts: [],
    contactsTab: 'pending',
    selectedContactId: null,
    contactsUnsubscribe: null,

    init() {
        const addBtn = el('#btn-add-role');
        const resetBtn = el('#btn-reset-roles');
        addBtn?.addEventListener('click', () => this.handleAddRole());
        resetBtn?.addEventListener('click', () => this.handleReset());
        el('#store-settings-form')?.addEventListener('submit', (event) => this.handleStoreSettingsSubmit(event));
        el('#rule-max-consecutive-enabled')?.addEventListener('change', () => this.renderStoreSettings());
        el('#rule-enforce-rest-time')?.addEventListener('change', () => this.renderStoreSettings());
        el('#admin-create-user-form')?.addEventListener('submit', (event) => this.handleCreateUser(event));
        el('#admin-store-mode')?.addEventListener('change', () => this.syncAdminStoreMode());
        el('#admin-contacts-tab-pending')?.addEventListener('click', () => {
            this.contactsTab = 'pending';
            this.renderContactsAdmin();
        });
        el('#admin-contacts-tab-history')?.addEventListener('click', () => {
            this.contactsTab = 'history';
            this.renderContactsAdmin();
        });
        el('#admin-contact-header-alert')?.addEventListener('click', () => {
            const optionsBtn = el('#btn-view-options');
            if (optionsBtn) optionsBtn.click();
        });
        this.renderRoles();
        this.renderStoreSettings();
        this.renderAdminPanel();
        // Single subscription to avoid triple re-render on every state update.
        store.subscribe(() => {
            this.renderRoles();
            this.renderStoreSettings();
            this.renderAdminPanel();
            this.updateOptionsNotificationBadge();
        });
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
        const contactsWrapper = el('#admin-contact-leads');
        if (!wrapper) return;
        const isAdmin = store.getState().currentUser?.role === 'admin';
        wrapper.style.display = isAdmin ? 'block' : 'none';
        if (contactsWrapper) contactsWrapper.style.display = isAdmin ? 'block' : 'none';
        if (!isAdmin) {
            this.stopContactsListener();
            this.updateOptionsNotificationBadge();
            this.updateAdminHeaderAlert();
            return;
        }
        this.renderAdminStoreOptions();
        this.syncAdminStoreMode();
        this.ensureContactsListener();
        this.renderContactsAdmin();
        this.updateOptionsNotificationBadge();
        this.updateAdminHeaderAlert();
    },

    stopContactsListener() {
        if (this.contactsUnsubscribe) {
            try {
                this.contactsUnsubscribe();
            } catch (error) {
                console.error('No se pudo cerrar listener de contactos.', error);
            }
        }
        this.contactsUnsubscribe = null;
        this.contacts = [];
        this.selectedContactId = null;
    },

    ensureContactsListener() {
        if (this.contactsUnsubscribe) return;
        this.contactsUnsubscribe = getDb()
            .collection('contactLeads')
            .orderBy('createdAt', 'desc')
            .onSnapshot((snapshot) => {
                this.contacts = snapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                }));
                if (!this.contacts.some((item) => item.id === this.selectedContactId)) {
                    this.selectedContactId = this.contacts[0]?.id || null;
                }
                this.renderContactsAdmin();
                this.updateOptionsNotificationBadge();
                this.updateAdminHeaderAlert();
            }, (error) => {
                console.error('Error leyendo contactos comerciales', error);
                showToast('No se pudieron cargar los contactos comerciales.', 'warning');
            });
    },

    getPendingContactsCount() {
        return this.contacts.filter((item) => item.status === 'pending').length;
    },

    updateOptionsNotificationBadge() {
        const btn = el('#btn-view-options');
        const isAdmin = store.getState().currentUser?.role === 'admin';
        if (!btn) return;
        if (!isAdmin) {
            btn.textContent = 'Opciones';
            return;
        }
        const pending = this.getPendingContactsCount();
        btn.innerHTML = pending > 0
            ? `Opciones <span class="inline-alert-pill">${pending}</span>`
            : 'Opciones';
    },

    updateAdminHeaderAlert() {
        const alertBtn = el('#admin-contact-header-alert');
        const isAdmin = store.getState().currentUser?.role === 'admin';
        if (!alertBtn) return;
        if (!isAdmin) {
            alertBtn.style.display = 'none';
            return;
        }
        const pending = this.getPendingContactsCount();
        if (pending > 0) {
            alertBtn.style.display = 'inline-flex';
            alertBtn.textContent = `Contactos pendientes: ${pending}`;
        } else {
            alertBtn.style.display = 'none';
            alertBtn.textContent = 'Contactos pendientes: 0';
        }
    },

    getVisibleContacts() {
        const ordered = [...this.contacts].sort((a, b) => this.getTimestampMs(b.createdAt) - this.getTimestampMs(a.createdAt));
        if (this.contactsTab === 'pending') return ordered.filter((item) => item.status === 'pending');
        return ordered.filter((item) => item.status !== 'pending');
    },

    getTimestampMs(value) {
        if (!value) return 0;
        if (typeof value.toDate === 'function') return value.toDate().getTime();
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    },

    formatDateTime(value) {
        const ms = this.getTimestampMs(value);
        if (!ms) return 'Sin fecha';
        return new Date(ms).toLocaleString('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    renderContactsAdmin() {
        const listEl = el('#admin-contacts-list');
        const detailEl = el('#admin-contacts-detail');
        const pendingBtn = el('#admin-contacts-tab-pending');
        const historyBtn = el('#admin-contacts-tab-history');
        const pill = el('#admin-contacts-pending-pill');
        if (!listEl || !detailEl || !pendingBtn || !historyBtn || !pill) return;

        pendingBtn.classList.toggle('secondary', this.contactsTab !== 'pending');
        historyBtn.classList.toggle('secondary', this.contactsTab !== 'history');
        if (this.contactsTab === 'pending') pendingBtn.classList.remove('secondary');
        if (this.contactsTab === 'history') historyBtn.classList.remove('secondary');
        pill.textContent = `Pendientes: ${this.getPendingContactsCount()}`;

        const visible = this.getVisibleContacts();
        clear(listEl);
        clear(detailEl);

        if (!visible.length) {
            listEl.appendChild(create('p', { className: 'muted', textContent: this.contactsTab === 'pending' ? 'No hay contactos pendientes.' : 'No hay contactos en historial.' }));
            detailEl.appendChild(create('p', { className: 'muted', textContent: 'Seleccioná un contacto para ver el detalle.' }));
            return;
        }

        if (!this.selectedContactId || !visible.some((item) => item.id === this.selectedContactId)) {
            this.selectedContactId = visible[0].id;
        }

        visible.forEach((item) => {
            const card = create('button', {
                className: `admin-contact-card${item.id === this.selectedContactId ? ' selected' : ''}`,
                type: 'button',
                onClick: () => {
                    this.selectedContactId = item.id;
                    this.renderContactsAdmin();
                }
            }, [
                create('div', { className: 'admin-contact-title', textContent: item.name || 'Sin nombre' }),
                create('div', { className: 'muted mini-label', textContent: item.email || 'Sin email' }),
                create('div', { className: 'muted mini-label', textContent: this.formatDateTime(item.createdAt) }),
                create('span', {
                    className: `pill ${item.status === 'pending' ? '' : 'pill-neutral'}`,
                    textContent: item.status === 'pending' ? 'Pendiente' : 'Historial'
                })
            ]);
            listEl.appendChild(card);
        });

        const selected = visible.find((item) => item.id === this.selectedContactId);
        if (!selected) return;

        detailEl.appendChild(create('h4', { textContent: selected.name || 'Sin nombre' }));
        detailEl.appendChild(create('p', { className: 'muted', textContent: selected.email || 'Sin email' }));
        detailEl.appendChild(create('p', { className: 'muted mini-label', textContent: `Recibido: ${this.formatDateTime(selected.createdAt)}` }));
        if (selected.resolvedAt) {
            detailEl.appendChild(create('p', { className: 'muted mini-label', textContent: `Gestionado: ${this.formatDateTime(selected.resolvedAt)}` }));
        }
        detailEl.appendChild(create('div', { className: 'admin-contact-message', textContent: selected.message || 'Sin mensaje' }));

        const actions = create('div', { className: 'row', style: { gap: '8px', marginTop: '12px', flexWrap: 'wrap' } });
        if (selected.status === 'pending') {
            actions.appendChild(create('button', {
                className: 'btn',
                textContent: 'Marcar como gestionado',
                onClick: () => this.markContactResolved(selected.id)
            }));
        } else {
            actions.appendChild(create('button', {
                className: 'btn secondary',
                textContent: 'Volver a pendiente',
                onClick: () => this.markContactPending(selected.id)
            }));
        }
        actions.appendChild(create('button', {
            className: 'btn secondary del',
            textContent: 'Eliminar',
            onClick: () => this.deleteContact(selected.id)
        }));
        detailEl.appendChild(actions);
    },

    async markContactResolved(contactId) {
        try {
            await getDb().collection('contactLeads').doc(contactId).update({
                status: 'resolved',
                resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
                resolvedBy: store.getState().currentUser?.uid || null
            });
            showToast('Contacto enviado al historial.', 'success');
        } catch (error) {
            console.error('No se pudo actualizar contacto', error);
            showToast('No se pudo actualizar el contacto.', 'error');
        }
    },

    async markContactPending(contactId) {
        try {
            await getDb().collection('contactLeads').doc(contactId).update({
                status: 'pending',
                resolvedAt: null,
                resolvedBy: null
            });
            showToast('Contacto movido a pendientes.', 'success');
        } catch (error) {
            console.error('No se pudo actualizar contacto', error);
            showToast('No se pudo actualizar el contacto.', 'error');
        }
    },

    async deleteContact(contactId) {
        const ok = await showConfirmDialog({
            title: 'Eliminar contacto',
            message: 'Esta acción elimina el contacto de forma permanente. ¿Continuar?'
        });
        if (!ok) return;
        try {
            await getDb().collection('contactLeads').doc(contactId).delete();
            showToast('Contacto eliminado.', 'success');
        } catch (error) {
            console.error('No se pudo eliminar contacto', error);
            showToast('No se pudo eliminar el contacto.', 'error');
        }
    },

    renderStoreSettings() {
        const storeNameInput = el('#store-display-name');
        const sanctionsInput = el('#rule-enforce-sanctions');
        const minorInput = el('#rule-enforce-minor-limit');
        const starsInput = el('#rule-enforce-role-star');
        const availabilityInput = el('#rule-enforce-availability');
        const overlapInput = el('#rule-enforce-overlap');
        const restInput = el('#rule-enforce-rest-time');
        const restHoursInput = el('#rule-min-rest-hours');
        const consecutiveEnabledInput = el('#rule-max-consecutive-enabled');
        const consecutiveLimitInput = el('#rule-max-consecutive-limit');
        const periodInput = el('#store-scheduling-period');
        if (!storeNameInput || !consecutiveEnabledInput || !consecutiveLimitInput || !restHoursInput) return;

        const state = store.getState();
        const rules = normalizeSchedulingRules(state.schedulingRules || {});
        const safeStoreName = state.storeName || state.activeStoreId || '';

        if (document.activeElement !== storeNameInput) {
            storeNameInput.value = safeStoreName;
        }
        if (document.activeElement !== consecutiveLimitInput) {
            consecutiveLimitInput.value = String(rules.maxConsecutiveDays.limit);
        }
        if (document.activeElement !== restHoursInput) {
            restHoursInput.value = String(rules.minRestHours);
        }
        if (sanctionsInput) sanctionsInput.checked = !!rules.enforceSanctions;
        if (minorInput) minorInput.checked = !!rules.enforceMinorNightLimit;
        if (starsInput) starsInput.checked = !!rules.enforceRoleStar;
        if (availabilityInput) availabilityInput.checked = !!rules.enforceAvailability;
        if (overlapInput) overlapInput.checked = !!rules.enforceOverlap;
        if (restInput) restInput.checked = !!rules.enforceRestTime;
        consecutiveEnabledInput.checked = !!rules.maxConsecutiveDays.enabled;
        consecutiveLimitInput.disabled = !consecutiveEnabledInput.checked;
        restHoursInput.disabled = !(restInput?.checked);
        if (periodInput) {
            const periodWeeks = [1, 2, 4].includes(Number(state.schedulingPeriodWeeks)) ? Number(state.schedulingPeriodWeeks) : 1;
            periodInput.value = String(periodWeeks);
        }
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
        const enforceSanctions = !!el('#rule-enforce-sanctions')?.checked;
        const enforceMinorNightLimit = !!el('#rule-enforce-minor-limit')?.checked;
        const enforceRoleStar = !!el('#rule-enforce-role-star')?.checked;
        const enforceAvailability = !!el('#rule-enforce-availability')?.checked;
        const enforceOverlap = !!el('#rule-enforce-overlap')?.checked;
        const enforceRestTime = !!el('#rule-enforce-rest-time')?.checked;
        const minRestHours = Number(el('#rule-min-rest-hours')?.value || 0);
        const consecutiveEnabled = !!el('#rule-max-consecutive-enabled')?.checked;
        const consecutiveLimit = Number(el('#rule-max-consecutive-limit')?.value || 0);
        const schedulingPeriodWeeks = Number(el('#store-scheduling-period')?.value || 1);

        const schedulingRules = normalizeSchedulingRules({
            enforceSanctions,
            enforceMinorNightLimit,
            enforceRoleStar,
            enforceAvailability,
            enforceOverlap,
            enforceRestTime,
            minRestHours,
            maxConsecutiveDays: {
                enabled: consecutiveEnabled,
                limit: consecutiveLimit,
            },
        });

        if (consecutiveEnabled && (!Number.isFinite(consecutiveLimit) || consecutiveLimit < 1)) {
            showToast('Ingresá un límite válido de días consecutivos.', 'warning');
            return;
        }
        if (enforceRestTime && (!Number.isFinite(minRestHours) || minRestHours < 1)) {
            showToast('Ingresá una cantidad válida de horas mínimas de descanso.', 'warning');
            return;
        }
        if (![1, 2, 4].includes(schedulingPeriodWeeks)) {
            showToast('Seleccioná una metodología válida (semanal, quincenal o mensual).', 'warning');
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
                schedulingPeriodWeeks,
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
