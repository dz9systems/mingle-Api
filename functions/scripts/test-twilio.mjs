/**
 * Quick Twilio diagnostic. Usage:
 *   node scripts/test-twilio.mjs +15551234567
 *
 * Loads functions/.env automatically (same keys as production).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error('Missing .env at', filePath);
    process.exit(1);
  }
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(envPath);

const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
const to = process.argv[2];

console.log('Twilio config check:');
console.log('  TWILIO_ACCOUNT_SID:', accountSid ? `${accountSid.slice(0, 6)}...` : 'MISSING');
console.log('  TWILIO_AUTH_TOKEN:', authToken ? 'set' : 'MISSING');
console.log(
  '  TWILIO_MESSAGING_SERVICE_SID:',
  messagingServiceSid ? messagingServiceSid : 'MISSING'
);

if (!accountSid || !authToken || !messagingServiceSid) {
  console.error('\nFix missing values in functions/.env');
  process.exit(1);
}

if (!to) {
  console.log('\nNo test number provided. Config looks OK.');
  console.log('Run: node scripts/test-twilio.mjs +1YOUR_VERIFIED_NUMBER');
  process.exit(0);
}

const client = twilio(accountSid, authToken);

try {
  const message = await client.messages.create({
    to,
    messagingServiceSid,
    body: 'Mingle test SMS — if you got this, Twilio is working.',
  });
  console.log('\nSuccess!');
  console.log('  SID:', message.sid);
  console.log('  Status:', message.status);
  console.log('  To:', message.to);
} catch (error) {
  console.error('\nTwilio send failed:');
  if (error && typeof error === 'object') {
    const e = error;
    if (e.code) console.error('  Code:', e.code);
    if (e.message) console.error('  Message:', e.message);
    if (e.moreInfo) console.error('  More info:', e.moreInfo);
  } else {
    console.error(' ', error);
  }
  process.exit(1);
}
