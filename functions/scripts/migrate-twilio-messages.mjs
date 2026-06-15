/**
 * Backfill events/{slug}/messageLog from Twilio outbound SMS history.
 *
 * Usage:
 *   node scripts/migrate-twilio-messages.mjs --dry-run
 *   node scripts/migrate-twilio-messages.mjs --limit 50
 *   node scripts/migrate-twilio-messages.mjs --backfill-invitees
 *
 * Requires Twilio creds in functions/.env + functions/.secret.local and
 * Firebase Admin credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud auth).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';
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

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const backfillInvitees = args.includes('--backfill-invitees');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limitFlagIndex = args.indexOf('--limit');
const limit =
  limitArg != null
    ? parseInt(limitArg.split('=')[1], 10)
    : limitFlagIndex !== -1
      ? parseInt(args[limitFlagIndex + 1], 10)
      : Infinity;

const SUCCESS_STATUSES = new Set(['queued', 'accepted', 'sending', 'sent', 'delivered']);

function extractEventSlugFromInviteUrl(text) {
  const match = String(text || '').match(/\/e\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function digitsOnlyPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function resolveHostUid(eventData) {
  if (typeof eventData.hostId === 'string' && eventData.hostId) {
    return eventData.hostId;
  }
  if (Array.isArray(eventData.hostIds) && eventData.hostIds.length > 0) {
    return eventData.hostIds[0];
  }
  return 'unknown';
}

function findInviteeName(invitees, phone) {
  const target = digitsOnlyPhone(phone);
  if (!target) return 'Unknown';
  for (const invitee of invitees) {
    if (invitee?.phone && digitsOnlyPhone(invitee.phone) === target) {
      return invitee.name || 'Unknown';
    }
  }
  return 'Unknown';
}

function formatTwilioError(msg) {
  if (msg.errorCode) {
    return `[${msg.errorCode}] ${msg.errorMessage || msg.status}`;
  }
  if (msg.errorMessage) return msg.errorMessage;
  if (!SUCCESS_STATUSES.has(msg.status)) return msg.status;
  return undefined;
}

if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
  console.error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const eventCache = new Map();

async function getEvent(slug) {
  if (eventCache.has(slug)) return eventCache.get(slug);
  const snap = await db.doc(`events/${slug}`).get();
  const event = snap.exists ? { ref: snap.ref, data: snap.data() } : null;
  eventCache.set(slug, event);
  return event;
}

async function twilioSidExists(eventSlug, sid) {
  const snap = await db
    .collection(`events/${eventSlug}/messageLog`)
    .where('twilioSid', '==', sid)
    .limit(1)
    .get();
  return !snap.empty;
}

async function backfillInviteeSmsSentAt(eventRef, eventData, phone, sentAt) {
  const invitees = Array.isArray(eventData.invitees) ? [...eventData.invitees] : [];
  const target = digitsOnlyPhone(phone);
  let changed = false;

  for (let i = 0; i < invitees.length; i += 1) {
    const invitee = invitees[i];
    if (!invitee?.phone || digitsOnlyPhone(invitee.phone) !== target) continue;

    const existingSmsSentAt = invitee.smsSentAt || 0;
    if (sentAt <= existingSmsSentAt) continue;

    invitees[i] = {
      ...invitee,
      smsSentAt: sentAt,
      lastSentAt: Math.max(invitee.lastSentAt || 0, sentAt),
      sendCount: Math.max(invitee.sendCount || 0, 1),
      lastSentChannel: 'sms',
    };
    changed = true;
    break;
  }

  if (!changed) return false;
  if (dryRun) return true;

  await eventRef.update({ invitees, updatedAt: Date.now() });
  return true;
}

const stats = {
  scanned: 0,
  matched: 0,
  skippedNoSlug: 0,
  skippedNoEvent: 0,
  skippedDuplicate: 0,
  skippedTest: 0,
  written: 0,
  backfilled: 0,
  failed: 0,
};

console.log(
  `Twilio message migration${dryRun ? ' (dry run)' : ''}${Number.isFinite(limit) ? `, limit ${limit}` : ''}`
);

let page = await twilioClient.messages.list({ pageSize: 100 });
while (page.length > 0 && stats.scanned < limit) {
  for (const msg of page) {
    if (stats.scanned >= limit) break;
    stats.scanned += 1;

    const body = msg.body || '';
    if (body.includes('Mingle test SMS')) {
      stats.skippedTest += 1;
      continue;
    }

    const eventSlug = extractEventSlugFromInviteUrl(body);
    if (!eventSlug) {
      stats.skippedNoSlug += 1;
      continue;
    }

    const event = await getEvent(eventSlug);
    if (!event) {
      stats.skippedNoEvent += 1;
      continue;
    }

    if (await twilioSidExists(eventSlug, msg.sid)) {
      stats.skippedDuplicate += 1;
      continue;
    }

    stats.matched += 1;
    const invitees = Array.isArray(event.data.invitees) ? event.data.invitees : [];
    const recipientName = findInviteeName(invitees, msg.to);
    const hostUid = resolveHostUid(event.data);
    const success = SUCCESS_STATUSES.has(msg.status);
    const error = success ? undefined : formatTwilioError(msg);
    const createdAt = msg.dateCreated ? msg.dateCreated.getTime() : Date.now();

    console.log(
      `${dryRun ? '[dry-run] ' : ''}${eventSlug} → ${msg.to} (${msg.status}) sid=${msg.sid}`
    );

    if (!dryRun) {
      try {
        const batch = db.batch();
        const eventLogRef = db.collection(`events/${eventSlug}/messageLog`).doc();

        const entry = {
          channel: 'sms',
          hostUid,
          recipientName,
          recipientPhone: msg.to,
          body,
          success,
          createdAt,
          twilioSid: msg.sid,
          source: 'migration',
          ...(error ? { error } : {}),
        };

        batch.set(eventLogRef, entry);
        await batch.commit();
        stats.written += 1;

        if (backfillInvitees && success) {
          const didBackfill = await backfillInviteeSmsSentAt(
            event.ref,
            event.data,
            msg.to,
            createdAt
          );
          if (didBackfill) stats.backfilled += 1;
        }
      } catch (error) {
        stats.failed += 1;
        console.error(`Failed to write ${msg.sid}:`, error);
      }
    }
  }

  if (!page.nextPage) break;
  page = await page.nextPage();
}

console.log('\nSummary:');
console.log(`  scanned:          ${stats.scanned}`);
console.log(`  matched:          ${stats.matched}`);
console.log(`  written:          ${stats.written}`);
console.log(`  backfilled:       ${stats.backfilled}`);
console.log(`  skipped (no slug):${stats.skippedNoSlug}`);
console.log(`  skipped (no event):${stats.skippedNoEvent}`);
console.log(`  skipped (duplicate):${stats.skippedDuplicate}`);
console.log(`  skipped (test):   ${stats.skippedTest}`);
console.log(`  failed:           ${stats.failed}`);

if (dryRun) {
  console.log('\nRe-run without --dry-run to write records.');
}
