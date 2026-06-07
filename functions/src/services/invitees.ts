import * as admin from 'firebase-admin';
import type { Invitee, SendOutcome } from '../types';
import { digitsOnlyPhone, normalizeEmail } from '../utils/validation';

export async function updateInviteeTracking(
  slug: string,
  channel: 'email' | 'sms',
  outcomes: SendOutcome[]
): Promise<void> {
  const successful = outcomes.filter((o) => o.success);
  if (successful.length === 0) {
    return;
  }

  const ref = admin.firestore().doc(`events/${slug}`);

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return;
    }

    const invitees: Invitee[] = Array.isArray(snap.data()?.invitees)
      ? [...snap.data()!.invitees]
      : [];

    const now = Date.now();

    for (const outcome of successful) {
      const index = findInviteeIndex(invitees, outcome, channel);
      if (index === -1) {
        continue;
      }

      const existing = invitees[index];
      invitees[index] = {
        ...existing,
        lastSentAt: now,
        sendCount: (existing.sendCount || 0) + 1,
        lastSentChannel: channel,
      };
    }

    tx.update(ref, { invitees, updatedAt: now });
  });
}

function findInviteeIndex(
  invitees: Invitee[],
  outcome: SendOutcome,
  channel: 'email' | 'sms'
): number {
  if (channel === 'email') {
    const email = outcome.recipient.email
      ? normalizeEmail(outcome.recipient.email)
      : '';
    return invitees.findIndex(
      (invitee) => invitee.email && normalizeEmail(invitee.email) === email
    );
  }

  const phoneDigits = outcome.recipient.phone
    ? digitsOnlyPhone(outcome.recipient.phone)
    : '';
  return invitees.findIndex(
    (invitee) => invitee.phone && digitsOnlyPhone(invitee.phone) === phoneDigits
  );
}

export async function logEmailSend(params: {
  hostUid: string;
  eventSlug: string;
  recipientEmail: string;
  recipientName: string;
  success: boolean;
  error?: string;
}): Promise<void> {
  await admin.firestore().collection('emailLog').add({
    hostUid: params.hostUid,
    eventSlug: params.eventSlug,
    recipientEmail: params.recipientEmail,
    recipientName: params.recipientName,
    success: params.success,
    ...(params.error !== undefined ? { error: params.error } : {}),
    createdAt: Date.now(),
  });
}

export async function logSmsSend(params: {
  hostUid: string;
  eventSlug: string;
  recipientPhone: string;
  recipientName: string;
  success: boolean;
  error?: string;
}): Promise<void> {
  await admin.firestore().collection('smsLog').add({
    hostUid: params.hostUid,
    eventSlug: params.eventSlug,
    recipientPhone: params.recipientPhone,
    recipientName: params.recipientName,
    success: params.success,
    ...(params.error !== undefined ? { error: params.error } : {}),
    createdAt: Date.now(),
  });
}
