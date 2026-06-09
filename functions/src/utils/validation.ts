import type { BulkSendEvent, BulkSendRequest } from '../types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateBulkSendRequest(
  body: unknown,
  channel: 'email' | 'sms'
): { ok: true; data: BulkSendRequest } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'invalid_body' };
  }

  const payload = body as Partial<BulkSendRequest>;

  if (payload.channel !== channel) {
    return { ok: false, message: 'invalid_channel' };
  }

  if (!Array.isArray(payload.recipients) || payload.recipients.length === 0) {
    return { ok: false, message: 'recipients_required' };
  }

  const event = payload.event;
  if (!event || typeof event !== 'object') {
    return { ok: false, message: 'event_required' };
  }

  const eventData = event as Partial<BulkSendEvent>;
  if (!eventData.slug || typeof eventData.slug !== 'string') {
    return { ok: false, message: 'event_slug_required' };
  }
  if (!eventData.name || typeof eventData.name !== 'string') {
    return { ok: false, message: 'event_name_required' };
  }
  if (!eventData.inviteUrl || typeof eventData.inviteUrl !== 'string') {
    return { ok: false, message: 'invite_url_required' };
  }

  const recipients = payload.recipients.map((recipient) => ({
    name: String(recipient?.name || '').trim(),
    email: recipient?.email ? String(recipient.email).trim() : undefined,
    phone: recipient?.phone ? String(recipient.phone).trim() : undefined,
  }));

  if (recipients.some((r) => !r.name)) {
    return { ok: false, message: 'recipient_name_required' };
  }

  return {
    ok: true,
    data: {
      channel,
      recipients,
      event: {
        slug: eventData.slug,
        name: eventData.name,
        hostName: eventData.hostName,
        hosts: Array.isArray((event as { hosts?: unknown }).hosts)
          ? (event as { hosts: Array<{ name?: string }> }).hosts
              .map((h) => ({ name: String(h?.name || '').trim() }))
              .filter((h) => h.name)
          : undefined,
        date: eventData.date,
        time: eventData.time,
        location: eventData.location,
        inviteUrl: eventData.inviteUrl,
      },
      customMessage:
        typeof payload.customMessage === 'string'
          ? payload.customMessage
          : undefined,
    },
  };
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function digitsOnlyPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function throttle<T>(
  items: T[],
  perSecond: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const delayMs = Math.ceil(1000 / perSecond);
  for (const item of items) {
    await fn(item);
    if (items.indexOf(item) < items.length - 1) {
      await sleep(delayMs);
    }
  }
}
