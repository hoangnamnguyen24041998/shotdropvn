import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface StoredSession {
  id: string;
  event_name: string;
  qr_code_hash: string;
  created_at: string;
  is_active?: boolean;
  ended_at?: string;
}

export interface StoredPhoto {
  id: string;
  client_photo_id?: string;
  session_id: string;
  image_url: string;
  created_at: string;
}

interface LiveStoreData {
  sessions: StoredSession[];
  photos: StoredPhoto[];
}

const LOCAL_STORE_PATH = path.join(process.cwd(), '.live-store.json');
const TMP_STORE_PATH = path.join(os.tmpdir(), 'shotdrop-live-store.json');
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function readStore(): Promise<LiveStoreData> {
  for (const storePath of [LOCAL_STORE_PATH, TMP_STORE_PATH]) {
    try {
      const raw = await fs.readFile(storePath, 'utf-8');
      const parsed = JSON.parse(raw) as LiveStoreData;
      return {
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        photos: Array.isArray(parsed.photos) ? parsed.photos : [],
      };
    } catch {
      // try next
    }
  }
  return { sessions: [], photos: [] };
}

async function writeStore(data: LiveStoreData): Promise<void> {
  const serialized = JSON.stringify(data, null, 2);
  try {
    await fs.writeFile(LOCAL_STORE_PATH, serialized, 'utf-8');
  } catch {
    // Ignore read-only bundle directory on serverless
  }
  try {
    await fs.writeFile(TMP_STORE_PATH, serialized, 'utf-8');
  } catch {
    // Ignore tmp write failure
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const hash = searchParams.get('hash')?.trim().toLowerCase();

  // Supabase is the authoritative source of truth in production.
  // Never resurrect stale /tmp store ghosts when Supabase has cleared/ended sessions.
  if (isSupabaseConfigured) {
    try {
      const sessionQuery = supabase
        .from('sessions')
        .select('id, event_name, qr_code_hash, created_at, is_active, ended_at');

      const { data: sessionData } = hash
        ? await sessionQuery.eq('qr_code_hash', hash).maybeSingle()
        : await sessionQuery
            .eq('is_active', true)
            .is('ended_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

      if (
        !sessionData ||
        sessionData.is_active === false ||
        Boolean(sessionData.ended_at)
      ) {
        return NextResponse.json(
          { session: null, photos: [], allSessions: [] },
          { headers: corsHeaders }
        );
      }

      const { data: photosData } = await supabase
        .from('photos')
        .select('id, client_photo_id, session_id, image_url, created_at')
        .eq('session_id', sessionData.id)
        .order('created_at', { ascending: false });

      return NextResponse.json(
        {
          session: sessionData,
          photos: Array.isArray(photosData) ? photosData : [],
          allSessions: [sessionData],
        },
        { headers: corsHeaders }
      );
    } catch {
      return NextResponse.json(
        { session: null, photos: [], allSessions: [] },
        { headers: corsHeaders }
      );
    }
  }

  const store = await readStore();

  const session = hash
    ? store.sessions.find((s) => s.qr_code_hash.toLowerCase() === hash) ?? null
    : store.sessions.find((s) => s.is_active !== false && !s.ended_at) ?? null;

  if (!session) {
    return NextResponse.json(
      { session: null, photos: [], allSessions: store.sessions },
      { headers: corsHeaders }
    );
  }

  const photos = store.photos
    .filter((p) => p.session_id === session.id)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  return NextResponse.json(
    { session, photos, allSessions: store.sessions },
    { headers: corsHeaders }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action:
        | 'create_session'
        | 'upload_photo'
        | 'delete_photos'
        | 'end_session'
        | 'end_all_sessions';
      event_name?: string;
      qr_code_hash?: string;
      session_id?: string;
      client_photo_id?: string;
      client_photo_ids?: string[];
      filename?: string;
      base64?: string;
      image_url?: string;
    };

    const store = await readStore();

    if (body.action === 'end_all_sessions') {
      store.sessions = [];
      store.photos = [];
      await writeStore(store);

      return NextResponse.json(
        { success: true, cleared: true, clearedAll: true },
        { headers: corsHeaders }
      );
    }

    if (body.action === 'create_session') {
      const qrHash = (
        body.qr_code_hash || Math.random().toString(36).substring(2, 8)
      ).toLowerCase();

      const existing = store.sessions.find(
        (s) => s.qr_code_hash.toLowerCase() === qrHash
      );
      if (existing) {
        existing.is_active = true;
        existing.ended_at = undefined;
        await writeStore(store);
        return NextResponse.json({ session: existing }, { headers: corsHeaders });
      }

      const newSession: StoredSession = {
        id: `sess-${Date.now()}-${qrHash}`,
        event_name: body.event_name || `Phiên chụp #${qrHash}`,
        qr_code_hash: qrHash,
        created_at: new Date().toISOString(),
        is_active: true,
      };

      store.sessions.unshift(newSession);
      await writeStore(store);

      return NextResponse.json(
        { session: newSession },
        { headers: corsHeaders }
      );
    }

    if (body.action === 'end_session') {
      const qrHash = body.qr_code_hash?.toLowerCase();
      const targetSession = store.sessions.find(
        (s) =>
          s.id === body.session_id ||
          (qrHash && s.qr_code_hash.toLowerCase() === qrHash)
      );

      const targetSessionId = targetSession?.id || body.session_id;

      // Completely remove the session row from store
      store.sessions = store.sessions.filter(
        (s) =>
          s.id !== targetSessionId &&
          (!qrHash || s.qr_code_hash.toLowerCase() !== qrHash)
      );

      // Completely remove all photos belonging to this session
      if (targetSessionId) {
        store.photos = store.photos.filter(
          (p) => p.session_id !== targetSessionId
        );
      }

      await writeStore(store);

      return NextResponse.json(
        { success: true, cleared: true },
        { headers: corsHeaders }
      );
    }

    if (body.action === 'upload_photo') {
      const remoteImageUrl = body.image_url?.trim();
      if (!body.base64 && !remoteImageUrl) {
        return NextResponse.json(
          { error: 'Missing image_url or base64 image payload' },
          { status: 400, headers: corsHeaders }
        );
      }

      let targetSession = store.sessions.find(
        (s) =>
          s.id === body.session_id ||
          (body.qr_code_hash &&
            s.qr_code_hash.toLowerCase() === body.qr_code_hash.toLowerCase())
      );

      if (!targetSession) {
        const qrHash = (
          body.qr_code_hash || Math.random().toString(36).substring(2, 8)
        ).toLowerCase();
        targetSession = {
          id: body.session_id || `sess-${Date.now()}-${qrHash}`,
          event_name: `Phiên chụp #${qrHash}`,
          qr_code_hash: qrHash,
          created_at: new Date().toISOString(),
        };
        store.sessions.unshift(targetSession);
      }

      const cleanFilename = (body.filename || `IMG_${Date.now()}.jpg`).replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      );

      let imageUrl: string;
      if (remoteImageUrl) {
        // Photo already lives in Supabase Storage: just register its public URL
        imageUrl = remoteImageUrl;
      } else {
        const savedFilename = `${targetSession.qr_code_hash}_${Date.now()}_${cleanFilename}`;
        const filePath = path.join(UPLOADS_DIR, savedFilename);

        const cleanBase64 = (body.base64 ?? '').replace(
          /^data:image\/\w+;base64,/,
          ''
        );
        const buffer = Buffer.from(cleanBase64, 'base64');

        imageUrl = `/uploads/${savedFilename}`;
        try {
          await fs.mkdir(UPLOADS_DIR, { recursive: true });
          await fs.writeFile(filePath, buffer);
        } catch {
          imageUrl = `data:image/jpeg;base64,${cleanBase64}`;
        }
      }

      const newPhoto: StoredPhoto = {
        id: `photo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        client_photo_id: body.client_photo_id,
        session_id: targetSession.id,
        image_url: imageUrl,
        created_at: new Date().toISOString(),
      };

      store.photos.unshift(newPhoto);
      await writeStore(store);

      return NextResponse.json(
        { session: targetSession, photo: newPhoto },
        { headers: corsHeaders }
      );
    }

    if (body.action === 'delete_photos') {
      const idsToDelete = new Set(body.client_photo_ids ?? []);
      const beforeCount = store.photos.length;
      store.photos = store.photos.filter(
        (p) => !p.client_photo_id || !idsToDelete.has(p.client_photo_id)
      );
      const removedCount = beforeCount - store.photos.length;
      await writeStore(store);

      return NextResponse.json(
        { removedCount, remainingPhotos: store.photos.length },
        { headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { error: 'Unsupported action' },
      { status: 400, headers: corsHeaders }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal sync error';
    return NextResponse.json(
      { error: message },
      { status: 500, headers: corsHeaders }
    );
  }
}
