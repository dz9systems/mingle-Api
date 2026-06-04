import * as fs from 'fs';
import * as path from 'path';

type RuntimeConfig = Record<string, Record<string, string>>;

let cachedRuntimeConfig: RuntimeConfig | null | undefined;

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
