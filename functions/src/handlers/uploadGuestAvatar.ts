import type { Request, Response } from 'express';
import { applyCors } from '../middleware/cors';
import { uploadGuestAvatarToStorage, validateGuestAvatarUpload } from '../services/guestAvatar';
import { isValidEmail, normalizeEmail } from '../utils/validation';

type UploadBody = {
  email?: unknown;
  image?: unknown;
  contentType?: unknown;
};

export async function handleUploadGuestAvatar(req: Request, res: Response): Promise<void> {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const body = req.body as UploadBody;
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  const image = typeof body.image === 'string' ? body.image.trim() : '';
  const contentType =
    typeof body.contentType === 'string' && body.contentType.trim()
      ? body.contentType.trim().toLowerCase()
      : 'image/jpeg';

  if (!email || !isValidEmail(email)) {
    res.status(400).json({ error: 'invalid_email' });
    return;
  }

  if (!image) {
    res.status(400).json({ error: 'missing_image' });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(image, 'base64');
  } catch {
    res.status(400).json({ error: 'invalid_image_data' });
    return;
  }

  const validation = validateGuestAvatarUpload(contentType, buffer);
  if (!validation.ok) {
    res.status(400).json({ error: validation.message });
    return;
  }

  try {
    const { url, path } = await uploadGuestAvatarToStorage(email, buffer, contentType);
    res.status(200).json({ url, path });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upload_failed';
    console.error('uploadGuestAvatar failed:', message);
    res.status(500).json({ error: 'upload_failed' });
  }
}
