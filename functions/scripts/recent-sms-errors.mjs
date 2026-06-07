import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilio from 'twilio';

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

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const messages = await client.messages.list({ limit: 5 });

if (messages.length === 0) {
  console.log('No recent messages in Twilio account.');
  process.exit(0);
}

console.log('Last 5 Twilio messages:\n');
for (const msg of messages) {
  console.log(`To: ${msg.to}`);
  console.log(`Status: ${msg.status}`);
  console.log(`Error code: ${msg.errorCode || 'none'}`);
  console.log(`Error message: ${msg.errorMessage || 'none'}`);
  console.log(`Date: ${msg.dateCreated}`);
  console.log('---');
}
