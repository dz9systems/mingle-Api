import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import sharp from 'sharp';

const CARRIER_SAFE_BYTES = 600 * 1024;
const TWILIO_MAX_BYTES = 5 * 1024 * 1024;

/** Public Firebase Storage URL without token (covers are world-readable). */
export function normalizeMmsMediaUrl(raw: string): string {
  let url = raw.trim().replace(/&amp;/g, '&');
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      parsed.searchParams.set('alt', 'media');
      parsed.searchParams.delete('token');
      return parsed.toString();
    }
  } catch {
    /* keep original */
  }
  return url;
}

async function headImage(url: string): Promise<{
  ok: boolean;
  contentType?: string;
  contentLength?: number;
  status?: number;
}> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const contentType = res.headers.get('content-type') || '';
  const contentLength = Number(res.headers.get('content-length') || 0);
  if (!contentType.startsWith('image/')) {
    return { ok: false, status: res.status };
  }
  return { ok: true, contentType, contentLength };
}

function firebaseDownloadUrl(bucketName: string, filePath: string, token: string): string {
  const encoded = encodeURIComponent(filePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

async function uploadMmsThumb(
  slug: string,
  buffer: Buffer,
): Promise<string> {
  const bucket = admin.storage().bucket();
  const filePath = `events/${slug}/mms-thumb.jpg`;
  const file = bucket.file(filePath);
  const token = crypto.randomUUID();

  await file.save(buffer, {
    metadata: {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=3600',
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  return firebaseDownloadUrl(bucket.name, filePath, token);
}

async function compressForMms(sourceUrl: string): Promise<Buffer> {
  const res = await fetch(sourceUrl, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`cover_image_fetch_${res.status}`);
  }
  const input = Buffer.from(await res.arrayBuffer());

  let output = await sharp(input)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  if (output.length > CARRIER_SAFE_BYTES) {
    output = await sharp(output)
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  }

  if (output.length > TWILIO_MAX_BYTES) {
    throw new Error('cover_image_too_large_after_compress');
  }

  return output;
}

/**
 * Returns a Twilio-friendly HTTPS image URL, compressing large covers when needed.
 */
export async function resolveMmsMediaUrl(
  slug: string,
  rawCoverUrl: string,
): Promise<{ url?: string; error?: string; compressed?: boolean }> {
  const normalized = normalizeMmsMediaUrl(rawCoverUrl);
  const head = await headImage(normalized);
  if (!head.ok) {
    return { error: `cover_image_unreachable${head.status ? `_${head.status}` : ''}` };
  }

  const size = head.contentLength || 0;
  if (size > 0 && size <= CARRIER_SAFE_BYTES) {
    return { url: normalized };
  }

  try {
    const compressed = await compressForMms(normalized);
    const url = await uploadMmsThumb(slug, compressed);
    return { url, compressed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'cover_image_compress_failed';
    console.error('MMS cover compress failed:', { slug, message });
    if (size > 0 && size <= TWILIO_MAX_BYTES) {
      return { url: normalized };
    }
    return { error: message };
  }
}
