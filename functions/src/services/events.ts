import * as admin from 'firebase-admin';

export type EventRecord = {
  id: string;
  slug?: string;
  name?: string;
  description?: string;
  date?: string;
  time?: string;
  endDate?: string;
  endTime?: string;
  location?: string;
  coverImage?: string;
};

export async function getEventBySlug(slug: string): Promise<EventRecord | null> {
  const db = admin.firestore();
  const direct = await db.doc(`events/${slug}`).get();

  if (direct.exists) {
    return { id: direct.id, ...(direct.data() as Omit<EventRecord, 'id'>) };
  }

  const legacy = await db.collection('events').where('slug', '==', slug).limit(1).get();
  if (legacy.empty) {
    return null;
  }

  const doc = legacy.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<EventRecord, 'id'>) };
}
