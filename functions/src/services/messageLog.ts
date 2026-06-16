import * as admin from 'firebase-admin';
import type { MessageLogEntry, MessageLogSource } from '../types';

export type LogOutboundMessageParams = {
  hostUid: string;
  eventSlug: string;
  recipientName: string;
  body: string;
  recipientEmail?: string;
  recipientPhone?: string;
  success: boolean;
  error?: string;
  twilioSid?: string;
  resendId?: string;
  source?: MessageLogSource;
  createdAt?: number;
  channel: MessageLogEntry['channel'];
};

/**
 * Outbound message logs live under events/{slug}/messageLog — not under users/.
 * Events are the source of truth for guest communication; co-hosts share the same
 * event doc regardless of users/{uid}/hostedEvents indexing.
 */
function buildMessageLogEntry(params: LogOutboundMessageParams): MessageLogEntry {
  const createdAt = params.createdAt ?? Date.now();
  const source = params.source ?? 'api';

  return {
    channel: params.channel,
    hostUid: params.hostUid,
    recipientName: params.recipientName,
    body: params.body,
    success: params.success,
    createdAt,
    source,
    ...(params.recipientEmail !== undefined ? { recipientEmail: params.recipientEmail } : {}),
    ...(params.recipientPhone !== undefined ? { recipientPhone: params.recipientPhone } : {}),
    ...(params.error !== undefined ? { error: params.error } : {}),
    ...(params.twilioSid !== undefined ? { twilioSid: params.twilioSid } : {}),
    ...(params.resendId !== undefined ? { resendId: params.resendId } : {}),
  };
}

export async function logOutboundMessage(params: LogOutboundMessageParams): Promise<void> {
  const entry = buildMessageLogEntry(params);
  await admin.firestore().collection(`events/${params.eventSlug}/messageLog`).add(entry);
}

const MESSAGE_LOG_BATCH_SIZE = 400;

export async function logOutboundMessagesBatch(
  eventSlug: string,
  entries: MessageLogEntry[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const collection = admin.firestore().collection(`events/${eventSlug}/messageLog`);

  for (let offset = 0; offset < entries.length; offset += MESSAGE_LOG_BATCH_SIZE) {
    const batch = admin.firestore().batch();
    const chunk = entries.slice(offset, offset + MESSAGE_LOG_BATCH_SIZE);

    for (const entry of chunk) {
      batch.set(collection.doc(), entry);
    }

    await batch.commit();
  }
}

export async function messageLogExistsForTwilioSid(
  eventSlug: string,
  twilioSid: string
): Promise<boolean> {
  const snap = await admin
    .firestore()
    .collection(`events/${eventSlug}/messageLog`)
    .where('twilioSid', '==', twilioSid)
    .limit(1)
    .get();
  return !snap.empty;
}
