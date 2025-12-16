import { firebaseConfig } from '../config.js';

let app = null;
let firestore = null;
let auth = null;

export function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK no cargado.');
    return null;
  }
  if (!app) {
    app = firebase.initializeApp(firebaseConfig);
  }
  if (!firestore) firestore = firebase.firestore();
  if (!auth) auth = firebase.auth();
  return app;
}

export function getAuth() {
  if (!auth) initFirebase();
  return auth;
}

export function getDb() {
  if (!firestore) initFirebase();
  return firestore;
}

export function getFirebaseApp() {
  if (!app) initFirebase();
  return app;
}
