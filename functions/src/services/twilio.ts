import twilio from 'twilio';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  getTwilioAccountSid,
  getTwilioAuthToken,
  getTwilioFromNumber,
  getTwilioMessagingServiceSid,
} from '../config';
import type { BulkRecipient, BulkSendEvent, MessageLogEntry, SendOutcome } from '../types';
import { resolveMessageBody } from '../utils/messages';

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

type TwilioCreateParams =
  | { to: string; from: string; body: string; mediaUrl?: string[] }
  | { to: string; messagingServiceSid: string; body: string; mediaUrl?: string[] };

export async function sendSmsToRecipient(params: {
  recipient: BulkRecipient;
  event: BulkSendEvent;
  customMessage?: string;
  hostUid: string;
  mediaUrl?: string;
  mmsRequested?: boolean;
}): Promise<SendOutcome> {
  const { recipient, event, customMessage, hostUid, mediaUrl, mmsRequested } = params;
  const rawPhone = recipient.phone?.trim();

  if (!rawPhone) {
    return {
      recipient,
      success: false,
      error: 'missing_phone',
      mmsRequested,
    };
  }

  const to = normalizeToE164(rawPhone);
  if (!to) {
    return {
      recipient,
      success: false,
      error: 'invalid_phone',
      mmsRequested,
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

  const buildLogEntry = (result: {
    success: boolean;
    twilioSid?: string;
    error?: string;
  }): MessageLogEntry => ({
    channel: 'sms',
    hostUid,
    recipientPhone: to,
    recipientName: recipient.name,
    body,
    success: result.success,
    createdAt: Date.now(),
    source: 'api',
    ...(result.error !== undefined ? { error: result.error } : {}),
    ...(result.twilioSid !== undefined ? { twilioSid: result.twilioSid } : {}),
  });

  const baseParams: TwilioCreateParams = fromNumber
    ? { to, from: fromNumber, body }
    : { to, messagingServiceSid, body };

  const withMedia: TwilioCreateParams =
    mediaUrl && mediaUrl.startsWith('https://')
      ? { ...baseParams, mediaUrl: [mediaUrl] }
      : baseParams;

  const deliver = async (
    createParams: TwilioCreateParams
  ): Promise<{
    success: boolean;
    sid?: string;
    status?: string;
    error?: string;
    mmsAttached?: boolean;
  }> => {
    const message = await getTwilio().messages.create(createParams);
    const mmsAttached =
      'mediaUrl' in createParams && createParams.mediaUrl
        ? Number(message.numMedia || 0) > 0
        : false;
    const success = ['queued', 'accepted', 'sending', 'sent', 'delivered'].includes(
      message.status
    );
    return {
      success,
      sid: message.sid,
      mmsAttached,
      ...(success ? {} : { status: message.status, error: message.status }),
    };
  };

  try {
    let result =
      mmsRequested && 'mediaUrl' in withMedia
        ? await deliver(withMedia)
        : await deliver(baseParams);

    if (
      mmsRequested &&
      'mediaUrl' in withMedia &&
      result.success &&
      !result.mmsAttached
    ) {
      console.warn('Twilio accepted MMS without media; retrying SMS-only:', { to });
      result = await deliver(baseParams);
      result.mmsAttached = false;
    } else if (
      mmsRequested &&
      'mediaUrl' in withMedia &&
      !result.success
    ) {
      console.warn('Twilio MMS failed; retrying SMS-only:', {
        to,
        error: result.error || result.status,
      });
      result = await deliver(baseParams);
      result.mmsAttached = false;
    }

    return {
      recipient: { ...recipient, phone: to },
      success: result.success,
      mmsRequested: !!mmsRequested,
      mmsAttached: result.mmsAttached,
      messageLog: buildLogEntry({
        success: result.success,
        twilioSid: result.sid,
        ...(result.success ? {} : { error: result.error || result.status }),
      }),
      ...(result.success ? {} : { error: result.error || result.status }),
    };
  } catch (error: unknown) {
    if (mmsRequested && 'mediaUrl' in withMedia) {
      try {
        const fallback = await deliver(baseParams);
        return {
          recipient: { ...recipient, phone: to },
          success: fallback.success,
          mmsRequested: true,
          mmsAttached: false,
          messageLog: buildLogEntry({
            success: fallback.success,
            twilioSid: fallback.sid,
            ...(fallback.success ? {} : { error: fallback.error || fallback.status }),
          }),
          ...(fallback.success
            ? { error: 'mms_attach_failed_text_sent' }
            : { error: fallback.error || fallback.status }),
        };
      } catch (fallbackError: unknown) {
        error = fallbackError;
      }
    }

    const message = formatTwilioError(error);
    console.error('Twilio SMS failed:', { to, error: message });

    return {
      recipient: { ...recipient, phone: to },
      success: false,
      mmsRequested: !!mmsRequested,
      mmsAttached: false,
      error: message,
      messageLog: buildLogEntry({ success: false, error: message }),
    };
  }
}
