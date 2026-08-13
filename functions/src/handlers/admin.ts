import type { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import { verifyAdminAuth } from '../middleware/auth';
import { applyCors } from '../middleware/cors';

export type AdminOverviewResponse = {
  totalUsers: number;
  totalEvents: number;
  publishedEvents: number;
  draftEvents: number;
  hostsWithEvents: number;
  earnings: {
    totalCents: number;
    currency: 'USD';
    available: boolean;
  };
};

export type AdminUserRow = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  phone: string | null;
  disabled: boolean;
  admin: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
  hostedEventCount: number;
};

export type AdminUsersResponse = {
  users: AdminUserRow[];
  nextPageToken: string | null;
  pageSize: number;
};

function parsePageSize(raw: unknown, fallback = 50): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 100);
}

async function countAuthUsers(): Promise<number> {
  let total = 0;
  let pageToken: string | undefined;
  do {
    const result = await admin.auth().listUsers(1000, pageToken);
    total += result.users.length;
    pageToken = result.pageToken;
  } while (pageToken);
  return total;
}

async function hostedEventCount(uid: string): Promise<number> {
  const snap = await admin
    .firestore()
    .collection(`users/${uid}/hostedEvents`)
    .count()
    .get();
  return snap.data().count;
}

export async function handleAdminOverview(req: Request, res: Response): Promise<void> {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const auth = await verifyAdminAuth(req, res);
  if (!auth) {
    return;
  }

  try {
    const [totalUsers, eventsSnap, hostedSnap] = await Promise.all([
      countAuthUsers(),
      admin.firestore().collection('events').get(),
      admin.firestore().collectionGroup('hostedEvents').get(),
    ]);

    let publishedEvents = 0;
    let draftEvents = 0;
    for (const doc of eventsSnap.docs) {
      const status = doc.data()?.status;
      if (status === 'published') publishedEvents += 1;
      else draftEvents += 1;
    }

    const hostUids = new Set<string>();
    for (const doc of hostedSnap.docs) {
      const parent = doc.ref.parent.parent;
      if (parent) hostUids.add(parent.id);
    }

    const response: AdminOverviewResponse = {
      totalUsers,
      totalEvents: eventsSnap.size,
      publishedEvents,
      draftEvents,
      hostsWithEvents: hostUids.size,
      earnings: {
        totalCents: 0,
        currency: 'USD',
        available: false,
      },
    };

    res.status(200).json(response);
  } catch (err) {
    console.error('handleAdminOverview', err);
    res.status(500).send('internal_error');
  }
}

export async function handleAdminUsers(req: Request, res: Response): Promise<void> {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const auth = await verifyAdminAuth(req, res);
  if (!auth) {
    return;
  }

  const pageSize = parsePageSize(req.query.pageSize);
  const pageToken =
    typeof req.query.pageToken === 'string' && req.query.pageToken
      ? req.query.pageToken
      : undefined;

  try {
    const listResult = await admin.auth().listUsers(pageSize, pageToken);
    const users: AdminUserRow[] = await Promise.all(
      listResult.users.map(async (record) => {
        const profileSnap = await admin.firestore().doc(`users/${record.uid}`).get();
        const profile = profileSnap.data();
        const count = await hostedEventCount(record.uid);

        return {
          uid: record.uid,
          email: record.email ?? null,
          displayName:
            record.displayName ||
            (typeof profile?.displayName === 'string' ? profile.displayName : null),
          photoURL:
            record.photoURL ||
            (typeof profile?.avatar === 'string' ? profile.avatar : null),
          phone:
            record.phoneNumber ||
            (typeof profile?.phone === 'string' ? profile.phone : null),
          disabled: record.disabled,
          admin: profile?.admin === true,
          createdAt: record.metadata.creationTime
            ? Date.parse(record.metadata.creationTime)
            : null,
          lastSignInAt: record.metadata.lastSignInTime
            ? Date.parse(record.metadata.lastSignInTime)
            : null,
          hostedEventCount: count,
        };
      })
    );

    const response: AdminUsersResponse = {
      users,
      nextPageToken: listResult.pageToken ?? null,
      pageSize,
    };

    res.status(200).json(response);
  } catch (err) {
    console.error('handleAdminUsers', err);
    res.status(500).send('internal_error');
  }
}
