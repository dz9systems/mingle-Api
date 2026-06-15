import * as admin from 'firebase-admin';

const EVENT_SUBCOLLECTIONS = ['rsvps', 'potluck', 'songs', 'teamAssignments'] as const;

async function deleteQueryBatch(
  query: admin.firestore.Query,
  batchSize = 500
): Promise<number> {
  const snap = await query.limit(batchSize).get();
  if (snap.empty) return 0;
  const batch = admin.firestore().batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
}

async function deleteCollection(colRef: admin.firestore.CollectionReference): Promise<void> {
  let deleted = 0;
  do {
    deleted = await deleteQueryBatch(colRef);
  } while (deleted >= 500);
}

export async function purgeExpiredEventBackups(): Promise<number> {
  const db = admin.firestore();
  const now = Date.now();
  const snap = await db.collection('eventBackups').where('expiresAt', '<', now).get();

  for (const docSnap of snap.docs) {
    const slug = docSnap.id;
    for (const sub of EVENT_SUBCOLLECTIONS) {
      await deleteCollection(db.collection('eventBackups').doc(slug).collection(sub));
    }
    await docSnap.ref.delete();
  }

  return snap.size;
}
