import { Resend } from 'resend';
import { getResendApiKey, getResendFromEmail } from '../config';
import type { BulkRecipient, BulkSendEvent, SendOutcome } from '../types';
import { buildEmailHtml, resolveMessageBody } from '../utils/messages';
import { logEmailSend } from './invitees';

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = getResendApiKey();
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export async function sendEmailToRecipient(params: {
  recipient: BulkRecipient;
  event: BulkSendEvent;
  customMessage?: string;
  hostUid: string;
}): Promise<SendOutcome> {
  const { recipient, event, customMessage, hostUid } = params;
  const email = recipient.email?.trim();

  if (!email) {
    return {
      recipient,
      success: false,
      error: 'missing_email',
    };
  }

  const bodyText = resolveMessageBody({
    event,
    channel: 'email',
    recipientName: recipient.name,
    customMessage,
  });

  const subject = `You're invited: ${event.name}`;
  const html = buildEmailHtml({
    event,
    recipientName: recipient.name,
    bodyText,
  });

  try {
    const result = await getResend().emails.send({
      from: getResendFromEmail(),
      to: email,
      subject,
      html,
      text: bodyText,
      replyTo: getResendFromEmail().match(/<([^>]+)>/)?.[1],
    });

    const success = !result.error;
    await logEmailSend({
      hostUid,
      eventSlug: event.slug,
      recipientEmail: email,
      recipientName: recipient.name,
      success,
      error: result.error?.message,
    });

    return {
      recipient,
      success,
      error: result.error?.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'send_failed';
    await logEmailSend({
      hostUid,
      eventSlug: event.slug,
      recipientEmail: email,
      recipientName: recipient.name,
      success: false,
      error: message,
    });

    return {
      recipient,
      success: false,
      error: message,
    };
  }
}
