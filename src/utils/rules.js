import { SLOTS } from '../config.js';
import { toISODateString } from '../utils/date.js';

export function timeToSlotIndex(timeLabel) {
    if (!timeLabel) return -1;
    return SLOTS.findIndex(s => s.label === timeLabel);
}

// We need date helpers. I'll put them in a separate file or here if small.
// Let's put them in `src/utils/date.js`
