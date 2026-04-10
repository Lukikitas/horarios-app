export function debounce(fn, waitMs = 150) {
    let t = null;
    let lastArgs = null;
    let lastThis = null;

    const debounced = function (...args) {
        lastArgs = args;
        lastThis = this;
        if (t) clearTimeout(t);
        t = setTimeout(() => {
            t = null;
            fn.apply(lastThis, lastArgs);
        }, waitMs);
    };

    debounced.flush = () => {
        if (!t) return;
        clearTimeout(t);
        t = null;
        fn.apply(lastThis, lastArgs || []);
    };

    debounced.cancel = () => {
        if (!t) return;
        clearTimeout(t);
        t = null;
    };

    return debounced;
}

export function rafThrottle(fn) {
    let scheduled = false;
    let lastArgs = null;
    let lastThis = null;

    return function (...args) {
        lastArgs = args;
        lastThis = this;
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            fn.apply(lastThis, lastArgs);
        });
    };
}

