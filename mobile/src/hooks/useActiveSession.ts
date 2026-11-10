import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { ActiveSession } from '../types';
import {
  GUEST_WEB_ORIGIN,
  RENDER_WEB_URL,
  STORAGE_BUCKET,
  getRuntimeSupabaseAnonKey,
  getSupabaseClient,
  isSupabaseReady,
  isValidAnonKey,
  setRuntimeSupabaseAnonKey,
} from '../lib/supabase';

const SUPABASE_KEY_FILE = 'shotdrop_supabase_anon_key.txt';

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
}) {
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const activeSessionRef = useRef<ActiveSession | null>(activeSession);

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

  // Load saved anon key on startup
  useEffect(() => {
    async function loadSavedAnonKey() {
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
    }
    void loadSavedAnonKey();
  }, []);

  // Load saved web origin or probe online server
  useEffect(() => {
    async function loadSavedWebOrigin() {
      try {
        const configPath = `${FileSystem.documentDirectory ?? ''}shotdrop_web_origin.txt`;
        const info = await FileSystem.getInfoAsync(configPath);
        if (info.exists) {
          const saved = (await FileSystem.readAsStringAsync(configPath)).trim();
          if (
            saved.startsWith('http') &&
            !saved.includes('localhost') &&
            !saved.includes('192.168.') &&
            !saved.includes('127.0.0.1')
          ) {
            setWebOrigin(saved);
            setDraftWebOrigin(saved);
            webOriginRef.current = saved;
            return;
          }
        }
      } catch {
        // Ignore read error
      }

      try {
        const res = await fetch(`${RENDER_WEB_URL}/api/sync`, {
          method: 'GET',
        });
        if (res.ok) {
          setWebOrigin(RENDER_WEB_URL);
          setDraftWebOrigin(RENDER_WEB_URL);
          webOriginRef.current = RENDER_WEB_URL;
        }
      } catch {
        // Keep default
      }
    }
    void loadSavedWebOrigin();
  }, []);

  const handleSaveWebOrigin = async () => {
    const cleaned = draftWebOrigin.trim().replace(/\/$/, '');
    if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
      Alert.alert(
        'URL không hợp lệ',
        'Vui lòng nhập URL bắt đầu bằng https:// (ví dụ: https://shotdropvn.vercel.app)'
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

      const newQrHash = generateQrHash();
      const eventTitle = `Canon 6D Live • ${new Date().toLocaleTimeString(
        'vi-VN',
        {
          hour: '2-digit',
          minute: '2-digit',
        }
      )}`;

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
      return createdSession;
    },
    []
  );

  const handleEndSession = useCallback(async () => {
    const sessionToEnd = activeSessionRef.current || activeSession;

    setActiveSession(null);
    activeSessionRef.current = null;
    options?.onSessionEnded?.();
    options?.onShowToast?.('info', 'Đã kết thúc phiên chụp.');

    if (sessionToEnd?.id) {
      try {
        const client = getSupabaseClient();
        if (client) {
          try {
            const { data: storageFiles } = await client.storage
              .from(STORAGE_BUCKET)
              .list(sessionToEnd.id);
            if (storageFiles && storageFiles.length > 0) {
              const filePaths = storageFiles.map(
                (f) => `${sessionToEnd.id}/${f.name}`
              );
              await client.storage.from(STORAGE_BUCKET).remove(filePaths);
            }
          } catch (storageErr) {
            console.warn('[Supabase Storage] Lỗi xoá file phiên:', storageErr);
          }

          try {
            await client
              .from('photos')
              .delete()
              .eq('session_id', sessionToEnd.id);
          } catch (pErr) {
            console.warn('[Supabase Photos] Lỗi xoá rows ảnh:', pErr);
          }

          const { error: delErr } = await client
            .from('sessions')
            .delete()
            .eq('id', sessionToEnd.id);
          if (delErr) {
            console.warn('[Supabase Sessions] Lỗi xoá session row:', delErr);
          }
        }
      } catch (err) {
        console.warn('[Supabase] Lỗi dọn dẹp kết thúc session:', err);
      }

      try {
        await fetchWithTimeout(`${webOriginRef.current}/api/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'end_session',
            session_id: sessionToEnd.id,
            qr_code_hash: sessionToEnd.qr_code_hash,
          }),
        });
      } catch {
        // Ignore if offline
      }
    }
  }, [activeSession, options]);

  return {
    activeSession,
    activeSessionRef,
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
