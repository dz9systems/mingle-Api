import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { normalizeEmail } from '../utils/validation';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function guestStorageKey(email: string): string {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 32);
}

function extFromContentType(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

export function validateGuestAvatarUpload(
  contentType: string,
  buffer: Buffer
): { ok: true } | { ok: false; message: string } {
  if (!ALLOWED_TYPES.has(contentType)) {
    return { ok: false, message: 'invalid_content_type' };
  }
  if (buffer.length === 0) {
    return { ok: false, message: 'empty_image' };
  }
  if (buffer.length > MAX_BYTES) {
    return { ok: false, message: 'image_too_large' };
  }
  return { ok: true };
}

export async function uploadGuestAvatarToStorage(
  email: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const bucket = admin.storage().bucket();
  const key = guestStorageKey(email);
  const ext = extFromContentType(contentType);
  const filePath = `guests/${key}/avatar.${ext}`;
  const file = bucket.file(filePath);
  const token = crypto.randomUUID();

  await file.save(buffer, {
    metadata: {
      contentType,
      cacheControl: 'public, max-age=31536000',
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
    resumable: false,
  });

  const encodedPath = encodeURIComponent(filePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
}
