import type { Request, Response } from 'express';
import { applyCors } from '../middleware/cors';
import { searchSpotifyTracks } from '../services/spotify';

export async function handleSpotifySearch(req: Request, res: Response): Promise<void> {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) {
    res.status(400).json({ error: 'missing_search_query' });
    return;
  }

  const rawLimit = Number(req.query.limit);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 8, 1), 20);

  try {
    const tracks = await searchSpotifyTracks(query, limit);
    res.status(200).json({ tracks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'spotify_search_failed';
    const status = message.includes('not configured') ? 503 : 500;
    res.status(status).json({ error: message });
  }
}
