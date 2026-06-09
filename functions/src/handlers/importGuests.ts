import type { Request, Response } from 'express';
import { applyCors } from '../middleware/cors';
import { verifyHostAuthForSlug } from '../middleware/auth';
import {
  applyGuestImport,
  syncRsvpsToInvitees,
  type GuestImportRow,
  type ImportRsvpStatus,
} from '../services/guestImport';

const IMPORT_STATUSES = new Set<ImportRsvpStatus>(['going', 'maybe', 'no', 'invited']);

function parseGuestRows(body: unknown): GuestImportRow[] | null {
  if (!body || typeof body !== 'object') return null;
  const guests = (body as { guests?: unknown }).guests;
  if (!Array.isArray(guests) || guests.length === 0) return null;

  const rows: GuestImportRow[] = [];
  for (const raw of guests) {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const name = String(row.name || '').trim();
    const email = row.email ? String(row.email).trim() : undefined;
    const phone = row.phone ? String(row.phone).trim() : undefined;
    if (!name && !email) return null;

    const parsed: GuestImportRow = { name: name || email! };
    if (email) parsed.email = email;
    if (phone) parsed.phone = phone;

    if (row.importStatus != null) {
      const status = String(row.importStatus).trim().toLowerCase() as ImportRsvpStatus;
      if (!IMPORT_STATUSES.has(status)) return null;
      parsed.importStatus = status;
    }

    if (row.hasPlusOne === true) parsed.hasPlusOne = true;
    if (typeof row.updatedAt === 'string' && row.updatedAt.trim()) {
      parsed.updatedAt = row.updatedAt.trim();
    }

    rows.push(parsed);
  }

  return rows;
}

function parseEventSlug(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const slug = (body as { eventSlug?: unknown }).eventSlug;
  return typeof slug === 'string' && slug.trim() ? slug.trim() : null;
}

export async function handleImportGuests(req: Request, res: Response): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const eventSlug = parseEventSlug(req.body);
  if (!eventSlug) {
    res.status(400).send('event_slug_required');
    return;
  }

  const auth = await verifyHostAuthForSlug(req, res, eventSlug);
  if (!auth) return;

  const guests = parseGuestRows(req.body);
  if (!guests) {
    res.status(400).send('guests_required');
    return;
  }

  try {
    const result = await applyGuestImport(eventSlug, guests);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('importGuests failed:', err);
    const message = err instanceof Error ? err.message : 'import_failed';
    res.status(500).json({ ok: false, message });
  }
}

export async function handleSyncRsvpsToInvitees(req: Request, res: Response): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).send('method_not_allowed');
    return;
  }

  const eventSlug = parseEventSlug(req.body);
  if (!eventSlug) {
    res.status(400).send('event_slug_required');
    return;
  }

  const auth = await verifyHostAuthForSlug(req, res, eventSlug);
  if (!auth) return;

  try {
    const result = await syncRsvpsToInvitees(eventSlug);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('syncRsvpsToInvitees failed:', err);
    const message = err instanceof Error ? err.message : 'sync_failed';
    res.status(500).json({ ok: false, message });
  }
}
