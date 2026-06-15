export type EventStatus = 'draft' | 'published';

export function resolveEventStatus(data: { status?: string } | null | undefined): EventStatus {
  if (!data?.status || data.status === 'published') return 'published';
  return 'draft';
}

export function isEventPublished(data: { status?: string } | null | undefined): boolean {
  return resolveEventStatus(data) === 'published';
}
