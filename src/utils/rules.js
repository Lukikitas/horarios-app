import { SLOTS, MAX_SLOT_FOR_MINOR, DEFAULT_SCHEDULING_RULES } from '../config.js';
import { toISODateString, getMonday } from '../utils/date.js';
import { store, getActiveSchedule } from '../store/Store.js';

export function timeToSlotIndex(timeLabel) {
    if (!timeLabel) return -1;
    return SLOTS.findIndex(s => s.label === timeLabel);
}

// Helper to get schedule for a date
function getScheduleForDate(d) {
    const monday = getMonday(d);
    const weekKey = toISODateString(monday);
    const dayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const weekSchedule = store.getState().schedules[weekKey] || {};
    return weekSchedule[dayIndex] || [];
}

export function checkRestTime(employeeId, newShift, weekId, dayIndex) {
    const twelveHoursInSlots = 24;

    const todayDate = new Date(`${weekId}T12:00:00.000Z`);
    todayDate.setUTCDate(todayDate.getUTCDate() + dayIndex);

    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setUTCDate(todayDate.getUTCDate() - 1);

    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setUTCDate(todayDate.getUTCDate() + 1);

    // Check against shifts from yesterday
    const shiftsYesterday = getScheduleForDate(yesterdayDate).filter(s => s.employeeId === employeeId);
    if (shiftsYesterday.length > 0) {
        const lastShiftYesterday = shiftsYesterday.reduce((latest, s) => s.endSlot > latest.endSlot ? s : latest);
        const slotsBetween = (48 - (lastShiftYesterday.endSlot + 1)) + newShift.startSlot;
        if (slotsBetween < twelveHoursInSlots) {
            return { pass: false, message: "No se cumplen las 12hs de descanso con el turno del día anterior." };
        }
    }

    // Check against shifts from tomorrow
    const shiftsTomorrow = getScheduleForDate(tomorrowDate).filter(s => s.employeeId === employeeId);
    if (shiftsTomorrow.length > 0) {
        const firstShiftTomorrow = shiftsTomorrow.reduce((earliest, s) => s.startSlot < earliest.startSlot ? s : earliest);
        const slotsBetween = (48 - (newShift.endSlot + 1)) + firstShiftTomorrow.startSlot;
        if (slotsBetween < twelveHoursInSlots) {
            return { pass: false, message: "No se cumplen las 12hs de descanso con el turno del día siguiente." };
        }
    }

    return { pass: true, message: "" };
}

export function checkShiftOverlap(employeeId, newShift, dayIndex, shiftsToIgnore = []) {
    const schedule = getActiveSchedule();
    const dayShifts = schedule[dayIndex] || [];
    const employeeShiftsOnDay = dayShifts.filter(s =>
        s.employeeId === employeeId && !shiftsToIgnore.includes(s.id)
    );

    const hasConflict = employeeShiftsOnDay.some(
        existingShift => existingShift.id !== newShift.id
    );

    if (hasConflict) {
        return { pass: false, message: `El empleado ya tiene un turno asignado para este día.` };
    }

    return { pass: true, message: "" };
}

export function isDateInSanctionPeriod(date, sanctions) {
    if (!sanctions || sanctions.length === 0) {
        return false;
    }
    const dateString = toISODateString(date);
    for (const sanction of sanctions) {
        if (sanction.startDate && sanction.endDate) {
            if (dateString >= sanction.startDate && dateString <= sanction.endDate) {
                return true;
            }
        }
    }
    return false;
}

export function checkEmployeeAvailability(employee, shift, weekId, dayIndex) {
    if (!employee.availability || Array.isArray(employee.availability) || !employee.exceptions || !Array.isArray(employee.exceptions)) {
        return { isAvailable: true, reason: '' };
    }

    const shiftDate = new Date(`${weekId}T12:00:00.000Z`);
    shiftDate.setUTCDate(shiftDate.getUTCDate() + dayIndex);
    const shiftDateString = toISODateString(shiftDate).slice(0, 10);

    // 1. Exceptions
    const exception = employee.exceptions.find(ex => ex.date === shiftDateString);
    if (exception) {
        if (!exception.start && !exception.end) {
            return { isAvailable: false, reason: `${employee.name} tiene el día libre por una excepción.` };
        }
        const exceptionStartSlot = timeToSlotIndex(exception.start);
        const exceptionEndSlot = timeToSlotIndex(exception.end);
        if (exceptionStartSlot !== -1 && exceptionEndSlot !== -1) {
            if (shift.startSlot < exceptionEndSlot && shift.endSlot >= exceptionStartSlot) {
                 return { isAvailable: false, reason: `${employee.name} no está disponible en este horario por una excepción.` };
            }
        }
    }

    // 2. Weekly Availability
    const dayAvailabilitySlots = employee.availability[dayIndex];
    if (!dayAvailabilitySlots || dayAvailabilitySlots.length === 0) {
        return { isAvailable: true, reason: '' };
    }

    let isAvailableInAnySlot = false;
    for (const slot of dayAvailabilitySlots) {
        const availableStartSlot = slot.start ? timeToSlotIndex(slot.start) : 0;
        const availableEndSlot = slot.end ? timeToSlotIndex(slot.end) - 1 : SLOTS.length - 1;

        if (availableStartSlot === -1) continue;

        if (shift.startSlot >= availableStartSlot && shift.endSlot <= availableEndSlot) {
            isAvailableInAnySlot = true;
            break;
        }
    }

    if (isAvailableInAnySlot) {
        return { isAvailable: true, reason: '' };
    } else {
        const availableRanges = dayAvailabilitySlots.map(s => `${s.start || 'Apertura'} a ${s.end || 'Cierre'}`).join(', ');
        return { isAvailable: false, reason: `El horario del turno no coincide con la disponibilidad de ${employee.name} para este día: ${availableRanges}.` };
    }
}

