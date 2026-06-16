import type { Request, Response } from 'express';
import type { BulkSendResponse, BulkRecipient, SendOutcome } from '../types';
import { verifyHostAuth } from '../middleware/auth';
import { applyCors, getClientIp } from '../middleware/cors';
import { getEventBySlug } from '../services/events';
import { resolveMmsMediaUrl } from '../services/mmsCover';
import { logOutboundMessagesBatch } from '../services/messageLog';
import { updateInviteeTracking } from '../services/invitees';
import { normalizeToE164, sendSmsToRecipient } from '../services/twilio';
import { checkRateLimits } from '../utils/rateLimit';
import { runConcurrent, validateBulkSendRequest } from '../utils/validation';

export async function handleSendSms(req: Request, res: Response): Promise<void> {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const auth = await verifyHostAuth(req, res);
  if (!auth) {
    return;
  }

  const parsed = validateBulkSendRequest(req.body, 'sms');
  if (!parsed.ok) {
    res.status(400).send(parsed.message);
    return;
  }

  const { data } = parsed;
  const validRecipients: BulkRecipient[] = [];
  let skipped = 0;

  for (const recipient of data.recipients) {
    if (!recipient.phone) {
      skipped += 1;
      continue;
    }

    const e164 = normalizeToE164(recipient.phone);
    if (!e164) {
      skipped += 1;
      continue;
    }

    validRecipients.push({
      ...recipient,
      phone: e164,
    });
  }

  if (validRecipients.length === 0) {
    const response: BulkSendResponse = {
      ok: true,
      sent: 0,
      failed: 0,
      skipped,
    };
    res.status(200).json(response);
    return;
  }

  const rateLimit = await checkRateLimits(
    auth.uid,
    'sms',
    validRecipients.length,
    getClientIp(req)
  );
  if (!rateLimit.allowed) {
    res.status(rateLimit.status).send(rateLimit.message);
    return;
  }

  let mediaUrl: string | undefined;
  let mmsMediaError: string | undefined;
  if (data.includeMedia) {
    const stored =
      data.event.coverImage?.startsWith('https://')
        ? data.event.coverImage
        : (await getEventBySlug(data.event.slug))?.coverImage;
    if (stored?.startsWith('https://')) {
      const prepared = await resolveMmsMediaUrl(data.event.slug, stored);
      if (prepared.url) {
        mediaUrl = prepared.url;
      } else {
        mmsMediaError = prepared.error || 'cover_image_unavailable';
        console.error('MMS media prep failed:', {
          slug: data.event.slug,
          error: mmsMediaError,
        });
      }
    } else {
      mmsMediaError = 'cover_image_missing';
    }
  }

  const mmsRequested = data.includeMedia === true && !!mediaUrl;

  const outcomes: SendOutcome[] = [];

  try {
    await runConcurrent(validRecipients, 10, async (recipient) => {
      const outcome = await sendSmsToRecipient({
        recipient,
        event: data.event,
        customMessage: data.customMessage,
        hostUid: auth.uid,
        mediaUrl,
        mmsRequested,
      });
      outcomes.push(outcome);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal_error';
    res.status(500).send(message);
    return;
  }

  const messageLogs = outcomes
    .map((outcome) => outcome.messageLog)
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);

  await Promise.all([
    logOutboundMessagesBatch(data.event.slug, messageLogs),
    updateInviteeTracking(data.event.slug, 'sms', outcomes),
  ]);

  const sent = outcomes.filter((o) => o.success).length;
  const failed = outcomes.filter((o) => !o.success).length;
  const mmsAttached = outcomes.filter((o) => o.mmsAttached).length;
  const errors = outcomes
    .filter((o) => !o.success && o.error)
    .map((o) => o.error as string);

  if (errors.length > 0) {
    console.error('sendSms failures:', errors);
  }

  let message: string | undefined;
  if (errors.length > 0) {
    message = errors.join(' · ');
  } else if (failed > 0) {
    message = `${failed} recipient(s) failed to send`;
  } else if (data.includeMedia) {
    if (!mediaUrl && mmsMediaError) {
      message =
        'Text sent, but the event image could not be prepared for MMS. Check that a cover image is uploaded.';
    } else if (mmsRequested && mmsAttached === 0 && sent > 0) {
      message =
        'Text delivered, but the image was not attached. Try a smaller cover image or send again.';
    } else if (mmsAttached > 0 && mmsAttached < sent) {
      message = `Image attached for ${mmsAttached} of ${sent} recipients.`;
    }
  }

  const response: BulkSendResponse = {
    ok: failed === 0,
    sent,
    failed,
    skipped,
    mmsRequested: data.includeMedia === true,
    mmsAttached: data.includeMedia ? mmsAttached : undefined,
    message,
  };

  res.status(200).json(response);
}
