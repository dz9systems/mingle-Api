import type { BulkSendEvent } from '../types';

type MessageParams = {
  event: BulkSendEvent;
  channel: 'email' | 'sms';
  recipientName?: string;
  customMessage?: string;
};

export function defaultInviteMessage(params: MessageParams): string {
  const { event, channel } = params;
  const host = event.hostName || 'Your friend';
  const lines: string[] = [];

  if (channel === 'sms') {
    lines.push(`${host} is hosting ${event.name}.`);
  } else {
    const greeting = params.recipientName ? `Hi ${params.recipientName}!` : 'Hi!';
    lines.push(`${greeting} ${event.hostName || 'Your friend'} is hosting ${event.name} and would love to have you there.`);
  }

  if (event.date || event.time) {
    lines.push(
      `${event.date || ''}${event.date && event.time ? ' · ' : ''}${event.time || ''}`.trim()
    );
  }

  if (event.location) {
    lines.push(event.location);
  }

  lines.push('');
  lines.push(`RSVP: ${event.inviteUrl}`);

  return lines.join('\n');
}

export function resolveMessageBody(params: MessageParams): string {
  const trimmed = params.customMessage?.trim();
  if (trimmed) {
    return trimmed;
  }
  return defaultInviteMessage(params);
}

export function buildEmailHtml(params: {
  event: BulkSendEvent;
  recipientName: string;
  bodyText: string;
}): string {
  const { event, recipientName, bodyText } = params;
  const paragraphs = bodyText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `<p style="margin:0 0 12px;line-height:1.5;">${escapeHtml(line)}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;">
    <p style="margin:0 0 16px;">Hi ${escapeHtml(recipientName)},</p>
    ${paragraphs}
    <p style="margin:24px 0;">
      <a href="${escapeHtml(event.inviteUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">
        View event &amp; RSVP
      </a>
    </p>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