export function calculateConsecutiveWorkDays(employeeId, weekId, dayIndex) {
    const isWorkingOn = (date) => {
        const dayOfWeek = date.getDay() === 0 ? 6 : date.getDay() - 1;
        const weekKey = toISODateString(getMonday(date));
        const scheduleForDay = store.getState().schedules[weekKey] || {};
        const dayShifts = scheduleForDay[dayOfWeek] || [];
        return dayShifts.some(s => s.employeeId === employeeId);
    };

    let consecutiveDays = 1;
    const baseDate = new Date(`${weekId}T12:00:00.000Z`);
    baseDate.setUTCDate(baseDate.getUTCDate() + dayIndex);

    const yesterday = new Date(baseDate);
    for (let i = 0; i < 14; i++) {
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        if (isWorkingOn(new Date(yesterday))) {
            consecutiveDays++;
        } else {
            break;
        }
    }

    const tomorrow = new Date(baseDate);
    for (let i = 0; i < 14; i++) {
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        if (isWorkingOn(new Date(tomorrow))) {
            consecutiveDays++;
        } else {
            break;
        }
    }
    return consecutiveDays;
}

export function normalizeSchedulingRules(rules = {}) {
    const defaultLimit = DEFAULT_SCHEDULING_RULES.maxConsecutiveDays.limit;
    const rawLimit = Number(rules?.maxConsecutiveDays?.limit);
    return {
        maxConsecutiveDays: {
            enabled: rules?.maxConsecutiveDays?.enabled !== false,
            limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : defaultLimit,
        },
    };
}

export function getSchedulingRules() {
    return normalizeSchedulingRules(store.getState().schedulingRules || {});
}

export function isSlotUnavailable(employee, slotIndex, weekId, dayIndex) {
    if (!employee) return false;

    const minorCutoff = SLOTS.findIndex((s) => s.label === '20:00');
    const minorRestrictionSlot = minorCutoff !== -1 ? minorCutoff : MAX_SLOT_FOR_MINOR + 1;

    const normalizeSlotIndex = (timeValue, indexValue, isEnd = false) => {
        if (typeof timeValue === 'number') return isEnd ? timeValue + 1 : timeValue;
        if (typeof indexValue === 'number') return isEnd ? indexValue + 1 : indexValue;

        if (typeof timeValue === 'string') {
            const trimmed = timeValue.trim().substring(0, 5);
            const padded = trimmed.length === 4 ? `0${trimmed}` : trimmed;
            const idx = timeToSlotIndex(padded);
            if (idx !== -1) return idx;
        }

        return -1;
    };

    const shiftDate = new Date(`${weekId}T12:00:00.000Z`);
    shiftDate.setUTCDate(shiftDate.getUTCDate() + dayIndex);
    const shiftDateString = toISODateString(shiftDate).slice(0, 10);

    // 1. Underage restriction (night hours)
    if (employee.isMinor && slotIndex >= minorRestrictionSlot) return true;

    // 2. Sanctions (Blocking)
    if (isDateInSanctionPeriod(shiftDate, employee.sanctions)) return true;

    // 3. Exceptions
    if (employee.exceptions && Array.isArray(employee.exceptions)) {
        const exception = employee.exceptions.find(ex => ex.date === shiftDateString);
        if (exception) {
            // Full day exception
            if (!exception.start && !exception.end) return true;

            // Partial exception: Unavailable during this range
            const exStart = normalizeSlotIndex(exception.start, exception.startSlot);
            const exEnd = normalizeSlotIndex(exception.end, exception.endSlot, true);

            const startIdx = exStart === -1 ? 0 : exStart;
            const endIdx = exEnd === -1 ? SLOTS.length : exEnd;

            if (slotIndex >= startIdx && slotIndex < endIdx) return true;
        }
    }

    // 4. Weekly Availability
    // If defined, slot must be inside at least one range to be AVAILABLE.
    const rawAvailability = employee.availability || {};
    const daySlots = Array.isArray(rawAvailability)
        ? rawAvailability[dayIndex]
        : rawAvailability?.[dayIndex] || rawAvailability?.[String(dayIndex)];

    if (daySlots && daySlots.length > 0) {
        let isCovered = false;
        for (const range of daySlots) {
            const rStart = normalizeSlotIndex(range?.start, range?.startSlot);
            const rEnd = normalizeSlotIndex(range?.end, range?.endSlot, true) ?? SLOTS.length;

            if (rStart === -1 && rEnd === -1) continue;

            const startIdx = rStart === -1 ? 0 : rStart;
            const endIdx = rEnd === -1 ? SLOTS.length : rEnd;

            if (slotIndex >= startIdx && slotIndex < endIdx) {
                isCovered = true;
                break;
            }
        }
        if (!isCovered) return true; // Unavailable if not covered
    }

    return false;
}
