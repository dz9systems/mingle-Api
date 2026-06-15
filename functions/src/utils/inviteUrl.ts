/** Extract event slug from an invite URL embedded in message text (e.g. …/e/my-event). */
export function extractEventSlugFromInviteUrl(text: string): string | null {
  const match = text.match(/\/e\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}
