import { getSpotifyClientId, getSpotifyClientSecret } from '../config';

export type SpotifyTrackResult = {
  id: string;
  title: string;
  artist: string;
  albumArt: string | null;
  previewUrl: string | null;
  spotifyUrl: string;
};

type SpotifyTokenResponse = {
  access_token: string;
  expires_in: number;
};

type SpotifyArtist = { name: string };
type SpotifyImage = { url: string };
type SpotifyAlbum = { images?: SpotifyImage[] };
type SpotifyTrack = {
  id: string;
  name: string;
  artists?: SpotifyArtist[];
  album?: SpotifyAlbum;
  preview_url: string | null;
  external_urls?: { spotify?: string };
};

type SpotifySearchResponse = {
  tracks?: { items?: SpotifyTrack[] };
};

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getSpotifyAccessToken(): Promise<string> {
  const clientId = getSpotifyClientId();
  const clientSecret = getSpotifyClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials are not configured');
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; error_description?: string };
      detail = body.error_description || body.error || '';
    } catch {
      // Ignore JSON parse errors.
    }
    const suffix = detail ? `: ${detail}` : '';
    throw new Error(`Spotify token request failed (${res.status})${suffix}`);
  }

  const data = (await res.json()) as SpotifyTokenResponse;
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

export async function searchSpotifyTracks(
  query: string,
  limit: number
): Promise<SpotifyTrackResult[]> {
  const token = await getSpotifyAccessToken();
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: String(limit),
  });

  const searchRes = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!searchRes.ok) {
    throw new Error(`Spotify search failed (${searchRes.status})`);
  }

  const payload = (await searchRes.json()) as SpotifySearchResponse;
  return (payload.tracks?.items || []).map((track) => ({
    id: track.id,
    title: track.name,
    artist: track.artists?.map((artist) => artist.name).join(', ') || 'Unknown Artist',
    albumArt: track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || null,
    previewUrl: track.preview_url,
    spotifyUrl:
      track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
  }));
}
