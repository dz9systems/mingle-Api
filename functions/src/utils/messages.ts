import type { BulkSendEvent } from '../types';
import { formatHostNames, mergeMessageTemplate } from './messageMerge';

type MessageParams = {
  event: BulkSendEvent;
  channel: 'email' | 'sms';
  recipientName?: string;
  customMessage?: string;
};

function formatSmsEventDetails(event: BulkSendEvent): string {
  const whenParts: string[] = [];
  if (event.date?.trim()) whenParts.push(event.date.trim());
  if (event.time?.trim()) whenParts.push(event.time.trim());

  const when = whenParts.join(', ');
  const location = event.location?.trim();

  if (when && location) return ` — ${when}, ${location}`;
  if (when) return ` — ${when}`;
  if (location) return ` in ${location}`;
  return '';
}

function defaultSmsInviteMessage(params: MessageParams): string {
  const { event, recipientName } = params;
  const greeting = recipientName?.trim() ? `Hi ${recipientName.trim()}! ` : '';
  const details = formatSmsEventDetails(event);

  return `${greeting}You're invited to ${event.name}${details}. RSVP: ${event.inviteUrl}`;
}

function appendRsvpLinkIfMissing(body: string, inviteUrl: string): string {
  if (!inviteUrl || body.includes(inviteUrl)) {
    return body;
  }
  const separator =
    body.endsWith('.') || body.endsWith('!') || body.endsWith('?') ? ' ' : '. ';
  return `${body}${separator}RSVP: ${inviteUrl}`;
}

export function defaultInviteMessage(params: MessageParams): string {
  const { event, channel } = params;

  if (channel === 'sms') {
    return defaultSmsInviteMessage(params);
  }

  const host = event.hostName || 'Your friend';
  const lines: string[] = [];
  const greeting = params.recipientName ? `Hi ${params.recipientName}!` : 'Hi!';
  lines.push(
    `${greeting} ${host} is hosting ${event.name} and would love to have you there.`
  );

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

function mergeContextFromParams(params: MessageParams) {
  const hostNames = formatHostNames(params.event.hosts, params.event.hostName);
  return {
    name: params.recipientName,
    eventName: params.event.name,
    hostName: params.event.hostName || hostNames,
    hostNames,
    date: params.event.date,
    time: params.event.time,
    location: params.event.location,
    rsvpLink: params.event.inviteUrl,
  };
}

export function resolveMessageBody(params: MessageParams): string {
  const trimmed = params.customMessage?.trim();
  if (trimmed) {
    const merged = mergeMessageTemplate(trimmed, mergeContextFromParams(params));
    if (params.channel === 'sms') {
      return appendRsvpLinkIfMissing(merged, params.event.inviteUrl);
    }
    return merged;
  }
  return defaultInviteMessage(params);
}

export function buildEmailHtml(params: {
  event: BulkSendEvent;
  recipientName: string;
  bodyText: string;
  skipGreeting?: boolean;
}): string {
  const { event, recipientName, bodyText, skipGreeting } = params;
  const paragraphs = bodyText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `<p style="margin:0 0 12px;line-height:1.5;">${escapeHtml(line)}</p>`)
    .join('');

  const greetingBlock = skipGreeting
    ? ''
    : `<p style="margin:0 0 16px;">Hi ${escapeHtml(recipientName)},</p>`;

  return `<!DOCTYPE html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;">
    ${greetingBlock}
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
