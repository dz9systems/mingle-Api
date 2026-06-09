export type MessageMergeContext = {
  name?: string;
  eventName?: string;
  hostName?: string;
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
  '{date}',
  '{time}',
  '{location}',
  '{rsvpLink}',
] as const;

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
    hostName: ctx.hostName?.trim() || 'your host',
    date: ctx.date?.trim() || '',
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
