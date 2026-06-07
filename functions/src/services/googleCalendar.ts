import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import {
  getFrontendUrl,
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleOAuthRedirectUri,
} from '../config';
import type {
  CalendarEventLink,
  GoogleCalendarIntegration,
  GoogleCalendarStatusResponse,
  GoogleCalendarSyncResponse,
  Invitee,
} from '../types';
import { computeEventWindow, toGoogleCalendarDateTime } from '../utils/eventDateTime';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function integrationRef(uid: string) {
  return admin.firestore().doc(`hostIntegrations/${uid}`);
}

function calendarEventRef(slug: string) {
  return admin.firestore().doc(`calendarEvents/${slug}`);
}

function createOAuthClient() {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  const redirectUri = getGoogleOAuthRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('google_oauth_not_configured');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildGoogleAuthUrl(state: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: [CALENDAR_SCOPE],
    prompt: 'consent',
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  googleEmail?: string;
}> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error('missing_refresh_token');
  }

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const profile = await oauth2.userinfo.get();

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token || undefined,
    accessTokenExpiresAt: tokens.expiry_date || undefined,
    googleEmail: profile.data.email || undefined,
  };
}

export async function saveIntegration(
  uid: string,
  data: Omit<GoogleCalendarIntegration, 'connectedAt' | 'calendarId'> & {
    calendarId?: string;
  }
): Promise<void> {
  const payload: GoogleCalendarIntegration = {
    refreshToken: data.refreshToken,
    accessToken: data.accessToken,
    accessTokenExpiresAt: data.accessTokenExpiresAt,
    googleEmail: data.googleEmail,
    connectedAt: Date.now(),
    calendarId: data.calendarId || 'primary',
  };

  await integrationRef(uid).set(payload, { merge: true });
}

export async function getIntegration(
  uid: string
): Promise<GoogleCalendarIntegration | null> {
  const snap = await integrationRef(uid).get();
  if (!snap.exists) {
    return null;
  }

  return snap.data() as GoogleCalendarIntegration;
}

export async function deleteIntegration(uid: string): Promise<void> {
  await integrationRef(uid).delete();
}

export async function getCalendarStatus(
  uid: string,
  eventSlug: string
): Promise<GoogleCalendarStatusResponse> {
  const integration = await getIntegration(uid);
  if (!integration) {
    return { connected: false };
  }

  const linkSnap = await calendarEventRef(eventSlug).get();
  const link = linkSnap.exists ? (linkSnap.data() as CalendarEventLink) : null;

  return {
    connected: true,
    googleEmail: integration.googleEmail,
    synced: !!link,
    lastSyncedAt: link?.lastSyncedAt,
    attendeeCount: link?.attendeeCount,
  };
}

async function getAuthorizedClient(uid: string) {
  const integration = await getIntegration(uid);
  if (!integration?.refreshToken) {
    throw new Error('google_calendar_not_connected');
  }

  const client = createOAuthClient();
  client.setCredentials({
    refresh_token: integration.refreshToken,
    access_token: integration.accessToken,
    expiry_date: integration.accessTokenExpiresAt,
  });

  client.on('tokens', async (tokens) => {
    const updates: Partial<GoogleCalendarIntegration> = {};
    if (tokens.access_token) {
      updates.accessToken = tokens.access_token;
    }
    if (tokens.expiry_date) {
      updates.accessTokenExpiresAt = tokens.expiry_date;
    }
    if (tokens.refresh_token) {
      updates.refreshToken = tokens.refresh_token;
    }
    if (Object.keys(updates).length > 0) {
      await integrationRef(uid).set(updates, { merge: true });
    }
  });

  return { client, integration };
}

function buildEventDescription(inviteUrl?: string, description?: string): string {
  const parts: string[] = [];
  if (description?.trim()) {
    parts.push(description.trim());
  }
  if (inviteUrl?.trim()) {
    parts.push(`RSVP: ${inviteUrl.trim()}`);
  }
  return parts.join('\n\n');
}

export async function syncEventToGoogleCalendar(params: {
  uid: string;
  eventSlug: string;
  sendInvites?: boolean;
}): Promise<GoogleCalendarSyncResponse> {
  const { uid, eventSlug, sendInvites = true } = params;
  const eventSnap = await admin.firestore().doc(`events/${eventSlug}`).get();
  if (!eventSnap.exists) {
    return { ok: false, attendeeCount: 0, message: 'event_not_found' };
  }

  const event = eventSnap.data()!;
  const invitees: Invitee[] = Array.isArray(event.invitees) ? event.invitees : [];
  const attendees = invitees
    .filter((inv) => inv.email?.trim())
    .map((inv) => ({
      email: inv.email!.trim().toLowerCase(),
      displayName: inv.name?.trim() || undefined,
    }));

  if (attendees.length === 0) {
    return { ok: false, attendeeCount: 0, message: 'no_guest_emails' };
  }

  const { client, integration } = await getAuthorizedClient(uid);
  const calendar = google.calendar({ version: 'v3', auth: client });
  const window = computeEventWindow({
    date: event.date,
    time: event.time,
    endDate: event.endDate,
    endTime: event.endTime,
  });
  const { start, end } = toGoogleCalendarDateTime(window);
  const inviteUrl =
    typeof event.inviteUrl === 'string'
      ? event.inviteUrl
      : `${getFrontendUrl()}/e/${eventSlug}`;

  const requestBody = {
    summary: event.name || 'Mingle event',
    location: event.location || undefined,
    description: buildEventDescription(inviteUrl, event.description),
    start,
    end,
    attendees,
  };

  const linkSnap = await calendarEventRef(eventSlug).get();
  const existingLink = linkSnap.exists ? (linkSnap.data() as CalendarEventLink) : null;
  const sendUpdates = sendInvites ? 'all' : 'none';

  let googleEventId: string;

  if (existingLink?.googleEventId) {
    const updated = await calendar.events.patch({
      calendarId: integration.calendarId,
      eventId: existingLink.googleEventId,
      sendUpdates,
      requestBody,
    });
    googleEventId = updated.data.id || existingLink.googleEventId;
  } else {
    const created = await calendar.events.insert({
      calendarId: integration.calendarId,
      sendUpdates,
      requestBody,
    });
    googleEventId = created.data.id || '';
    if (!googleEventId) {
      return { ok: false, attendeeCount: 0, message: 'calendar_create_failed' };
    }
  }

  await calendarEventRef(eventSlug).set({
    googleEventId,
    hostUid: uid,
    lastSyncedAt: Date.now(),
    attendeeCount: attendees.length,
  } satisfies CalendarEventLink);

  return {
    ok: true,
    googleEventId,
    attendeeCount: attendees.length,
  };
}
