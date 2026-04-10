export function el(selector) {
    return document.querySelector(selector);
}

export function create(tag, options = {}, children = []) {
    const element = document.createElement(tag);

    if (options.className) element.className = options.className;
    if (options.id) element.id = options.id;
    if (options.textContent) element.textContent = options.textContent;
    if (options.innerHTML) element.innerHTML = options.innerHTML; // Still useful for trusted content
    if (options.style) Object.assign(element.style, options.style);

    // Event listeners
    if (options.onClick) element.addEventListener('click', options.onClick);
    if (options.onChange) element.addEventListener('change', options.onChange);
    if (options.onInput) element.addEventListener('input', options.onInput);
    if (options.onMouseDown) element.addEventListener('mousedown', options.onMouseDown);
    if (options.onMouseEnter) element.addEventListener('mouseenter', options.onMouseEnter);
    if (options.onMouseUp) element.addEventListener('mouseup', options.onMouseUp);

    // Dataset
    if (options.dataset) {
        Object.entries(options.dataset).forEach(([key, value]) => {
            element.dataset[key] = value;
        });
    }

    // Attributes
    if (options.attrs) {
        Object.entries(options.attrs).forEach(([key, value]) => {
            if (value === null || value === false) {
                element.removeAttribute(key);
            } else {
                element.setAttribute(key, value);
            }
        });
    }

    // Other properties (value, type, checked, etc.)
    ['value', 'type', 'checked', 'placeholder', 'title', 'disabled', 'draggable', 'colSpan', 'rowSpan'].forEach(prop => {
        if (options[prop] !== undefined) element[prop] = options[prop];
    });

    // Children
    children.forEach(child => {
        if (child instanceof Node) {
            element.appendChild(child);
        } else if (typeof child === 'string' || typeof child === 'number') {
            element.appendChild(document.createTextNode(child));
        } else if (child) {
             // Null/undefined checks
        }
    });

    return element;
}

export function clear(element) {
    if (typeof element === 'string') element = el(element);
    if (element) element.innerHTML = '';
}
