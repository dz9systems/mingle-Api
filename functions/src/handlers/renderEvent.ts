import type { Request, Response } from 'express';
import { getFrontendUrl } from '../config';
import { getEventBySlug } from '../services/events';
import {
  buildEventOgMeta,
  buildFallbackOgMeta,
  injectOgMeta,
  type OgMeta,
} from '../utils/ogMeta';

const SHELL_TTL_MS = 5 * 60 * 1000;

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

async function fetchSpaShell(frontendUrl: string): Promise<string> {
  const now = Date.now();
  if (cachedShell && now - cachedShell.fetchedAt < SHELL_TTL_MS) {
    return cachedShell.html;
  }

  try {
    const response = await fetch(`${frontendUrl}/index.html`, {
      headers: { Accept: 'text/html' },
    });

    if (!response.ok) {
      throw new Error(`spa_shell_status_${response.status}`);
    }

    const html = await response.text();
    cachedShell = { html, fetchedAt: now };
    return html;
  } catch (error) {
    if (cachedShell) {
      console.warn('renderEvent: using stale SPA shell cache', error);
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

    const meta: OgMeta = event
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
