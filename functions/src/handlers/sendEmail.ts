import type { Request, Response } from 'express';
import type { BulkSendResponse, BulkRecipient, SendOutcome } from '../types';
import { verifyHostAuth } from '../middleware/auth';
import { applyCors, getClientIp } from '../middleware/cors';
import { updateInviteeTracking } from '../services/invitees';
import { sendEmailToRecipient } from '../services/resend';
import { checkRateLimits } from '../utils/rateLimit';
import {
  isValidEmail,
  normalizeEmail,
  throttle,
  validateBulkSendRequest,
} from '../utils/validation';

export async function handleSendEmail(req: Request, res: Response): Promise<void> {
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

  const parsed = validateBulkSendRequest(req.body, 'email');
  if (!parsed.ok) {
    res.status(400).send(parsed.message);
    return;
  }

  const { data } = parsed;
  const validRecipients: BulkRecipient[] = [];
  let skipped = 0;

  for (const recipient of data.recipients) {
    if (!recipient.email || !isValidEmail(recipient.email)) {
      skipped += 1;
      continue;
    }
    validRecipients.push({
      ...recipient,
      email: normalizeEmail(recipient.email),
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
    'email',
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
      const outcome = await sendEmailToRecipient({
        recipient,
        event: data.event,
        customMessage: data.customMessage,
        hostUid: auth.uid,
        hostEmail: auth.email,
      });
      outcomes.push(outcome);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal_error';
    res.status(500).send(message);
    return;
  }

  await updateInviteeTracking(data.event.slug, 'email', outcomes);

  const sent = outcomes.filter((o) => o.success).length;
  const failed = outcomes.filter((o) => !o.success).length;

  const response: BulkSendResponse = {
    ok: failed === 0,
    sent,
    failed,
    skipped,
    message: failed > 0 ? `${failed} recipient(s) failed to send` : undefined,
  };

  res.status(200).json(response);
}
