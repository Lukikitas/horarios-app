import { SLOTS } from '../config.js';
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
