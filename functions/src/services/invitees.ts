import * as admin from 'firebase-admin';
import type { Invitee, SendOutcome } from '../types';
import { logOutboundMessage } from './messageLog';
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
        ...(channel === 'email' ? { emailSentAt: now } : { smsSentAt: now }),
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
  body: string;
  success: boolean;
  error?: string;
  resendId?: string;
}): Promise<void> {
  await logOutboundMessage({
    channel: 'email',
    hostUid: params.hostUid,
    eventSlug: params.eventSlug,
    recipientEmail: params.recipientEmail,
    recipientName: params.recipientName,
    body: params.body,
    success: params.success,
    ...(params.error !== undefined ? { error: params.error } : {}),
    ...(params.resendId !== undefined ? { resendId: params.resendId } : {}),
  });
}

export async function logSmsSend(params: {
  hostUid: string;
  eventSlug: string;
  recipientPhone: string;
  recipientName: string;
  body: string;
  success: boolean;
  error?: string;
  twilioSid?: string;
  createdAt?: number;
  source?: 'api' | 'migration';
}): Promise<void> {
  await logOutboundMessage({
    channel: 'sms',
    hostUid: params.hostUid,
    eventSlug: params.eventSlug,
    recipientPhone: params.recipientPhone,
    recipientName: params.recipientName,
    body: params.body,
    success: params.success,
    ...(params.error !== undefined ? { error: params.error } : {}),
    ...(params.twilioSid !== undefined ? { twilioSid: params.twilioSid } : {}),
    ...(params.createdAt !== undefined ? { createdAt: params.createdAt } : {}),
    ...(params.source !== undefined ? { source: params.source } : {}),
  });
}
