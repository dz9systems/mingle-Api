/**
 * Copy recipient names (and other metadata) from smsLog/emailLog into
 * events/{slug}/messageLog before deprecating the legacy collections.
 *
 * Usage:
 *   node scripts/migrate-legacy-log-names.mjs --dry-run
 *   node scripts/migrate-legacy-log-names.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

function digitsOnlyPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isWeakName(name) {
  const trimmed = String(name || '').trim();
  return !trimmed || trimmed.toLowerCase() === 'unknown';
}

function pickBetterName(current, candidate) {
  if (!isWeakName(candidate) && isWeakName(current)) return candidate.trim();
  return current;
}

function legacyRecipientKey(data) {
  const phone = digitsOnlyPhone(data.recipientPhone);
  const email = String(data.recipientEmail || '').trim().toLowerCase();
  return phone || email;
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const stats = {
  legacyScanned: 0,
  messageLogUpdated: 0,
  messageLogCreated: 0,
  skippedNoSlug: 0,
  skippedNoMatch: 0,
  skippedAlreadyGood: 0,
};

async function findMessageLogDoc(eventSlug, legacy) {
  if (legacy.twilioSid) {
    const bySid = await db
      .collection(`events/${eventSlug}/messageLog`)
      .where('twilioSid', '==', legacy.twilioSid)
      .limit(1)
      .get();
    if (!bySid.empty) return bySid.docs[0];
  }

  if (legacy.resendId) {
    const byResend = await db
      .collection(`events/${eventSlug}/messageLog`)
      .where('resendId', '==', legacy.resendId)
      .limit(1)
      .get();
    if (!byResend.empty) return byResend.docs[0];
  }

  const recipientKey = legacyRecipientKey(legacy);
  const createdAt = legacy.createdAt;
  if (!recipientKey || typeof createdAt !== 'number') return null;

  const snap = await db.collection(`events/${eventSlug}/messageLog`).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const docKey =
      digitsOnlyPhone(data.recipientPhone) ||
      String(data.recipientEmail || '').trim().toLowerCase();
    if (docKey !== recipientKey) continue;
    if (typeof data.createdAt !== 'number') continue;
    if (Math.abs(data.createdAt - createdAt) <= 2000) return doc;
  }

  return null;
}

async function migrateLegacyCollection(collectionName, channel) {
  const snap = await db.collection(collectionName).get();
  console.log(`\n${collectionName}: ${snap.size} document(s)`);

  for (const legacyDoc of snap.docs) {
    stats.legacyScanned += 1;
    const legacy = legacyDoc.data();
    const eventSlug = legacy.eventSlug;
    if (!eventSlug || typeof eventSlug !== 'string') {
      stats.skippedNoSlug += 1;
      continue;
    }

    const legacyName = legacy.recipientName;
    const messageLogDoc = await findMessageLogDoc(eventSlug, legacy);

    if (messageLogDoc) {
      const current = messageLogDoc.data();
      const nextName = pickBetterName(current.recipientName, legacyName);

      const patch = {};
      if (nextName !== current.recipientName) {
        patch.recipientName = nextName;
      }
      if (!current.hostUid && legacy.hostUid) patch.hostUid = legacy.hostUid;
      if (current.success === undefined && legacy.success !== undefined) {
        patch.success = legacy.success;
      }
      if (!current.error && legacy.error) patch.error = legacy.error;

      if (Object.keys(patch).length === 0) {
        stats.skippedAlreadyGood += 1;
        continue;
      }

      console.log(
        `${dryRun ? '[dry-run] ' : ''}update ${eventSlug}/messageLog/${messageLogDoc.id}: ` +
          `recipientName "${current.recipientName || ''}" → "${patch.recipientName || current.recipientName}"`
      );

      if (!dryRun) {
        await messageLogDoc.ref.update(patch);
      }
      stats.messageLogUpdated += 1;
      continue;
    }

    if (isWeakName(legacyName)) {
      stats.skippedNoMatch += 1;
      continue;
    }

    const entry = {
      channel,
      hostUid: legacy.hostUid || 'unknown',
      recipientName: legacyName.trim(),
      success: legacy.success ?? true,
      createdAt: legacy.createdAt ?? Date.now(),
      source: legacy.source || 'migration',
      ...(legacy.recipientPhone ? { recipientPhone: legacy.recipientPhone } : {}),
      ...(legacy.recipientEmail ? { recipientEmail: legacy.recipientEmail } : {}),
      ...(legacy.error ? { error: legacy.error } : {}),
      ...(legacy.twilioSid ? { twilioSid: legacy.twilioSid } : {}),
      ...(legacy.resendId ? { resendId: legacy.resendId } : {}),
    };

    console.log(
      `${dryRun ? '[dry-run] ' : ''}create ${eventSlug}/messageLog from ${collectionName}/${legacyDoc.id}: ${legacyName}`
    );

    if (!dryRun) {
      await db.collection(`events/${eventSlug}/messageLog`).add(entry);
    }
    stats.messageLogCreated += 1;
  }
}

console.log(`Legacy log name migration${dryRun ? ' (dry run)' : ''}`);

await migrateLegacyCollection('smsLog', 'sms');
await migrateLegacyCollection('emailLog', 'email');

console.log('\nSummary:');
console.log(`  legacy scanned:       ${stats.legacyScanned}`);
console.log(`  messageLog updated:   ${stats.messageLogUpdated}`);
console.log(`  messageLog created:   ${stats.messageLogCreated}`);
console.log(`  skipped (no slug):    ${stats.skippedNoSlug}`);
console.log(`  skipped (no match):   ${stats.skippedNoMatch}`);
console.log(`  skipped (already ok): ${stats.skippedAlreadyGood}`);

if (dryRun) {
  console.log('\nRe-run without --dry-run to apply changes.');
}
