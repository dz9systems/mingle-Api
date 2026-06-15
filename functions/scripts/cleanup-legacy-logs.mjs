/**
 * Delete deprecated smsLog and emailLog collections after migrating to messageLog.
 *
 * Usage:
 *   node scripts/cleanup-legacy-logs.mjs --dry-run
 *   node scripts/cleanup-legacy-logs.mjs
 */

import admin from 'firebase-admin';

const dryRun = process.argv.includes('--dry-run');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function deleteCollection(colRef, batchSize = 500) {
  let deleted = 0;
  while (true) {
    const snap = await colRef.limit(batchSize).get();
    if (snap.empty) break;

    if (dryRun) {
      deleted += snap.size;
      if (snap.size < batchSize) break;
      continue;
    }

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}

const collections = ['smsLog', 'emailLog'];

console.log(`Legacy log cleanup${dryRun ? ' (dry run)' : ''}`);

for (const name of collections) {
  const countSnap = await db.collection(name).count().get();
  const total = countSnap.data().count;
  console.log(`\n${name}: ${total} document(s)`);

  if (total === 0) continue;

  if (dryRun) {
    console.log(`[dry-run] would delete ${total} document(s) from ${name}`);
    continue;
  }

  const deleted = await deleteCollection(db.collection(name));
  console.log(`Deleted ${deleted} document(s) from ${name}`);
}

if (dryRun) {
  console.log('\nRe-run without --dry-run to delete legacy collections.');
} else {
  console.log('\nLegacy smsLog/emailLog collections removed.');
}
