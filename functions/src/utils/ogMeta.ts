import type { EventRecord } from '../services/events';

const DEFAULT_COVER_IMAGE =
  'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?q=80&w=2940&auto=format&fit=crop';

export type OgMeta = {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  url: string;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatTime12(time?: string): string {
  if (!time) return '';
  const match = time.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time.trim();

  let hour = parseInt(match[1], 10);
  const minute = match[2];
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${ampm}`;
}

function formatEventDate(dateStr?: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map((part) => parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return dateStr;
  }

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildEventDescription(event: EventRecord): string {
  if (typeof event.description === 'string' && event.description.trim()) {
    return truncate(event.description.trim(), 200);
  }

  const parts: string[] = [];
  const dateLabel = formatEventDate(event.date);
  const timeLabel = formatTime12(event.time);

  if (dateLabel) {
    parts.push(timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel);
  } else if (timeLabel) {
    parts.push(timeLabel);
  }

  if (event.location?.trim()) {
    parts.push(event.location.trim());
  }

  if (parts.length > 0) {
    return truncate(parts.join(' · '), 200);
  }

  return 'RSVP, potluck, music, and more — all in one link.';
}

export function buildEventOgMeta(event: EventRecord, canonicalUrl: string): OgMeta {
  const name = event.name?.trim() || 'Event';
  const image =
    typeof event.coverImage === 'string' && event.coverImage.startsWith('http')
      ? event.coverImage
      : DEFAULT_COVER_IMAGE;

  return {
    title: `${name} · Mingle`,
    description: buildEventDescription(event),
    image,
    imageAlt: `${name} on Mingle`,
    url: canonicalUrl,
  };
}

export function buildFallbackOgMeta(canonicalUrl: string, frontendUrl: string): OgMeta {
  return {
    title: 'Event not found · Mingle',
    description: 'We could not find an event at this link.',
    image: `${frontendUrl}/og-image.png`,
    imageAlt: 'Mingle — party hosting with one link for RSVPs, potluck, music, and more',
    url: canonicalUrl,
  };
}

export function buildMetaTags(meta: OgMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = escapeHtml(meta.image);
  const imageAlt = escapeHtml(meta.imageAlt);
  const url = escapeHtml(meta.url);

  return `
    <meta name="description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${url}" />
    <meta property="og:site_name" content="Mingle" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:alt" content="${imageAlt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${image}" />`;
}

export function injectOgMeta(shellHtml: string, meta: OgMeta): string {
  let html = shellHtml;

  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);
  html = html.replace(/<meta[^>]*name="description"[^>]*>\s*/i, '');
  html = html.replace(/<meta[^>]*property="og:[^"]*"[^>]*>\s*/gi, '');
  html = html.replace(/<meta[^>]*name="twitter:[^"]*"[^>]*>\s*/gi, '');

  return html.replace(/<\/head>/i, `${buildMetaTags(meta)}\n  </head>`);
}
