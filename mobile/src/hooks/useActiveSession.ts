import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { ActiveSession } from '../types';
import {
  GUEST_WEB_ORIGIN,
  STORAGE_BUCKET,
  getRuntimeSupabaseAnonKey,
  getSupabaseClient,
  isSupabaseReady,
  isUsablePublicWebOrigin,
  isValidAnonKey,
  setRuntimeSupabaseAnonKey,
} from '../lib/supabase';

const SUPABASE_KEY_FILE = 'shotdrop_supabase_anon_key.txt';
const ACTIVE_SESSION_FILE = 'shotdrop_active_session.json';

function generateQrHash(): string {
  return Math.random().toString(36).substring(2, 8).toLowerCase();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'Chưa cấu hình Supabase Anon Key. Chạm vào nút Cài đặt trên thanh tiêu đề → dán Anon Key rồi bấm Lưu.'
    );
    this.name = 'SupabaseNotConfiguredError';
  }
}

export function useActiveSession(options?: {
  onShowToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  onSessionEnded?: () => void;
  onSessionRestored?: (session: ActiveSession) => void;
}) {
  const onShowToastRef = useRef(options?.onShowToast);
  const onSessionEndedRef = useRef(options?.onSessionEnded);
  const onSessionRestoredRef = useRef(options?.onSessionRestored);
  onShowToastRef.current = options?.onShowToast;
  onSessionEndedRef.current = options?.onSessionEnded;
  onSessionRestoredRef.current = options?.onSessionRestored;

  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const activeSessionRef = useRef<ActiveSession | null>(activeSession);
  const creatingSessionPromiseRef = useRef<Promise<ActiveSession> | null>(null);
  const [endingSession, setEndingSession] = useState<boolean>(false);
  const endingSessionRef = useRef<boolean>(false);

  // Web Origin Configuration
  const [webOrigin, setWebOrigin] = useState<string>(GUEST_WEB_ORIGIN);
  const [isUrlModalVisible, setIsUrlModalVisible] = useState<boolean>(false);
  const [draftWebOrigin, setDraftWebOrigin] = useState<string>(GUEST_WEB_ORIGIN);
  const webOriginRef = useRef<string>(GUEST_WEB_ORIGIN);

  // Supabase Anon Key
  const [supabaseReady, setSupabaseReady] = useState<boolean>(() =>
    isSupabaseReady()
  );
  const [draftAnonKey, setDraftAnonKey] = useState<string>(() =>
    getRuntimeSupabaseAnonKey()
  );

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    webOriginRef.current = webOrigin;
  }, [webOrigin]);

  const persistActiveSession = useCallback(
    async (session: ActiveSession | null) => {
      const sessionPath = `${FileSystem.documentDirectory ?? ''}${ACTIVE_SESSION_FILE}`;
      if (!sessionPath) return;
      try {
        if (!session) {
          await FileSystem.deleteAsync(sessionPath, { idempotent: true });
        } else {
          await FileSystem.writeAsStringAsync(
            sessionPath,
            JSON.stringify(session)
          );
        }
      } catch {
        // Ignore persistence error
      }
    },
    []
  );

  // Load saved anon key and restore any un-ended active session verified against Supabase
  useEffect(() => {
    async function initKeyAndRestoreSession() {
      try {
        const keyPath = `${FileSystem.documentDirectory ?? ''}${SUPABASE_KEY_FILE}`;
        const info = await FileSystem.getInfoAsync(keyPath);
        if (info.exists) {
          const saved = (await FileSystem.readAsStringAsync(keyPath)).trim();
          if (isValidAnonKey(saved)) {
            setRuntimeSupabaseAnonKey(saved);
            setDraftAnonKey(saved);
            setSupabaseReady(isSupabaseReady());
          }
        }
      } catch {
        // Ignore read error
      }

      const sessionPath = `${FileSystem.documentDirectory ?? ''}${ACTIVE_SESSION_FILE}`;
      try {
        const info = await FileSystem.getInfoAsync(sessionPath);
        if (!info.exists || !isSupabaseReady()) return;

        const raw = await FileSystem.readAsStringAsync(sessionPath);
        const parsed = JSON.parse(raw) as Partial<ActiveSession> | null;
        if (!parsed?.id || !parsed?.qr_code_hash) {
          await FileSystem.deleteAsync(sessionPath, { idempotent: true });
          return;
        }

        const { data, error } = await getSupabaseClient()
          .from('sessions')
          .select('*')
          .eq('id', parsed.id)
          .maybeSingle();

        if (
          !error &&
          data &&
          data.is_active !== false &&
          data.ended_at == null
        ) {
          const restored = data as ActiveSession;
          activeSessionRef.current = restored;
          setActiveSession(restored);
          onSessionRestoredRef.current?.(restored);
        } else if (!error && !data) {
          await FileSystem.deleteAsync(sessionPath, { idempotent: true });
        }
      } catch {
        // Keep clean standby state if restore check fails
      }
    }
    void initKeyAndRestoreSession();
  }, []);

  // Load saved web origin (discarding legacy trycloudflare/localhost/dead render URLs)
  useEffect(() => {
    async function loadSavedWebOrigin() {
      try {
        const configPath = `${FileSystem.documentDirectory ?? ''}shotdrop_web_origin.txt`;
        const info = await FileSystem.getInfoAsync(configPath);
        if (info.exists) {
          const saved = (await FileSystem.readAsStringAsync(configPath))
            .trim()
            .replace(/\/$/, '');
          if (isUsablePublicWebOrigin(saved)) {
            setWebOrigin(saved);
            setDraftWebOrigin(saved);
            webOriginRef.current = saved;
            return;
          }
          await FileSystem.deleteAsync(configPath, { idempotent: true });
        }
      } catch {
        // Ignore read/delete error and keep production default
      }

      setWebOrigin(GUEST_WEB_ORIGIN);
      setDraftWebOrigin(GUEST_WEB_ORIGIN);
      webOriginRef.current = GUEST_WEB_ORIGIN;
    }
    void loadSavedWebOrigin();
  }, []);

  const handleSaveWebOrigin = async () => {
    const cleaned = draftWebOrigin.trim().replace(/\/$/, '');
    if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
      Alert.alert(
        'URL không hợp lệ',
        'Vui lòng nhập URL bắt đầu bằng https:// (ví dụ: https://web-six-alpha-35.vercel.app)'
      );
      return;
    }

    const cleanedKey = draftAnonKey.trim();
    if (cleanedKey && !isValidAnonKey(cleanedKey)) {
      Alert.alert(
        'Anon Key không hợp lệ',
        'Vui lòng dán đúng khoá "anon public" (bắt đầu bằng eyJ...) hoặc "Publishable key" (sb_publishable_...) từ Supabase Dashboard.'
      );
      return;
    }

    if (cleanedKey) {
      setRuntimeSupabaseAnonKey(cleanedKey);
      setSupabaseReady(isSupabaseReady());
      try {
        const keyPath = `${FileSystem.documentDirectory ?? ''}${SUPABASE_KEY_FILE}`;
        await FileSystem.writeAsStringAsync(keyPath, cleanedKey);
      } catch {
        // Ignore write error
      }
    }

    setWebOrigin(cleaned);
    setDraftWebOrigin(cleaned);
    webOriginRef.current = cleaned;
    setIsUrlModalVisible(false);

    try {
      const configPath = `${FileSystem.documentDirectory ?? ''}shotdrop_web_origin.txt`;
      await FileSystem.writeAsStringAsync(configPath, cleaned);
    } catch {
      // Ignore write error
    }

    options?.onShowToast?.('success', `Đã cập nhật URL Web: ${cleaned}`);
  };

  const ensureActiveSession = useCallback(
    async (forceNew = false): Promise<ActiveSession> => {
      if (!forceNew && activeSessionRef.current) {
        return activeSessionRef.current;
      }

      if (!forceNew && creatingSessionPromiseRef.current) {
        return creatingSessionPromiseRef.current;
      }

      const task = (async (): Promise<ActiveSession> => {
        const newQrHash = generateQrHash();
        const eventTitle = `Phiên chụp #${newQrHash}`;

        let createdSession: ActiveSession = {
          id: `sess-${Date.now()}-${newQrHash}`,
          event_name: eventTitle,
          qr_code_hash: newQrHash,
          created_at: new Date().toISOString(),
        };

        if (!isSupabaseReady()) {
          throw new SupabaseNotConfiguredError();
        }

        const { data, error } = await getSupabaseClient()
          .from('sessions')
          .insert({
            event_name: eventTitle,
            qr_code_hash: newQrHash,
          })
          .select('*')
          .single();

        if (error) {
          throw new Error(
            `Lỗi tạo Session Supabase (${error.code ?? 'unknown'}): ${error.message}`
          );
        }
        if (data) {
          createdSession = data as ActiveSession;
        }

        void fetchWithTimeout(
          `${webOriginRef.current}/api/sync`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create_session',
              event_name: createdSession.event_name,
              qr_code_hash: createdSession.qr_code_hash,
            }),
          },
          4000
        ).catch(() => undefined);

        activeSessionRef.current = createdSession;
        setActiveSession(createdSession);
        await persistActiveSession(createdSession);
        return createdSession;
      })();

      if (!forceNew) {
        creatingSessionPromiseRef.current = task;
      }
      try {
        return await task;
      } finally {
        if (creatingSessionPromiseRef.current === task) {
          creatingSessionPromiseRef.current = null;
        }
      }
    },
    [persistActiveSession]
  );

  const handleEndSession = useCallback(async () => {
    if (endingSessionRef.current) return;

    const sessionToEnd = activeSessionRef.current || activeSession;
    endingSessionRef.current = true;
    setEndingSession(true);

    try {
      if (isSupabaseReady()) {
        const client = getSupabaseClient();

        // 1. Delete ALL files & session folders from Storage bucket
        const pathsToRemove = new Set<string>();
        const { data: rootEntries, error: rootListErr } = await client.storage
          .from(STORAGE_BUCKET)
          .list('', { limit: 1000 });
        if (rootListErr) {
          throw new Error(
            `Không đọc được kho ảnh để dọn dẹp: ${rootListErr.message}`
          );
        }

        const folderNames = new Set<string>();
        if (sessionToEnd?.id) {
          folderNames.add(sessionToEnd.id);
        }

        for (const entry of rootEntries ?? []) {
          if (!entry.name) continue;
          if (!entry.id) {
            folderNames.add(entry.name);
          } else {
            pathsToRemove.add(entry.name);
          }
        }

        for (const folder of folderNames) {
          const { data: childFiles } = await client.storage
            .from(STORAGE_BUCKET)
            .list(folder, { limit: 1000 });
          for (const child of childFiles ?? []) {
            if (child.name) {
              pathsToRemove.add(`${folder}/${child.name}`);
            }
          }
        }

        const allPaths = Array.from(pathsToRemove);
        for (let i = 0; i < allPaths.length; i += 100) {
          const chunk = allPaths.slice(i, i + 100);
          const { error: rmErr } = await client.storage
            .from(STORAGE_BUCKET)
            .remove(chunk);
          if (rmErr) {
            throw new Error(`Lỗi xoá file ảnh trên Storage: ${rmErr.message}`);
          }
        }

        // 2. Delete ALL rows in photos and sessions tables
        const { error: photosDelErr } = await client
          .from('photos')
          .delete()
          .not('id', 'is', null);
        if (photosDelErr) {
          throw new Error(`Lỗi xoá danh sách ảnh: ${photosDelErr.message}`);
        }

        const { error: sessionsDelErr } = await client
          .from('sessions')
          .delete()
          .not('id', 'is', null);
        if (sessionsDelErr) {
          throw new Error(`Lỗi xoá phiên chụp: ${sessionsDelErr.message}`);
        }

        // 3. Verify server has zero remaining sessions
        const { data: remainingSessions, error: verifyErr } = await client
          .from('sessions')
          .select('id')
          .limit(1);
        if (verifyErr) {
          throw new Error(`Lỗi xác minh xoá phiên: ${verifyErr.message}`);
        }
        if (remainingSessions && remainingSessions.length > 0) {
          throw new Error('Vẫn còn phiên trên máy chủ chưa xoá được.');
        }
      }

      // 4. Notify /api/sync fallback store to wipe all sessions too
      await fetchWithTimeout(`${webOriginRef.current}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'end_all_sessions',
          session_id: sessionToEnd?.id ?? null,
          qr_code_hash: sessionToEnd?.qr_code_hash ?? null,
        }),
      }).catch(() => undefined);

      // 5. Clear local state and persisted session only after server wipe succeeded
      setActiveSession(null);
      activeSessionRef.current = null;
      await persistActiveSession(null);
      onSessionEndedRef.current?.();
      onShowToastRef.current?.(
        'info',
        'Đã kết thúc tất cả phiên và xoá sạch dữ liệu trên Web.'
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Không thể xoá phiên trên máy chủ.';
      onShowToastRef.current?.(
        'error',
        `Chưa kết thúc được phiên: ${msg}`
      );
    } finally {
      endingSessionRef.current = false;
      setEndingSession(false);
    }
  }, [activeSession, persistActiveSession]);

  return {
    activeSession,
    activeSessionRef,
    endingSession,
    webOrigin,
    webOriginRef,
    isUrlModalVisible,
    setIsUrlModalVisible,
    draftWebOrigin,
    setDraftWebOrigin,
    supabaseReady,
    draftAnonKey,
    setDraftAnonKey,
    handleSaveWebOrigin,
    ensureActiveSession,
    handleEndSession,
  };
}
