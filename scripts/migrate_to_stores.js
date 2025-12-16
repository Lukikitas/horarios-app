#!/usr/bin/env node
const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const storeArg = args.find(a => a.startsWith('--store='));
const execute = args.includes('--execute');
const dryRun = args.includes('--dry-run');

if (!storeArg) {
  console.error('Uso: node scripts/migrate_to_stores.js --store=<storeId> [--dry-run|--execute]');
  process.exit(1);
}

const storeId = storeArg.split('=')[1];
if (!storeId) {
  console.error('Debe indicar --store=<storeId>');
  process.exit(1);
}

const credentialPath = path.resolve(__dirname, '..', 'horarios-data-firebase-adminsdk-qg20g-a3c1b68991.json');
admin.initializeApp({
  credential: admin.credential.cert(require(credentialPath))
});

const db = admin.firestore();

async function copyCollection(src, dest) {
  const snap = await src.get();
  console.log(`Encontrados ${snap.size} documentos en ${src.path}`);
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(doc => {
    const target = dest.doc(doc.id);
    batch.set(target, doc.data(), { merge: true });
  });
  if (execute) {
    await batch.commit();
    console.log(`Copiados ${snap.size} documentos a ${dest.path}`);
  } else {
    console.log(`[DRY RUN] Se copiarían ${snap.size} documentos a ${dest.path}`);
  }
}

async function run() {
  console.log(`Migrando datos legacy a stores/${storeId}`);
  if (dryRun && execute) {
    console.warn('Seleccione solo uno: --dry-run o --execute');
    process.exit(1);
  }
  if (!dryRun && !execute) {
    console.log('Modo predeterminado: solo lectura (dry-run). Use --execute para escribir.');
  }

  const employeesSrc = db.collection('employees');
  const employeesDest = db.collection('stores').doc(storeId).collection('employees');
  const schedulesSrc = db.collection('schedules').doc('main');
  const schedulesDest = db.collection('stores').doc(storeId).collection('schedules').doc('main');
  const weeksSrc = db.collection('weeks');
  const weeksDest = db.collection('stores').doc(storeId).collection('weeks');
  const solicitudesSrc = db.collection('solicitudes');
  const solicitudesDest = db.collection('stores').doc(storeId).collection('solicitudes');

  await copyCollection(employeesSrc, employeesDest);
  const schedulesSnap = await schedulesSrc.get();
  if (schedulesSnap.exists) {
    if (execute) {
      await schedulesDest.set(schedulesSnap.data(), { merge: true });
      console.log('Copiada configuración main a store.');
    } else {
      console.log('[DRY RUN] Se copiaría schedules/main a store.');
    }
  }
  await copyCollection(weeksSrc, weeksDest);
  await copyCollection(solicitudesSrc, solicitudesDest);

  console.log('Migración finalizada.');
}

run().catch((err) => {
  console.error('Error en migración:', err);
  process.exit(1);
});
