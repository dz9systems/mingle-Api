import type { Request, Response } from 'express';
import { getFrontendUrl, getGoogleOAuthRedirectUri } from '../config';
import { applyCors } from '../middleware/cors';
import { verifyFirebaseAuth, verifyHostAuthForSlug } from '../middleware/auth';
import {
  buildGoogleAuthUrl,
  deleteIntegration,
  exchangeCodeForTokens,
  getCalendarStatus,
  saveIntegration,
  syncEventToGoogleCalendar,
} from '../services/googleCalendar';
import { createOAuthState, verifyOAuthState } from '../utils/oauthState';

function resolveReturnPath(eventSlug: string, raw?: unknown): string {
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.includes('://')) {
    return raw;
  }
  return `/e/${eventSlug}#guests`;
}

function appendSearchParam(path: string, key: string, value: string): string {
  const hashIdx = path.indexOf('#');
  const hash = hashIdx === -1 ? '' : path.slice(hashIdx);
  const base = hashIdx === -1 ? path : path.slice(0, hashIdx);
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}${key}=${encodeURIComponent(value)}${hash}`;
}

function redirectWithCalendarResult(
  res: Response,
  base: string,
  returnPath: string,
  result: 'connected' | 'error',
  reason?: string
): void {
  let path = appendSearchParam(returnPath, 'calendar', result);
  if (reason) {
    path = appendSearchParam(path, 'reason', reason);
  }
  res.redirect(`${base}${path}`);
}

export async function handleGoogleCalendarConnect(
  req: Request,
  res: Response
): Promise<void> {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const body = req.body as { eventSlug?: string; returnPath?: string } | undefined;
  const eventSlug = body?.eventSlug;
  if (!eventSlug || typeof eventSlug !== 'string') {
    res.status(400).send('missing_event_slug');
    return;
  }

  const auth = await verifyHostAuthForSlug(req, res, eventSlug);
  if (!auth) {
    return;
  }

  try {
    const returnPath = resolveReturnPath(eventSlug, body?.returnPath);
    const state = createOAuthState({
      uid: auth.uid,
      eventSlug,
      returnPath,
    });
    const authUrl = buildGoogleAuthUrl(state);
    const redirectUri = getGoogleOAuthRedirectUri();
    res.status(200).json({ authUrl, redirectUri });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal_error';
    res.status(500).send(message);
  }
}

export async function handleGoogleCalendarCallback(
  req: Request,
  res: Response
): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

  const fallbackReturn = '/host';
  const payload = state ? verifyOAuthState(state) : null;
  const returnPath = payload?.returnPath || fallbackReturn;
  const base = getFrontendUrl();

  if (oauthError) {
    redirectWithCalendarResult(res, base, returnPath, 'error', oauthError);
    return;
  }

  if (!code || !payload) {
    redirectWithCalendarResult(res, base, returnPath, 'error', 'invalid_state');
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveIntegration(payload.uid, {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      googleEmail: tokens.googleEmail,
    });
    redirectWithCalendarResult(res, base, returnPath, 'connected');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'oauth_failed';
    redirectWithCalendarResult(res, base, returnPath, 'error', reason);
  }
}

export async function handleGoogleCalendarStatus(
  req: Request,
  res: Response
): Promise<void> {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const eventSlug =
    typeof req.query.eventSlug === 'string' ? req.query.eventSlug : '';
  if (!eventSlug) {
    res.status(400).send('missing_event_slug');
    return;
  }

  const auth = await verifyHostAuthForSlug(req, res, eventSlug);
  if (!auth) {
    return;
  }

  try {
    const status = await getCalendarStatus(auth.uid, eventSlug);
    res.status(200).json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal_error';
    res.status(500).send(message);
  }
}

export async function handleGoogleCalendarDisconnect(
  req: Request,
  res: Response
): Promise<void> {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const auth = await verifyFirebaseAuth(req, res);
  if (!auth) {
    return;
  }

  try {
    await deleteIntegration(auth.uid);
    res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal_error';
    res.status(500).send(message);
  }
}

export async function handleGoogleCalendarSync(
  req: Request,
  res: Response
): Promise<void> {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const body = req.body as {
    eventSlug?: string;
    sendInvites?: boolean;
  } | undefined;
  const eventSlug = body?.eventSlug;
  if (!eventSlug || typeof eventSlug !== 'string') {
    res.status(400).send('missing_event_slug');
    return;
  }

  const auth = await verifyHostAuthForSlug(req, res, eventSlug);
  if (!auth) {
    return;
  }

  try {
    const result = await syncEventToGoogleCalendar({
      uid: auth.uid,
      eventSlug,
      sendInvites: body?.sendInvites !== false,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal_error';
    const status = message === 'google_calendar_not_connected' ? 400 : 500;
    res.status(status).send(message);
  }
}
