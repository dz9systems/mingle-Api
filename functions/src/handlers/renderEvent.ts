import type { Request, Response } from 'express';
import { getFrontendUrl } from '../config';
import { getEventBySlug } from '../services/events';
import { isEventPublished } from '../utils/eventStatus';
import {
  buildEventOgMeta,
  buildFallbackOgMeta,
  injectOgMeta,
  type OgMeta,
} from '../utils/ogMeta';

/** How long a validated shell may be reused before re-fetching index.html. */
const SHELL_TTL_MS = 60 * 1000;

/** Max age for serving a cached shell when the network fetch fails. */
const STALE_FALLBACK_MAX_MS = 5 * 60 * 1000;

let cachedShell: { html: string; fetchedAt: number } | null = null;

function parseEventSlug(pathname: string): string | null {
  const match = pathname.match(/^\/e\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function buildCanonicalUrl(req: Request, frontendUrl: string): string {
  const path = req.path || '/';
  const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return `${frontendUrl}${path}${query}`;
}

function extractModuleScriptSrc(html: string): string | null {
  const match =
    html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i) ||
    html.match(/<script[^>]*src=["']([^"']+)["'][^>]*type=["']module["']/i);
  return match?.[1] ?? null;
}

function resolveAssetUrl(frontendUrl: string, scriptSrc: string): string {
  if (scriptSrc.startsWith('http://') || scriptSrc.startsWith('https://')) {
    return scriptSrc;
  }
  return `${frontendUrl}${scriptSrc.startsWith('/') ? scriptSrc : `/${scriptSrc}`}`;
}

async function isScriptBundleLive(frontendUrl: string, html: string): Promise<boolean> {
  const scriptSrc = extractModuleScriptSrc(html);
  if (!scriptSrc) return false;

  try {
    const response = await fetch(resolveAssetUrl(frontendUrl, scriptSrc), {
      method: 'HEAD',
      cache: 'no-store',
    });
    if (!response.ok) return false;

    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('javascript') || contentType.includes('ecmascript');
  } catch {
    return false;
  }
}

async function fetchSpaShellFromNetwork(frontendUrl: string): Promise<string> {
  const response = await fetch(`${frontendUrl}/index.html`, {
    headers: { Accept: 'text/html' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`spa_shell_status_${response.status}`);
  }

  const html = await response.text();
  if (!(await isScriptBundleLive(frontendUrl, html))) {
    throw new Error('spa_shell_invalid_script');
  }

  return html;
}

async function fetchSpaShell(frontendUrl: string): Promise<string> {
  const now = Date.now();

  if (cachedShell && now - cachedShell.fetchedAt < SHELL_TTL_MS) {
    if (await isScriptBundleLive(frontendUrl, cachedShell.html)) {
      return cachedShell.html;
    }
    console.warn('renderEvent: cached SPA shell has stale asset hash, refetching');
    cachedShell = null;
  }

  try {
    const html = await fetchSpaShellFromNetwork(frontendUrl);
    cachedShell = { html, fetchedAt: now };
    return html;
  } catch (error) {
    if (cachedShell && now - cachedShell.fetchedAt < STALE_FALLBACK_MAX_MS) {
      console.warn('renderEvent: using stale SPA shell cache after fetch failure', error);
      return cachedShell.html;
    }
    throw error;
  }
}

export async function handleRenderEvent(req: Request, res: Response): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const slug = parseEventSlug(req.path || '/');
  if (!slug) {
    res.status(404).send('not_found');
    return;
  }

  const frontendUrl = getFrontendUrl();
  const canonicalUrl = buildCanonicalUrl(req, frontendUrl);

  try {
    const [event, shellHtml] = await Promise.all([
      getEventBySlug(slug),
      fetchSpaShell(frontendUrl),
    ]);

    const meta: OgMeta = event && isEventPublished(event)
      ? buildEventOgMeta(event, canonicalUrl)
      : buildFallbackOgMeta(canonicalUrl, frontendUrl);

    const html = injectOgMeta(shellHtml, meta);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(event ? 200 : 404);

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    res.send(html);
  } catch (error) {
    console.error('renderEvent failed', { slug, error });
    res.status(500).send('render_event_failed');
  }
}
