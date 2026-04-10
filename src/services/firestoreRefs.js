import { getDb } from './firebase.js';

export function storeDoc(storeId) {
  return getDb().collection('stores').doc(storeId);
}

export function storeEmployeesRef(storeId) {
  return storeDoc(storeId).collection('employees');
}

export function storeSchedulesRef(storeId) {
  return storeDoc(storeId).collection('schedules');
}

export function storeWeeksRef(storeId) {
  return storeDoc(storeId).collection('weeks');
}

export function storeSolicitudesRef(storeId) {
  return storeDoc(storeId).collection('solicitudes');
}

export function storeSettingsRef(storeId) {
  return storeDoc(storeId).collection('settings');
}

export function storePresenceRef(storeId) {
  return storeDoc(storeId).collection('presence');
}

// Compatibilidad: referencias legacy centralizadas
export function legacyEmployeesRef() {
  return getDb().collection('employees');
}

export function legacySchedulesRef() {
  return getDb().collection('schedules');
}

export function legacyWeeksRef() {
  return getDb().collection('weeks');
}

export function legacySolicitudesRef() {
  return getDb().collection('solicitudes');
}

export function userDocRef(uid) {
  return getDb().collection('users').doc(uid);
}
