export type MessageMergeContext = {
  name?: string;
  eventName?: string;
  hostName?: string;
  hostNames?: string;
  date?: string;
  time?: string;
  location?: string;
  rsvpLink?: string;
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
    time: ctx.time?.trim() || '',
    location: ctx.location?.trim() || '',
    rsvpLink: ctx.rsvpLink?.trim() || '',
  };

  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key];
    }
    return match;
  });
}
