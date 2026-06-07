#!/usr/bin/env node
/**
 * Sync runtime secrets to Google Cloud Secret Manager before deploy.
 * Reads values from process.env (set by CI from GitHub Actions secrets).
 *
 * Required env: FIREBASE_PROJECT_ID
 * Required secret env vars: see SECRET_NAMES below.
 *
 * The deploy service account needs roles/secretmanager.admin (or equivalent
 * create + set + accessor permissions) on the Firebase/GCP project.
 */
import { spawnSync } from 'node:child_process';

const SECRET_NAMES = [
  'RESEND_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_SERVICE_SID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_OAUTH_STATE_SECRET',
  'SPOTIFY_CLIENT_SECRET',
];

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID is required');
  process.exit(1);
}

const missing = SECRET_NAMES.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(
    'Missing GitHub Actions secrets required for deploy:\n' +
      missing.map((name) => `  - ${name}`).join('\n')
  );
  process.exit(1);
}

for (const name of SECRET_NAMES) {
  const value = process.env[name];
  console.log(`Syncing secret ${name}...`);

  const result = spawnSync(
    'firebase',
    ['functions:secrets:set', name, '--project', projectId, '--force', '--data-file', '-'],
    {
      input: value,
      encoding: 'utf8',
      stdio: ['pipe', 'inherit', 'inherit'],
    }
  );

  if (result.status !== 0) {
    console.error(`Failed to set secret ${name}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`Synced ${SECRET_NAMES.length} secret(s) to project ${projectId}.`);
