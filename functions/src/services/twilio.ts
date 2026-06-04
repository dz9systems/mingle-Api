import twilio from 'twilio';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  getTwilioAccountSid,
  getTwilioAuthToken,
  getTwilioMessagingServiceSid,
} from '../config';
import type { BulkRecipient, BulkSendEvent, SendOutcome } from '../types';
import { resolveMessageBody } from '../utils/messages';
import { logSmsSend } from './invitees';

let twilioClient: ReturnType<typeof twilio> | null = null;

function getTwilio() {
  if (!twilioClient) {
    const accountSid = getTwilioAccountSid();
    const authToken = getTwilioAuthToken();
    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials are not configured');
    }
    twilioClient = twilio(accountSid, authToken);
  }
  return twilioClient;
}

export function normalizeToE164(phone: string, defaultCountry = 'US'): string | null {
  const parsed = parsePhoneNumberFromString(phone, defaultCountry as 'US');
  if (!parsed || !parsed.isValid()) {
    return null;
  }
  return parsed.format('E.164');
}

export async function sendSmsToRecipient(params: {
  recipient: BulkRecipient;
  event: BulkSendEvent;
  customMessage?: string;
  hostUid: string;
}): Promise<SendOutcome> {
  const { recipient, event, customMessage, hostUid } = params;
  const rawPhone = recipient.phone?.trim();

  if (!rawPhone) {
    return {
      recipient,
      success: false,
      error: 'missing_phone',
    };
  }

  const to = normalizeToE164(rawPhone);
  if (!to) {
    return {
      recipient,
      success: false,
      error: 'invalid_phone',
    };
  }

  const messagingServiceSid = getTwilioMessagingServiceSid();
  if (!messagingServiceSid) {
    throw new Error('TWILIO_MESSAGING_SERVICE_SID is not configured');
  }

  const body = resolveMessageBody({
    event,
    channel: 'sms',
    recipientName: recipient.name,
    customMessage,
  });

  try {
    const message = await getTwilio().messages.create({
      to,
      messagingServiceSid,
      body,
    });

    const success = ['queued', 'accepted', 'sending', 'sent', 'delivered'].includes(
      message.status
    );

    await logSmsSend({
      hostUid,
      eventSlug: event.slug,
      recipientPhone: to,
      recipientName: recipient.name,
      success,
      error: success ? undefined : message.status,
    });

    return {
      recipient: { ...recipient, phone: to },
      success,
      error: success ? undefined : message.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'send_failed';
    await logSmsSend({
      hostUid,
      eventSlug: event.slug,
      recipientPhone: to,
      recipientName: recipient.name,
      success: false,
      error: message,
    });

    return {
      recipient: { ...recipient, phone: to },
      success: false,
      error: message,
    };
  }
}
