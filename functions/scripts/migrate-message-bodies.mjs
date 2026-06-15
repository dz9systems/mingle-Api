/**
 * Backfill message body text on events/{slug}/messageLog from Twilio and Resend.
 *
 * Usage:
 *   node scripts/migrate-message-bodies.mjs --dry-run
 *   node scripts/migrate-message-bodies.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
import { Resend } from 'resend';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envDir = path.join(__dirname, '..');

for (const file of ['.env', '.secret.local']) {
  const filePath = path.join(envDir, file);
  if (!fs.existsSync(filePath)) continue;
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

const dryRun = process.argv.includes('--dry-run');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;
const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const stats = {
  scanned: 0,
  smsUpdated: 0,
  emailUpdated: 0,
  skippedHasBody: 0,
  skippedNoProvider: 0,
  failed: 0,
};

async function listEventSlugsWithMessageLogs() {
  const slugs = new Set();
  const eventsSnap = await db.collection('events').get();
  for (const eventDoc of eventsSnap.docs) {
    const messageLogSnap = await eventDoc.ref.collection('messageLog').limit(1).get();
    if (!messageLogSnap.empty) {
      slugs.add(eventDoc.id);
    }
  }
  return [...slugs];
}

async function backfillSmsBody(docRef, data) {
  if (!twilioClient || !data.twilioSid) {
    stats.skippedNoProvider += 1;
    return;
  }

  const msg = await twilioClient.messages(data.twilioSid).fetch();
  const body = msg.body?.trim();
  if (!body) {
    stats.skippedNoProvider += 1;
    return;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}sms ${docRef.path}: body (${body.length} chars)`);
  if (!dryRun) {
    await docRef.update({ body });
  }
  stats.smsUpdated += 1;
}

async function backfillEmailBody(docRef, data) {
  if (!resendClient || !data.resendId) {
    stats.skippedNoProvider += 1;
    return;
  }

  const result = await resendClient.emails.get(data.resendId);
  const body = result.data?.text?.trim() || result.data?.html?.trim();
  if (!body) {
    stats.skippedNoProvider += 1;
    return;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}email ${docRef.path}: body (${body.length} chars)`);
  if (!dryRun) {
    await docRef.update({ body });
  }
  stats.emailUpdated += 1;
}

console.log(`Message body backfill${dryRun ? ' (dry run)' : ''}`);

const slugs = await listEventSlugsWithMessageLogs();
console.log(`Events with messageLog: ${slugs.length}`);

for (const slug of slugs) {
  const snap = await db.collection(`events/${slug}/messageLog`).get();
  for (const doc of snap.docs) {
    stats.scanned += 1;
    const data = doc.data();
    const existingBody = typeof data.body === 'string' ? data.body.trim() : '';
    if (existingBody) {
      stats.skippedHasBody += 1;
      continue;
    }

    try {
      if (data.channel === 'email') {
        await backfillEmailBody(doc.ref, data);
      } else {
        await backfillSmsBody(doc.ref, data);
      }
    } catch (error) {
      stats.failed += 1;
      console.error(`Failed ${doc.ref.path}:`, error);
    }
  }
}

console.log('\nSummary:');
console.log(`  scanned:             ${stats.scanned}`);
console.log(`  sms bodies updated:  ${stats.smsUpdated}`);
console.log(`  email bodies updated:${stats.emailUpdated}`);
console.log(`  skipped (has body):  ${stats.skippedHasBody}`);
console.log(`  skipped (no provider):${stats.skippedNoProvider}`);
console.log(`  failed:              ${stats.failed}`);

if (dryRun) {
  console.log('\nRe-run without --dry-run to apply changes.');
}
