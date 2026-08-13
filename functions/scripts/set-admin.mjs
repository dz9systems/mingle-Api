/**
 * Grant or revoke `admin: true` on the Firestore user profile.
 *
 * Usage:
 *   node scripts/set-admin.mjs --email you@example.com
 *   node scripts/set-admin.mjs --uid <firebaseUid>
 *   node scripts/set-admin.mjs --email you@example.com --revoke
 *
 * Requires Firebase Admin credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * `gcloud auth application-default login`).
 *
 * Clients cannot set this field — firestore.rules block writes to `admin`.
 */

import admin from 'firebase-admin';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const emailArg = args.find((a) => a.startsWith('--email='));
const uidArg = args.find((a) => a.startsWith('--uid='));
const emailFlag = args.indexOf('--email');
const uidFlag = args.indexOf('--uid');

const email =
  emailArg?.split('=').slice(1).join('=') ||
  (emailFlag !== -1 ? args[emailFlag + 1] : undefined);
const uid =
  uidArg?.split('=').slice(1).join('=') ||
  (uidFlag !== -1 ? args[uidFlag + 1] : undefined);

if (!email && !uid) {
  console.error('Provide --email <addr> or --uid <uid>');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const user = email
  ? await admin.auth().getUserByEmail(email)
  : await admin.auth().getUser(uid);

const ref = admin.firestore().doc(`users/${user.uid}`);
const now = Date.now();

if (revoke) {
  await ref.set(
    {
      admin: false,
      updatedAt: now,
    },
    { merge: true }
  );
  console.log(`Revoked admin from ${user.email || user.uid}`);
} else {
  await ref.set(
    {
      admin: true,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Host',
      ...(user.photoURL ? { avatar: user.photoURL } : {}),
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );
  console.log(`Granted admin to ${user.email || user.uid} (users/${user.uid}.admin = true)`);
}

console.log('Refresh /admin in the browser — no sign-out required.');
