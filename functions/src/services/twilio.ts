import twilio from 'twilio';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  getTwilioAccountSid,
  getTwilioAuthToken,
  getTwilioFromNumber,
  getTwilioMessagingServiceSid,
} from '../config';
import type { BulkRecipient, BulkSendEvent, SendOutcome } from '../types';
import { resolveMessageBody } from '../utils/messages';
import { logSmsSend } from './invitees';

let twilioClient: ReturnType<typeof twilio> | null = null;

function formatTwilioError(error: unknown): string {
  if (error && typeof error === 'object') {
    const twilioError = error as { message?: string; code?: number };
    if (twilioError.message) {
      return twilioError.code
        ? `[${twilioError.code}] ${twilioError.message}`
        : twilioError.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'send_failed';
}

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
  const fromNumber = getTwilioFromNumber();
  if (!messagingServiceSid && !fromNumber) {
    throw new Error(
      'Configure TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER for SMS'
    );
  }

  const body = resolveMessageBody({
    event,
    channel: 'sms',
    recipientName: recipient.name,
    customMessage,
  });

  const sendParams = fromNumber
    ? { to, from: fromNumber, body }
    : { to, messagingServiceSid, body };

  try {
    const message = await getTwilio().messages.create(sendParams);

    const success = ['queued', 'accepted', 'sending', 'sent', 'delivered'].includes(
      message.status
    );

    await logSmsSend({
      hostUid,
      eventSlug: event.slug,
      recipientPhone: to,
      recipientName: recipient.name,
      success,
      ...(success ? {} : { error: message.status }),
    });

    return {
      recipient: { ...recipient, phone: to },
      success,
      ...(success ? {} : { error: message.status }),
    };
  } catch (error: unknown) {
    const message = formatTwilioError(error);
    console.error('Twilio SMS failed:', { to, error: message });
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
