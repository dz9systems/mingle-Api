import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  handleGoogleCalendarCallback,
  handleGoogleCalendarConnect,
  handleGoogleCalendarDisconnect,
  handleGoogleCalendarStatus,
  handleGoogleCalendarSync,
} from './handlers/googleCalendar';
import { handleSendEmail } from './handlers/sendEmail';
import { handleSendSms } from './handlers/sendSms';
import { handleSpotifySearch } from './handlers/spotifySearch';
import { resetStaleRateLimitBuckets } from './utils/rateLimit';

admin.initializeApp();
admin.firestore().settings({ ignoreUndefinedProperties: true });

const runtimeOptions = {
  region: 'us-central1',
  cors: false,
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: '512MiB' as const,
  secrets: [
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'RESEND_REPLY_TO',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_MESSAGING_SERVICE_SID',
    'TWILIO_FROM_NUMBER',
    'CORS_ALLOWED_ORIGINS',
    'FRONTEND_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URI',
    'GOOGLE_OAUTH_STATE_SECRET',
    'SPOTIFY_CLIENT_ID',
    'SPOTIFY_CLIENT_SECRET',
  ],
};

export const sendEmail = onRequest(runtimeOptions, handleSendEmail);
export const sendSms = onRequest(runtimeOptions, handleSendSms);

export const googleCalendarConnect = onRequest(runtimeOptions, handleGoogleCalendarConnect);
export const googleCalendarCallback = onRequest(runtimeOptions, handleGoogleCalendarCallback);
export const googleCalendarStatus = onRequest(runtimeOptions, handleGoogleCalendarStatus);
export const googleCalendarDisconnect = onRequest(
  runtimeOptions,
  handleGoogleCalendarDisconnect
);
export const googleCalendarSync = onRequest(runtimeOptions, handleGoogleCalendarSync);

export const spotifySearch = onRequest(runtimeOptions, handleSpotifySearch);

export const resetRateLimits = onSchedule(
  {
    schedule: 'every 60 minutes',
    region: 'us-central1',
    timeZone: 'America/Los_Angeles',
  },
  async () => {
    const resetCount = await resetStaleRateLimitBuckets();
    console.info(`resetRateLimits: normalized ${resetCount} bucket(s)`);
  }
);
