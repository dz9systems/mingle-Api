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
export async function logOutboundMessage(params: LogOutboundMessageParams): Promise<void> {
  const createdAt = params.createdAt ?? Date.now();
  const source = params.source ?? 'api';

  const entry: MessageLogEntry = {
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

  await admin.firestore().collection(`events/${params.eventSlug}/messageLog`).add(entry);
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
