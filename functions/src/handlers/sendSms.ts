import type { Request, Response } from 'express';
import type { BulkSendResponse, BulkRecipient, SendOutcome } from '../types';
import { verifyHostAuth } from '../middleware/auth';
import { applyCors, getClientIp } from '../middleware/cors';
import { updateInviteeTracking } from '../services/invitees';
import { normalizeToE164, sendSmsToRecipient } from '../services/twilio';
import { checkRateLimits } from '../utils/rateLimit';
import { throttle, validateBulkSendRequest } from '../utils/validation';

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

  const outcomes: SendOutcome[] = [];

  try {
    await throttle(validRecipients, 10, async (recipient) => {
      const outcome = await sendSmsToRecipient({
        recipient,
        event: data.event,
        customMessage: data.customMessage,
        hostUid: auth.uid,
      });
      outcomes.push(outcome);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal_error';
    res.status(500).send(message);
    return;
  }

  await updateInviteeTracking(data.event.slug, 'sms', outcomes);

  const sent = outcomes.filter((o) => o.success).length;
  const failed = outcomes.filter((o) => !o.success).length;
  const errors = outcomes
    .filter((o) => !o.success && o.error)
    .map((o) => o.error as string);

  if (errors.length > 0) {
    console.error('sendSms failures:', errors);
  }

  const response: BulkSendResponse = {
    ok: failed === 0,
    sent,
    failed,
    skipped,
    message:
      errors.length > 0
        ? errors.join(' · ')
        : failed > 0
          ? `${failed} recipient(s) failed to send`
          : undefined,
  };

  res.status(200).json(response);
}
