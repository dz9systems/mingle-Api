import type { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import type { AuthContext, BulkSendRequest } from '../types';

export async function verifyFirebaseAuth(
  req: Request,
  res: Response
): Promise<{ uid: string; email?: string } | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).send('unauthorized');
    return null;
  }

  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) {
    res.status(401).send('unauthorized');
    return null;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    res.status(401).send('unauthorized');
    return null;
  }
}

export async function isHostOfEvent(uid: string, slug: string): Promise<boolean> {
  const eventSnap = await admin.firestore().doc(`events/${slug}`).get();
  if (!eventSnap.exists) {
    return false;
  }

  const data = eventSnap.data();
  const hostIds: string[] = data?.hostIds || [];
  return hostIds.includes(uid) || data?.hostId === uid;
}

export async function verifyHostAuthForSlug(
  req: Request,
  res: Response,
  slug: string
): Promise<AuthContext | null> {
  const auth = await verifyFirebaseAuth(req, res);
  if (!auth) {
    return null;
  }

  if (!slug || typeof slug !== 'string') {
    res.status(400).send('missing_event_slug');
    return null;
  }

  const eventSnap = await admin.firestore().doc(`events/${slug}`).get();
  if (!eventSnap.exists) {
    res.status(404).send('not_found');
    return null;
  }

  const data = eventSnap.data();
  const hostIds: string[] = data?.hostIds || [];
  if (!hostIds.includes(auth.uid) && data?.hostId !== auth.uid) {
    res.status(403).send('forbidden');
    return null;
  }

  return {
    uid: auth.uid,
    eventSlug: slug,
    email: auth.email,
  };
}

export async function verifyHostAuth(
  req: Request,
  res: Response
): Promise<AuthContext | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).send('unauthorized');
    return null;
  }

  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) {
    res.status(401).send('unauthorized');
    return null;
  }

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch {
    res.status(401).send('unauthorized');
    return null;
  }

  const body = req.body as Partial<BulkSendRequest> | undefined;
  const slug = body?.event?.slug;
  if (!slug || typeof slug !== 'string') {
    res.status(400).send('missing_event_slug');
    return null;
  }

  const eventSnap = await admin.firestore().doc(`events/${slug}`).get();
  if (!eventSnap.exists) {
    res.status(404).send('not_found');
    return null;
  }

  const data = eventSnap.data();
  const hostIds: string[] = data?.hostIds || [];
  if (!hostIds.includes(decoded.uid) && data?.hostId !== decoded.uid) {
    res.status(403).send('forbidden');
    return null;
  }

  return {
    uid: decoded.uid,
    eventSlug: slug,
    email: decoded.email,
  };
}
