export type MessageMergeContext = {
  name?: string;
  eventName?: string;
  hostName?: string;
  hostNames?: string;
  date?: string;
  time?: string;
  location?: string;
  rsvpLink?: string;
  enneagramLink?: string;
  potluckLink?: string;
};

export const MESSAGE_MERGE_FIELDS = [
  '{name}',
  '{firstName}',
  '{eventName}',
  '{hostName}',
  '{hostNames}',
  '{date}',
  '{time}',
  '{location}',
  '{rsvpLink}',
  '{enneagramLink}',
  '{potluckLink}',
] as const;

/** "June, 06, 2026" from YYYY-MM-DD (local calendar date). */
export function formatMessageDate(dateStr?: string): string {
  if (!dateStr?.trim()) return '';
  const parts = dateStr.trim().split('-').map((part) => parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return dateStr.trim();
  }

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  const monthName = date.toLocaleDateString('en-US', { month: 'long' });
  const dayPadded = day.toString().padStart(2, '0');
  return `${monthName}, ${dayPadded}, ${year}`;
}

/** "5:00 PM" from a 24-hour "17:00" value. Leaves other text unchanged. */
export function formatMessageTime(timeStr?: string): string {
  if (!timeStr?.trim()) return '';
  const raw = timeStr.trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!match) return raw;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const ampmGiven = match[3];
  if (hours > 23 || (ampmGiven && hours > 12)) return raw;

  if (ampmGiven) {
    const isPm = ampmGiven.toLowerCase() === 'pm';
    if (hours === 12) hours = isPm ? 12 : 0;
    else if (isPm) hours += 12;
  }

  const suffix = hours >= 12 ? 'PM' : 'AM';
  let hour12 = hours % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${minutes} ${suffix}`;
}

/** "Isaiah", "Isaiah and Louis", or "Isaiah, Louis, and Marie" from host entries. */
export function formatHostNames(
  hosts: Array<{ name?: string }> | undefined,
  fallbackHostName?: string
): string {
  const names = (hosts || [])
    .map((h) => (h.name || '').trim().split(/\s+/)[0])
    .filter(Boolean);
  if (names.length === 0) {
    const single = fallbackHostName?.trim().split(/\s+/)[0];
    return single || 'your host';
  }
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** Replace `{name}`, `{firstName}`, etc. with per-recipient / event values. */
export function mergeMessageTemplate(
  template: string,
  ctx: MessageMergeContext
): string {
  const fullName = ctx.name?.trim() || '';
  const firstName = fullName.split(/\s+/)[0] || '';
  const values: Record<string, string> = {
    name: fullName || 'there',
    firstName: firstName || 'there',
    eventName: ctx.eventName?.trim() || 'the event',
    hostName: ctx.hostName?.trim() || ctx.hostNames?.trim() || 'your host',
    hostNames: ctx.hostNames?.trim() || ctx.hostName?.trim() || 'your hosts',
    date: formatMessageDate(ctx.date) || '',
    time: formatMessageTime(ctx.time) || '',
    location: ctx.location?.trim() || '',
    rsvpLink: ctx.rsvpLink?.trim() || '',
    enneagramLink: ctx.enneagramLink?.trim() || '',
    potluckLink: ctx.potluckLink?.trim() || '',
  };

  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key];
    }
    return match;
  });
}

export function buildMessageMergeContext(params: {
  name?: string;
  event?: {
    name?: string;
    hostName?: string;
    hosts?: Array<{ name?: string }>;
    date?: string;
    time?: string;
    location?: string;
  };
  inviteUrl?: string;
}): MessageMergeContext {
  const hostNames = formatHostNames(params.event?.hosts, params.event?.hostName);
  const inviteUrl = params.inviteUrl?.trim() || '';
  const baseUrl = inviteUrl.replace(/\/$/, '');
  const enneagramLink = baseUrl ? `${baseUrl}/enneagram` : '';
  const potluckLink = baseUrl ? `${baseUrl}/potluck` : '';
  return {
    name: params.name,
    eventName: params.event?.name,
    hostName: params.event?.hostName || hostNames,
    hostNames,
    date: params.event?.date,
    time: params.event?.time,
    location: params.event?.location,
    rsvpLink: inviteUrl,
    enneagramLink,
    potluckLink,
  };
}
