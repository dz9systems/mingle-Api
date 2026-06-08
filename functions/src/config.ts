import * as fs from 'fs';
import * as path from 'path';

type RuntimeConfig = Record<string, Record<string, string>>;

let cachedRuntimeConfig: RuntimeConfig | null | undefined;

function loadEnvFile(filePath: string, override: boolean): void {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) continue;

    if (override || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadLocalEnvFiles(): void {
  const envDir = path.join(__dirname, '..');
  const overrideInEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

  loadEnvFile(path.join(envDir, '.env'), overrideInEmulator);
  loadEnvFile(path.join(envDir, '.secret.local'), overrideInEmulator);
}

loadLocalEnvFiles();

function loadRuntimeConfig(): RuntimeConfig {
  if (cachedRuntimeConfig !== undefined) {
    return cachedRuntimeConfig || {};
  }

  const candidates = [
    path.join(__dirname, '..', '.runtimeconfig.json'),
    path.join(process.cwd(), '.runtimeconfig.json'),
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        cachedRuntimeConfig = JSON.parse(
          fs.readFileSync(filePath, 'utf8')
        ) as RuntimeConfig;
        return cachedRuntimeConfig;
      }
    } catch {
      // Fall through to empty config.
    }
  }

  cachedRuntimeConfig = null;
  return {};
}

function configValue(section: string, key: string): string | undefined {
  const envKey = `${section.toUpperCase()}_${key.toUpperCase()}`;
  if (process.env[envKey]) {
    return process.env[envKey];
  }

  const runtime = loadRuntimeConfig();
  return runtime[section]?.[key];
}

export function getResendApiKey(): string {
  return process.env.RESEND_API_KEY || configValue('resend', 'api_key') || '';
}

export function getResendFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL ||
    configValue('resend', 'from_email') ||
    'Mingle <invites@mail.mingle.app>'
  );
}

export function getResendReplyToEmail(): string {
  return process.env.RESEND_REPLY_TO || configValue('resend', 'reply_to') || '';
}

export function getTwilioAccountSid(): string {
  return process.env.TWILIO_ACCOUNT_SID || configValue('twilio', 'account_sid') || '';
}

export function getTwilioAuthToken(): string {
  return process.env.TWILIO_AUTH_TOKEN || configValue('twilio', 'auth_token') || '';
}

export function getTwilioMessagingServiceSid(): string {
  return (
    process.env.TWILIO_MESSAGING_SERVICE_SID ||
    configValue('twilio', 'messaging_service_sid') ||
    ''
  );
}

export function getTwilioFromNumber(): string {
  return process.env.TWILIO_FROM_NUMBER || configValue('twilio', 'from_number') || '';
}

export function getRateLimitConfig() {
  return {
    emailPerHour: parseInt(
      process.env.RATELIMIT_EMAIL_PER_HOUR ||
        configValue('ratelimit', 'email_per_hour') ||
        '500',
      10
    ),
    emailPerDay: parseInt(
      process.env.RATELIMIT_EMAIL_PER_DAY ||
        configValue('ratelimit', 'email_per_day') ||
        '2000',
      10
    ),
    smsPerHour: parseInt(
      process.env.RATELIMIT_SMS_PER_HOUR ||
        configValue('ratelimit', 'sms_per_hour') ||
        '200',
      10
    ),
    smsPerDay: parseInt(
      process.env.RATELIMIT_SMS_PER_DAY ||
        configValue('ratelimit', 'sms_per_day') ||
        '500',
      10
    ),
    ipPerHour: parseInt(
      process.env.RATELIMIT_IP_PER_HOUR ||
        configValue('ratelimit', 'ip_per_hour') ||
        '60',
      10
    ),
  };
}

export function getAllowedOrigins(): string[] {
  const raw =
    process.env.CORS_ALLOWED_ORIGINS ||
    configValue('cors', 'allowed_origins') ||
    'http://localhost:5173';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || configValue('google', 'client_id') || '';
}

export function getGoogleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || configValue('google', 'client_secret') || '';
}

export function getGoogleOAuthRedirectUri(): string {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    if (process.env.GOOGLE_OAUTH_LOCAL_REDIRECT_URI) {
      return process.env.GOOGLE_OAUTH_LOCAL_REDIRECT_URI;
    }

    return `${getFrontendUrl()}/api/integrations/google/calendar/callback`;
  }

  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    configValue('google', 'oauth_redirect_uri') ||
    ''
  );
}

export function getGoogleOAuthStateSecret(): string {
  return (
    process.env.GOOGLE_OAUTH_STATE_SECRET ||
    configValue('google', 'oauth_state_secret') ||
    getGoogleClientSecret() ||
    'dev-oauth-state-secret'
  );
}

export function getSpotifyClientId(): string {
  return process.env.SPOTIFY_CLIENT_ID || configValue('spotify', 'client_id') || '';
}

export function getSpotifyClientSecret(): string {
  return process.env.SPOTIFY_CLIENT_SECRET || configValue('spotify', 'client_secret') || '';
}

export function getFrontendUrl(): string {
  const explicit =
    process.env.FRONTEND_URL || configValue('frontend', 'url') || '';
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const allowed = getAllowedOrigins();
  const production = allowed.find((origin) => origin.startsWith('https://'));
  return (production || allowed[0] || 'http://localhost:5173').replace(/\/$/, '');
}
