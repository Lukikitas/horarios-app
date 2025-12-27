import { create } from './dom.js';

let toastContainer = null;
let activeModal = null;

function ensureToastContainer() {
    if (toastContainer) return toastContainer;
    toastContainer = create('div', { className: 'toast-container', id: 'toast-container' });
    document.body.appendChild(toastContainer);
    return toastContainer;
}

function clearActiveModal() {
    if (activeModal) {
        activeModal.remove();
        activeModal = null;
    }
}

export function showToast(message, type = 'info', duration = 4000) {
    if (!message) return;
    const container = ensureToastContainer();
    const toast = create('div', { className: `toast toast-${type}` });
    const text = create('span', { className: 'toast-message', textContent: message });
    const closeBtn = create('button', { className: 'toast-close', textContent: '×', title: 'Cerrar' });

    closeBtn.onclick = () => {
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 150);
    };

    toast.appendChild(text);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.isConnected) {
            toast.classList.add('toast-hide');
            setTimeout(() => toast.remove(), 150);
        }
    }, duration);
}

export function showAlertDialog({ title = 'Aviso', message = '', confirmText = 'Entendido' } = {}) {
    return showDialog({
        title,
        message,
        confirmText,
        cancelText: null
    });
}

export function showConfirmDialog({
    title = 'Confirmar',
    message = '',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar'
} = {}) {
    return showDialog({
        title,
        message,
        confirmText,
        cancelText
    });
}

export function showDialog({ title, message, confirmText, cancelText }) {
    clearActiveModal();

    return new Promise((resolve) => {
        const overlay = create('div', { className: 'modal-overlay feedback-modal' });
        const modal = create('div', { className: 'modal-content feedback-modal-content' });

        const header = create('div', { className: 'feedback-modal-header' });
        header.appendChild(create('h3', { textContent: title || '' }));
        const closeBtn = create('button', { className: 'btn icon-btn', textContent: '×', title: 'Cerrar' });
        closeBtn.onclick = () => {
            cleanup();
            resolve(false);
        };
        header.appendChild(closeBtn);

        const body = create('div', { className: 'feedback-modal-body' });
        body.appendChild(create('p', { innerHTML: message.replace(/\n/g, '<br>') }));

        const footer = create('div', { className: 'feedback-modal-footer' });
        const buttons = [];

        if (cancelText) {
            const cancelBtn = create('button', { className: 'btn secondary', textContent: cancelText });
            cancelBtn.onclick = () => {
                cleanup();
                resolve(false);
            };
            buttons.push(cancelBtn);
        }

        const confirmBtn = create('button', { className: 'btn', textContent: confirmText || 'Aceptar' });
        confirmBtn.onclick = () => {
            confirmBtn.disabled = true;
            buttons.forEach(b => b.disabled = true);
            confirmBtn.textContent = 'Confirmando...';
            setTimeout(() => {
                cleanup();
                resolve(true);
            }, 150);
        };
        buttons.push(confirmBtn);

        buttons.forEach(btn => footer.appendChild(btn));

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && cancelText) {
                cleanup();
                resolve(false);
            }
        });

        const cleanup = () => {
            if (overlay && overlay.isConnected) overlay.remove();
            activeModal = null;
        };

        activeModal = overlay;
        document.body.appendChild(overlay);
    });
}
