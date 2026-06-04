import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { handleSendEmail } from './handlers/sendEmail';
import { handleSendSms } from './handlers/sendSms';
import { resetStaleRateLimitBuckets } from './utils/rateLimit';

admin.initializeApp();

const runtimeOptions = {
  region: 'us-central1',
  cors: false,
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: '512MiB' as const,
};

export const sendEmail = onRequest(runtimeOptions, handleSendEmail);
export const sendSms = onRequest(runtimeOptions, handleSendSms);

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
