import * as admin from 'firebase-admin';
import type { Invitee } from '../types';
import { isValidEmail, normalizeEmail } from '../utils/validation';

export type ImportRsvpStatus = 'going' | 'maybe' | 'no' | 'invited';

export type GuestImportRow = {
  name: string;
  email?: string;
  phone?: string;
  importStatus?: ImportRsvpStatus | null;
  hasPlusOne?: boolean;
  updatedAt?: string;
};

export type ApplyGuestImportResult = {
  inviteeCount: number;
  rsvpCount: number;
};

export type SyncRsvpsToInviteesResult = {
  added: number;
  inviteeCount: number;
};

type EventDoc = {
  ref: admin.firestore.DocumentReference;
  data: admin.firestore.DocumentData;
};

async function getEventDoc(slug: string): Promise<EventDoc | null> {
  const db = admin.firestore();
  const direct = await db.doc(`events/${slug}`).get();
  if (direct.exists) {
    return { ref: direct.ref, data: direct.data()! };
  }

  const legacy = await db.collection('events').where('slug', '==', slug).limit(1).get();
  if (legacy.empty) {
    return null;
  }

  const doc = legacy.docs[0];
  return { ref: doc.ref, data: doc.data() };
}

function inviteeKey(inv: Pick<Invitee, 'email' | 'name'>): string {
  return (inv.email || inv.name).toLowerCase();
}

function draftToInvitee(row: GuestImportRow): Invitee {
  const invitee: Invitee = {
    name: row.name,
    email: row.email,
    phone: row.phone,
  };
  if (row.importStatus === 'invited') {
    invitee.sendCount = 1;
  }
  return invitee;
}

export function mergeImportedInvitees(
  existing: Invitee[],
  draft: GuestImportRow[]
): Invitee[] {
  const byKey = new Map<string, Invitee>();
  for (const inv of existing) {
    byKey.set(inviteeKey(inv), inv);
  }
  for (const row of draft) {
    const key = inviteeKey(row);
    const incoming = draftToInvitee(row);
    const prev = byKey.get(key);
    if (prev) {
      byKey.set(key, {
        ...prev,
        name: incoming.name || prev.name,
        email: incoming.email || prev.email,
        phone: incoming.phone || prev.phone,
        sendCount:
          row.importStatus === 'invited'
            ? Math.max(prev.sendCount || 0, 1)
            : prev.sendCount,
      });
    } else {
      byKey.set(key, incoming);
    }
  }
  return Array.from(byKey.values());
}

function rsvpUidForGuest(email?: string, name?: string): string | null {
  if (email && isValidEmail(email)) {
    return `guest-${normalizeEmail(email)}`;
  }
  if (name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug) return `guest-import-${slug}`;
  }
  return null;
}

function sanitizeInvitees(invitees: Invitee[]): Invitee[] {
  return invitees.map((inv) => {
    const row: Invitee = { name: inv.name };
    if (inv.email) row.email = inv.email;
    if (inv.phone) row.phone = inv.phone;
    if (inv.lastSentAt !== undefined) row.lastSentAt = inv.lastSentAt;
    if (inv.sendCount !== undefined) row.sendCount = inv.sendCount;
    if (inv.lastSentChannel) row.lastSentChannel = inv.lastSentChannel;
    return row;
  });
}

export async function applyGuestImport(
  slug: string,
  rows: GuestImportRow[]
): Promise<ApplyGuestImportResult> {
  const eventDoc = await getEventDoc(slug);
  if (!eventDoc) {
    throw new Error('Event not found');
  }

  const existing: Invitee[] = Array.isArray(eventDoc.data.invitees)
    ? [...eventDoc.data.invitees]
    : [];
  const merged = sanitizeInvitees(mergeImportedInvitees(existing, rows));

  const db = admin.firestore();
  const batch = db.batch();
  batch.update(eventDoc.ref, { invitees: merged });

  let rsvpCount = 0;
  for (const row of rows) {
    const status = row.importStatus;
    if (!status || status === 'invited') continue;

    const uid = rsvpUidForGuest(row.email, row.name);
    if (!uid) continue;

    const rsvpRef = eventDoc.ref.collection('rsvps').doc(uid);
    batch.set(
      rsvpRef,
      {
        name: row.name,
        email: row.email || '',
        phone: row.phone || '',
        status,
        hasPlusOne: status !== 'no' && !!row.hasPlusOne,
        dietaryNotes: '',
        updatedAt: row.updatedAt || new Date().toISOString(),
      },
      { merge: true }
    );
    rsvpCount += 1;
  }

  await batch.commit();

  return {
    inviteeCount: merged.length,
    rsvpCount,
  };
}

export async function syncRsvpsToInvitees(slug: string): Promise<SyncRsvpsToInviteesResult> {
  const eventDoc = await getEventDoc(slug);
  if (!eventDoc) {
    throw new Error('Event not found');
  }

  const existing: Invitee[] = Array.isArray(eventDoc.data.invitees)
    ? [...eventDoc.data.invitees]
    : [];
  const byKey = new Map<string, Invitee>();
  for (const inv of existing) {
    byKey.set(inviteeKey(inv), inv);
  }

  const rsvpSnap = await eventDoc.ref.collection('rsvps').get();
  let added = 0;

  for (const doc of rsvpSnap.docs) {
    const data = doc.data();
    const name = String(data.name || '').trim();
    const email = data.email ? String(data.email).trim() : '';
    const phone = data.phone ? String(data.phone).trim() : '';
    if (!name && !email) continue;

    const key = (email || name).toLowerCase();
    if (byKey.has(key)) continue;

    const invitee: Invitee = { name: name || email };
    if (email && isValidEmail(email)) invitee.email = normalizeEmail(email);
    if (phone) invitee.phone = phone;

    byKey.set(key, invitee);
    added += 1;
  }

  const merged = sanitizeInvitees(Array.from(byKey.values()));
  await eventDoc.ref.update({ invitees: merged });

  return {
    added,
    inviteeCount: merged.length,
  };
}
