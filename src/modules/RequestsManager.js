/*
 * Solicitudes - Estructura de UI
 * ---------------------------------
 * - Encabezado (Filtros + búsqueda + orden documental)
 * - Listado (tarjetas resumidas con acciones rápidas)
 * - Panel de detalle (datos completos + historial mínimo)
 * - Modales (aprobar/rechazar con confirmaciones seguras)
 *
 * Notas de datos:
 * - Se consulta la colección `solicitudes` ordenada por `fechaCreacion` desc
 *   y se limita a MAX_REQUESTS (200) para evitar lecturas excesivas.
 * - El orden visual prioriza `pendiente_aprobacion` y luego respeta
 *   `fechaCreacion` descendente (ver sortRequests).
 * - Filtros de fecha aplican sobre `fechaSolicitada` (asumimos string YYYY-MM-DD).
 *   Si falta, se omite del filtro.
 */

import { el, create, clear } from '../utils/dom.js';
import { getDb } from '../services/DataManager.js';
import { store } from '../store/Store.js';

const MAX_REQUESTS = 200; // límite de carga para evitar traer toda la colección

const STATUS_LABELS = {
    pendiente_aprobacion: 'Pendiente',
    aprobada: 'Aprobada',
    rechazada: 'Rechazada'
};

export const RequestsManager = {
    state: {
        requests: [],
        selectedId: null,
        loading: false,
        error: null,
        filters: {
            search: '',
            status: 'all',
            type: 'all',
            dateFrom: '',
            dateTo: ''
        },
        savingAction: false,
        actionError: ''
    },
    unsubscribe: null,

    init() {
        this.cacheElements();
        this.bindFilters();
        this.bindModals();

        document.addEventListener('view-changed', (e) => {
            if (e.detail.view === 'requests') {
                this.ensureListener();
            }
        });

        if (store.getState().activeView === 'requests') {
            this.ensureListener();
        }
    },

    cacheElements() {
        this.listEl = el('#requests-list');
        this.detailEl = el('#requests-detail');
        this.layoutEl = el('#requests-layout');
        this.searchInput = el('#requests-search');
        this.statusFilter = el('#requests-status-filter');
        this.typeFilter = el('#requests-type-filter');
        this.dateFrom = el('#requests-date-from');
        this.dateTo = el('#requests-date-to');

        this.approveModal = el('#request-approve-modal');
        this.rejectModal = el('#request-reject-modal');
        this.deleteModal = el('#request-delete-modal');
        this.rejectReason = el('#reject-reason');
    },

    ensureListener() {
        if (this.unsubscribe) return;
        const db = getDb();
        if (!db) return;

        this.state.loading = true;
        this.render();

        // Consulta ordenada por fecha de creación desc y limitada.
        this.unsubscribe = db.collection('solicitudes')
            .orderBy('fechaCreacion', 'desc')
            .limit(MAX_REQUESTS)
            .onSnapshot(
                (snapshot) => {
                    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    this.state.requests = data;
                    if (!this.state.selectedId && data.length > 0) {
                        this.state.selectedId = data[0].id;
                    }
                    this.state.loading = false;
                    this.render();
                },
                (error) => {
                    console.error('Error en listener de solicitudes', error);
                    this.state.error = 'No se pudieron cargar las solicitudes.';
                    this.state.loading = false;
                    this.render();
                }
            );
    },

    bindFilters() {
        const updateFilter = (key, value) => {
            this.state.filters = { ...this.state.filters, [key]: value };
            this.render();
        };

        this.searchInput?.addEventListener('input', (e) => updateFilter('search', e.target.value.toLowerCase()));
        this.statusFilter?.addEventListener('change', (e) => updateFilter('status', e.target.value));
        this.typeFilter?.addEventListener('change', (e) => updateFilter('type', e.target.value));
        this.dateFrom?.addEventListener('change', (e) => updateFilter('dateFrom', e.target.value));
        this.dateTo?.addEventListener('change', (e) => updateFilter('dateTo', e.target.value));
    },

    bindModals() {
        el('#confirm-approve-modal')?.addEventListener('click', () => this.confirmApprove());
        el('#confirm-reject-modal')?.addEventListener('click', () => this.confirmReject());

        ['cancel-approve-modal', 'close-approve-modal'].forEach(id => {
            el(`#${id}`)?.addEventListener('click', () => {
                this.pendingActionId = null;
                this.toggleModal(this.approveModal, false);
            });
        });
        ['cancel-reject-modal', 'close-reject-modal'].forEach(id => {
            el(`#${id}`)?.addEventListener('click', () => {
                this.pendingActionId = null;
                this.toggleModal(this.rejectModal, false);
            });
        });

        ['cancel-delete-modal', 'close-delete-modal'].forEach(id => {
            el(`#${id}`)?.addEventListener('click', () => {
                this.pendingActionId = null;
                this.toggleModal(this.deleteModal, false);
            });
        });
        el('#confirm-delete-modal')?.addEventListener('click', () => this.confirmDelete());
    },

    toggleModal(modal, show) {
        if (!modal) return;
        modal.style.display = show ? 'flex' : 'none';
    },

    applyFilters() {
        const { search, status, type, dateFrom, dateTo } = this.state.filters;
        return this.state.requests.filter((req) => {
            const haystack = `${req.nombre || ''} ${(req.motivo || '')} ${(req.tipo || '')}`.toLowerCase();
            if (search && !haystack.includes(search)) return false;

            if (status !== 'all' && req.estado !== status) return false;

            const isDisponibilidad = req.tipo === 'cambio_disponibilidad';
            if (type === 'licencia' && isDisponibilidad) return false;
            if (type === 'disponibilidad' && !isDisponibilidad) return false;

            // Filtro de fechas sobre fechaSolicitada (YYYY-MM-DD) si existe.
            if (dateFrom && req.fechaSolicitada && req.fechaSolicitada < dateFrom) return false;
            if (dateTo && req.fechaSolicitada && req.fechaSolicitada > dateTo) return false;

            return true;
        });
    },

    sortRequests(list) {
        // Criterio visual: pendientes primero, luego fechaCreacion desc.
        return [...list].sort((a, b) => {
            const isPendingA = a.estado === 'pendiente_aprobacion';
            const isPendingB = b.estado === 'pendiente_aprobacion';
            if (isPendingA !== isPendingB) return isPendingA ? -1 : 1;

            const dateA = this.toDate(a.fechaCreacion);
            const dateB = this.toDate(b.fechaCreacion);
            return (dateB || 0) - (dateA || 0);
        });
    },

    render() {
        if (!this.listEl || !this.detailEl) return;
        const filtered = this.applyFilters();
        const ordered = this.sortRequests(filtered);

        clear(this.listEl);
        clear(this.detailEl);

        if (this.state.error) {
            this.listEl.appendChild(create('p', { className: 'danger', textContent: this.state.error }));
            return;
        }

        if (this.state.actionError) {
            this.listEl.appendChild(create('p', { className: 'danger', textContent: this.state.actionError }));
        }

        if (this.state.loading) {
            this.listEl.appendChild(create('p', { textContent: 'Cargando solicitudes...' }));
            return;
        }

        if (ordered.length === 0) {
            this.listEl.appendChild(create('div', { className: 'requests-empty', textContent: 'No hay solicitudes para los filtros seleccionados.' }));
            return;
        }

        ordered.forEach((req) => {
            this.listEl.appendChild(this.renderCard(req));
        });

        const selected = ordered.find((r) => r.id === this.state.selectedId) || ordered[0];
        if (selected) {
            this.state.selectedId = selected.id;
            this.renderDetail(selected);
        }
    },

    renderCard(req) {
        const isPending = req.estado === 'pendiente_aprobacion';
        const isSelected = req.id === this.state.selectedId;
        const card = create('div', { className: `request-card ${isSelected ? 'selected' : ''}` });

        const header = create('div', { className: 'request-summary' });
        header.appendChild(create('div', { className: 'request-title', textContent: `${req.nombre || 'Sin nombre'} · ${req.tipo || ''}` }));
        header.appendChild(create('div', { className: 'request-subtitle', textContent: this.buildDateLabel(req) }));
        header.appendChild(create('div', { className: 'request-subtitle', textContent: this.truncate(req.motivo, 100) }));

        const meta = create('div', { className: 'request-meta' });
        meta.appendChild(this.statusPill(req.estado));
        meta.appendChild(create('span', { className: `request-type ${req.tipo === 'cambio_disponibilidad' ? 'availability' : ''}`, textContent: req.tipo === 'cambio_disponibilidad' ? 'Disponibilidad' : 'Licencia' }));
        const created = this.formatDate(this.toDate(req.fechaCreacion));
        if (created) meta.appendChild(create('span', { className: 'pill', textContent: `Creada: ${created}` }));
        header.appendChild(meta);

        const actions = create('div', { className: 'request-actions' });
        if (isPending) {
            actions.appendChild(create('button', {
                className: 'btn secondary',
                textContent: 'Rechazar',
                disabled: this.state.savingAction,
                onClick: (e) => {
                    e.stopPropagation();
                    this.openReject(req.id);
                }
            }));
            actions.appendChild(create('button', {
                className: 'btn',
                textContent: 'Aprobar',
                disabled: this.state.savingAction,
                onClick: (e) => {
                    e.stopPropagation();
                    this.openApprove(req.id);
                }
            }));
        }

        card.appendChild(header);
        card.appendChild(actions);
        card.addEventListener('click', () => {
            this.state.selectedId = req.id;
            this.render();
            if (this.layoutEl && window.innerWidth <= 980) {
                this.layoutEl.classList.add('mobile-detail-open');
            }
        });

        return card;
    },

    renderDetail(req) {
        clear(this.detailEl);
        if (this.layoutEl && window.innerWidth <= 980) {
            this.detailEl.appendChild(create('button', {
                className: 'btn secondary mobile-back',
                textContent: '← Volver al listado',
                onClick: () => {
                    this.layoutEl.classList.remove('mobile-detail-open');
                }
            }));
        }

        const header = create('div', { className: 'requests-detail-header' });
        header.appendChild(create('h3', { textContent: req.nombre || 'Sin nombre' }));
        header.appendChild(this.statusPill(req.estado));
        const created = this.formatDate(this.toDate(req.fechaCreacion));
        if (created) header.appendChild(create('span', { className: 'pill', textContent: `Creada: ${created}` }));
        header.appendChild(create('span', { className: `request-type ${req.tipo === 'cambio_disponibilidad' ? 'availability' : ''}`, textContent: req.tipo === 'cambio_disponibilidad' ? 'Cambio de disponibilidad' : req.tipo || 'Licencia' }));
        this.detailEl.appendChild(header);

        const grid = create('div', { className: 'requests-detail-grid' });

        const empleadoBlock = create('div', { className: 'detail-block' });
        empleadoBlock.appendChild(create('h4', { textContent: 'Empleado' }));
        empleadoBlock.appendChild(this.detailRow('Nombre', req.nombre || '—'));
        empleadoBlock.appendChild(this.detailRow('UID', req.empleadoUid || req.empleadoId || '—', req.empleadoUid || req.empleadoId));
        empleadoBlock.appendChild(this.detailRow('Celular', req.celular || '—', req.celular));
        grid.appendChild(empleadoBlock);

        const infoBlock = create('div', { className: 'detail-block' });
        infoBlock.appendChild(create('h4', { textContent: 'Detalles' }));
        infoBlock.appendChild(this.detailRow('Estado', STATUS_LABELS[req.estado] || req.estado));
        infoBlock.appendChild(this.detailRow('Fecha solicitada', req.fechaSolicitada || '—'));
        const horarioLabel = req.start && req.end ? `${req.start} - ${req.end}` : 'Día completo';
        if (req.tipo !== 'cambio_disponibilidad') {
            infoBlock.appendChild(this.detailRow('Horario', horarioLabel));
        }
        grid.appendChild(infoBlock);

        const motivoBlock = create('div', { className: 'detail-block' });
        motivoBlock.appendChild(create('h4', { textContent: 'Motivo' }));
        motivoBlock.appendChild(create('p', { textContent: req.motivo || 'Sin motivo' }));
        grid.appendChild(motivoBlock);

        if (req.tipo === 'cambio_disponibilidad') {
            const dispoBlock = create('div', { className: 'detail-block' });
            dispoBlock.appendChild(create('h4', { textContent: 'Cambio de disponibilidad' }));
            dispoBlock.appendChild(this.detailRow('Día', req.diaNombre ? `${req.diaNombre} (${req.diaIndex})` : req.diaIndex ?? '—'));
            if (req.nuevaDispo) {
                dispoBlock.appendChild(create('p', { className: 'pill', textContent: req.nuevaDispo }));
            }
            grid.appendChild(dispoBlock);
        }

        if (req.motivoRechazo) {
            const rechazoBlock = create('div', { className: 'detail-block' });
            rechazoBlock.appendChild(create('h4', { textContent: 'Motivo de rechazo' }));
            rechazoBlock.appendChild(create('p', { textContent: req.motivoRechazo }));
            grid.appendChild(rechazoBlock);
        }

        const history = this.buildHistory(req);
        if (history.length > 0) {
            const historyBlock = create('div', { className: 'detail-block' });
            historyBlock.appendChild(create('h4', { textContent: 'Historial' }));
            history.forEach(item => historyBlock.appendChild(create('div', { className: 'detail-row', textContent: `${item.label}: ${item.value}` })));
            grid.appendChild(historyBlock);
        }

        if (req.tipo !== 'cambio_disponibilidad' && req.estado !== 'pendiente_aprobacion') {
            const deleteBlock = create('div', { className: 'detail-block danger-block' });
            deleteBlock.appendChild(create('h4', { textContent: 'Licencia en historial' }));
            deleteBlock.appendChild(create('p', { className: 'muted', textContent: 'Podés borrar la licencia del historial si fue cargada por error.' }));
            deleteBlock.appendChild(create('button', {
                className: 'btn danger',
                textContent: 'Eliminar licencia',
                disabled: this.state.savingAction,
                onClick: () => this.openDelete(req.id)
            }));
            grid.appendChild(deleteBlock);
        }

        this.detailEl.appendChild(grid);
    },

    detailRow(label, value, copyValue) {
        const row = create('div', { className: 'detail-row' });
        row.appendChild(create('span', { textContent: label }));
        const right = create('div', { className: 'row', style: { gap: '6px' } });
        right.appendChild(create('strong', { textContent: value || '—' }));
        if (copyValue) {
            right.appendChild(create('button', {
                className: 'copy-btn',
                textContent: 'Copiar',
                onClick: () => navigator.clipboard?.writeText(copyValue)
            }));
        }
        row.appendChild(right);
        return row;
    },

    statusPill(status) {
        const classMap = {
            pendiente_aprobacion: 'status-chip pending',
            aprobada: 'status-chip approved',
            rechazada: 'status-chip rejected'
        };
        return create('span', { className: classMap[status] || 'status-chip', textContent: STATUS_LABELS[status] || status || '—' });
    },

    buildDateLabel(req) {
        const fecha = req.fechaSolicitada ? `Fecha: ${req.fechaSolicitada}` : 'Sin fecha';
        if (req.tipo === 'cambio_disponibilidad') return `${fecha}`;
        const horario = req.start && req.end ? `${req.start} - ${req.end}` : 'Día completo';
        return `${fecha} · ${horario}`;
    },

    truncate(text, max) {
        if (!text) return '';
        return text.length > max ? `${text.slice(0, max)}…` : text;
    },

    toDate(field) {
        if (!field) return null;
        if (typeof field.toDate === 'function') return field.toDate();
        const d = new Date(field);
        return Number.isNaN(d.getTime()) ? null : d;
    },

    formatDate(date) {
        if (!date) return '';
        return date.toLocaleDateString('es-AR');
    },

    buildHistory(req) {
        const items = [];
        const created = this.toDate(req.fechaCreacion);
        if (created) items.push({ label: 'Creada', value: this.formatDate(created) });
        if (req.estado && req.estado !== 'pendiente_aprobacion') {
            const resolved = req.fechaResolucion ? this.toDate(req.fechaResolucion) : created;
            if (resolved) items.push({ label: 'Resuelta', value: this.formatDate(resolved) });
        }
        return items;
    },

    openApprove(id) {
        this.pendingActionId = id;
        this.toggleModal(this.approveModal, true);
    },

    openReject(id) {
        this.pendingActionId = id;
        this.rejectReason.value = '';
        this.toggleModal(this.rejectModal, true);
    },

    openDelete(id) {
        this.pendingActionId = id;
        this.toggleModal(this.deleteModal, true);
    },

    async confirmApprove() {
        if (!this.pendingActionId) return;
        this.state.savingAction = true;
        this.state.actionError = '';
        this.render();
        try {
            await getDb().collection('solicitudes').doc(this.pendingActionId).update({ estado: 'aprobada', motivoRechazo: null });
            this.toggleModal(this.approveModal, false);
            this.pendingActionId = null;
        } catch (error) {
            console.error('Error al aprobar', error);
            this.state.actionError = 'No se pudo aprobar la solicitud.';
        } finally {
            this.state.savingAction = false;
            this.render();
        }
    },

    async confirmReject() {
        if (!this.pendingActionId) return;
        const reason = this.rejectReason.value?.trim();
        if (!reason) {
            this.rejectReason.focus();
            return;
        }
        this.state.savingAction = true;
        this.state.actionError = '';
        this.render();
        try {
            await getDb().collection('solicitudes').doc(this.pendingActionId).update({
                estado: 'rechazada',
                motivoRechazo: reason
            });
            this.toggleModal(this.rejectModal, false);
            this.pendingActionId = null;
        } catch (error) {
            console.error('Error al rechazar', error);
            this.state.actionError = 'No se pudo rechazar la solicitud.';
        } finally {
            this.state.savingAction = false;
            this.render();
        }
    },

    async confirmDelete() {
        if (!this.pendingActionId) return;
        const target = this.state.requests.find((r) => r.id === this.pendingActionId);
        if (!target || target.tipo === 'cambio_disponibilidad') {
            this.state.actionError = 'Solo se pueden borrar licencias.';
            this.render();
            return;
        }
        this.state.savingAction = true;
        this.state.actionError = '';
        this.render();
        try {
            await getDb().collection('solicitudes').doc(this.pendingActionId).delete();
            this.toggleModal(this.deleteModal, false);
            this.state.requests = this.state.requests.filter((r) => r.id !== this.pendingActionId);
            if (this.state.selectedId === this.pendingActionId) {
                this.state.selectedId = this.state.requests[0]?.id || null;
            }
            this.pendingActionId = null;
        } catch (error) {
            console.error('Error al eliminar licencia', error);
            this.state.actionError = 'No se pudo eliminar la licencia.';
        } finally {
            this.state.savingAction = false;
            this.render();
        }
    }
};
