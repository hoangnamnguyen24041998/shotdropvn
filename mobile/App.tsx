import './src/lib/suppressWarnings';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import QRCode from 'react-native-qrcode-svg';
import {
  BoltIcon,
  CameraApertureIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  DownloadTrayIcon,
  FolderOpenIcon,
  QrViewfinderIcon,
  ShareArrowIcon,
  SparklesIcon,
  TrashIcon,
  UploadArrowIcon,
  UsbCableIcon,
} from './src/components/Icons';
import {
  buildGuestUrl,
  getRuntimeSupabaseAnonKey,
  getSupabaseClient,
  GUEST_WEB_ORIGIN,
  isSupabaseReady,
  isValidAnonKey,
  PUBLIC_CLOUDFLARE_WEB_URL,
  RENDER_WEB_URL,
  setRuntimeSupabaseAnonKey,
  STORAGE_BUCKET,
  SUPABASE_PROJECT_URL,
} from './src/lib/supabase';
import {
  isNativeUsbOtgAvailable,
  pollNewUsbCameraPhotos,
  scanAndConnectUsbCamera,
  type UsbCameraStatus,
} from './src/lib/usbOtg';
import { colors, radii, spacing } from './src/theme/tokens';

export interface ActiveSession {
  id: string;
  event_name: string;
  qr_code_hash: string;
  created_at?: string;
}

export interface LocalPhotoItem {
  id: string;
  uri: string;
  filename: string;
  creationTime: number;
  base64?: string | null;
}

function generateQrHash(): string {
  return Math.random().toString(36).substring(2, 8).toLowerCase();
}

const SUPABASE_KEY_FILE = 'shotdrop_supabase_anon_key.txt';

function guessImageContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  return 'image/jpeg';
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

class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'Chưa cấu hình Supabase Anon Key. Chạm vào tiêu đề "ShotDrop VN" → dán Anon Key (Supabase Dashboard → Project Settings → API Keys) rồi bấm Lưu.'
    );
    this.name = 'SupabaseNotConfiguredError';
  }
}

export const APP_VERSION = '1.2.0';

export default function App() {
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(
    null
  );
  const [recentPhotos, setRecentPhotos] = useState<LocalPhotoItem[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [uploadedPhotoIds, setUploadedPhotoIds] = useState<string[]>([]);
  const [longPressedPhotoId, setLongPressedPhotoId] = useState<string | null>(
    null
  );
  const [isSelectionMenuExpanded, setIsSelectionMenuExpanded] =
    useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(() => Date.now());
  const [sessionPhotosCount, setSessionPhotosCount] = useState<number>(0);
  const [isExpoGoAndroidRestricted, setIsExpoGoAndroidRestricted] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Sẵn sàng đồng bộ Live qua cáp USB OTG hoặc Canon Connect'
  );

  // Public Web Origin State (defaults to Public HTTPS Cloudflare/Vercel URL, never localhost)
  const [webOrigin, setWebOrigin] = useState<string>(GUEST_WEB_ORIGIN);
  const [isUrlModalVisible, setIsUrlModalVisible] = useState<boolean>(false);
  const [draftWebOrigin, setDraftWebOrigin] =
    useState<string>(GUEST_WEB_ORIGIN);
  const webOriginRef = useRef<string>(GUEST_WEB_ORIGIN);

  // Supabase Anon Key (runtime-configurable, persisted on device)
  const [supabaseReady, setSupabaseReady] = useState<boolean>(() =>
    isSupabaseReady()
  );
  const [draftAnonKey, setDraftAnonKey] = useState<string>(() =>
    getRuntimeSupabaseAnonKey()
  );

  useEffect(() => {
    webOriginRef.current = webOrigin;
  }, [webOrigin]);

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

      // Automatically probe if the Render production URL is online; if so, prefer it, otherwise use active Cloudflare HTTPS tunnel
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
        // Keep PUBLIC_CLOUDFLARE_WEB_URL
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

    // Save Supabase Anon Key if provided
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
    setStatusMessage(`Đã cập nhật URL Web Live: ${cleaned}`);
  };

  // USB OTG Live Tether State
  const [isOtgLiveEnabled, setIsOtgLiveEnabled] = useState<boolean>(true);
  const [usbCameraStatus, setUsbCameraStatus] = useState<UsbCameraStatus>({
    connected: false,
    status: 'NO_USB_DEVICE',
    deviceName: null,
    totalPhotosOnCard: 0,
  });
  const [otgDirectoryUri, setOtgDirectoryUri] = useState<string | null>(null);

  // Pulse animation for "Live sync active"
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Draggable Floating Selection Popup / Modal state
  const popupPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const popupOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const popupScaleAnim = useRef(new Animated.Value(0.92)).current;
  const isExpandedRef = useRef<boolean>(isSelectionMenuExpanded);

  useEffect(() => {
    isExpandedRef.current = isSelectionMenuExpanded;
  }, [isSelectionMenuExpanded]);

  const snapPopupTo = useCallback(
    (toX: number, toY: number) => {
      popupOffsetRef.current = { x: toX, y: toY };
      Animated.spring(popupPan, {
        toValue: { x: toX, y: toY },
        useNativeDriver: true,
        damping: 20,
        stiffness: 220,
        mass: 0.8,
      }).start();
    },
    [popupPan]
  );

  // Trigger entrance spring when selection popup appears
  useEffect(() => {
    if (selectedPhotoIds.length > 0) {
      Animated.spring(popupScaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 18,
        stiffness: 240,
      }).start();
    } else {
      popupScaleAnim.setValue(0.92);
      popupOffsetRef.current = { x: 0, y: 0 };
      popupPan.setValue({ x: 0, y: 0 });
      setIsSelectionMenuExpanded(false);
    }
  }, [popupPan, popupScaleAnim, selectedPhotoIds.length]);

  const popupPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
      onPanResponderMove: (_, gesture) => {
        const nextX = Math.max(
          -28,
          Math.min(28, popupOffsetRef.current.x + gesture.dx * 0.45)
        );
        const nextY = Math.max(
          -340,
          Math.min(70, popupOffsetRef.current.y + gesture.dy)
        );
        popupPan.setValue({ x: nextX, y: nextY });
      },
      onPanResponderRelease: (_, gesture) => {
        const totalY = popupOffsetRef.current.y + gesture.dy;

        // Fast swipe up or drag up -> Expand modal & center smoothly
        if (gesture.dy < -36 && !isExpandedRef.current) {
          setIsSelectionMenuExpanded(true);
          snapPopupTo(0, -12);
          return;
        }

        // Swipe down when expanded -> Collapse into compact floating popup
        if (gesture.dy > 38 && isExpandedRef.current) {
          setIsSelectionMenuExpanded(false);
          snapPopupTo(0, 0);
          return;
        }

        // Otherwise keep the vertical position the user dragged the popup to (clamped safely on screen)
        const clampedY = Math.max(-280, Math.min(12, totalY));
        snapPopupTo(0, clampedY);
      },
    })
  ).current;

  // Refs to prevent stale closures
  const activeSessionRef = useRef<ActiveSession | null>(activeSession);
  const uploadingRef = useRef<boolean>(uploading);
  const lastSyncTimeRef = useRef<number>(lastSyncTime);
  const uploadedIdsSetRef = useRef<Set<string>>(new Set());
  const deletedIdsSetRef = useRef<Set<string>>(new Set());
  const knownSafFilesSetRef = useRef<Set<string>>(new Set());
  const isOtgPollingRef = useRef<boolean>(false);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    uploadingRef.current = uploading;
  }, [uploading]);

  useEffect(() => {
    lastSyncTimeRef.current = lastSyncTime;
  }, [lastSyncTime]);

  useEffect(() => {
    if (activeSession || usbCameraStatus.connected) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.35,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [activeSession, usbCameraStatus.connected, pulseAnim]);

  // Ensure or create an active session (Supabase + Local Live Web Server)
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

      // 1. Supabase is the source of truth: insert into `sessions` table
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

      // 2. Best-effort: also notify the Web relay (/api/sync). Never blocks or fails the flow.
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
      if (forceNew) {
        setSessionPhotosCount(0);
      }
      return createdSession;
    },
    []
  );

  // Upload a batch of LocalPhotoItem to Supabase AND Local Live Web Server
  const uploadPhotosBatch = useCallback(
    async (
      itemsToUpload: LocalPhotoItem[],
      options?: { forceNewSession?: boolean }
    ) => {
      if (itemsToUpload.length === 0 || uploadingRef.current) return;

      uploadingRef.current = true;
      setUploading(true);
      setLongPressedPhotoId(null);

      try {
        setStatusMessage('Đang khởi tạo mã QR cho phiên chụp...');
        const currentSession = await ensureActiveSession(
          options?.forceNewSession ?? false
        );

        let successCount = 0;

        for (let i = 0; i < itemsToUpload.length; i++) {
          const item = itemsToUpload[i];
          setStatusMessage(
            `Đang đẩy ảnh ${i + 1}/${itemsToUpload.length} lên QR #${currentSession.qr_code_hash}...`
          );

          // Read Base64 from picker payload or via FileSystem
          let base64Data: string;
          try {
            base64Data =
              item.base64 ||
              (await FileSystem.readAsStringAsync(item.uri, {
                encoding: FileSystem.EncodingType.Base64,
              }));
          } catch (readErr) {
            const readMsg =
              readErr instanceof Error ? readErr.message : String(readErr);
            throw new Error(
              `Không đọc được file ảnh "${item.filename}" trên máy: ${readMsg}`
            );
          }

          const cleanFilename = (
            item.filename || `CANON_${Date.now()}.JPG`
          ).replace(/[^a-zA-Z0-9._-]/g, '_');

          // A. Upload to Supabase Storage (bucket shotdrop_photos) + insert row into `photos`
          const client = getSupabaseClient();
          const arrayBuffer = decode(base64Data);
          const storagePath = `${currentSession.id}/${Date.now()}_${cleanFilename}`;

          const { error: storageErr } = await client.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, arrayBuffer, {
              contentType: guessImageContentType(cleanFilename),
              upsert: false,
            });

          if (storageErr) {
            const statusCode =
              (storageErr as { statusCode?: string | number }).statusCode ?? '';
            throw new Error(
              `Lỗi Supabase Storage${statusCode ? ` (${statusCode})` : ''}: ${storageErr.message}`
            );
          }

          const { data: urlData } = client.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(storagePath);

          const { error: dbErr } = await client.from('photos').insert({
            session_id: currentSession.id,
            image_url: urlData.publicUrl,
          });

          if (dbErr) {
            throw new Error(
              `Lỗi lưu bảng photos (${dbErr.code ?? 'unknown'}): ${dbErr.message}`
            );
          }

          // B. Best-effort: notify Web relay with the public Storage URL (no heavy base64 payload)
          void fetchWithTimeout(
            `${webOriginRef.current}/api/sync`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'upload_photo',
                session_id: currentSession.id,
                qr_code_hash: currentSession.qr_code_hash,
                client_photo_id: item.id,
                filename: cleanFilename,
                image_url: urlData.publicUrl,
              }),
            },
            4000
          ).catch(() => undefined);

          uploadedIdsSetRef.current.add(item.id);
          successCount += 1;
          setSessionPhotosCount((prev) => prev + 1);
        }

        setUploadedPhotoIds(Array.from(uploadedIdsSetRef.current));
        setSelectedPhotoIds([]);

        const newestTimestamp = Math.max(
          ...itemsToUpload.map((a) => a.creationTime || 0),
          Date.now()
        );
        lastSyncTimeRef.current = newestTimestamp;
        setLastSyncTime(newestTimestamp);

        setStatusMessage(
          `Đã đẩy Live ${successCount} ảnh lên Web • QR #${currentSession.qr_code_hash}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[ShotDropVN] Upload to Supabase failed:', err);
        setStatusMessage(`Lỗi: ${msg}`);
        if (err instanceof SupabaseNotConfiguredError) {
          Alert.alert('Chưa cấu hình Supabase', msg, [
            { text: 'Để sau', style: 'cancel' },
            {
              text: 'Nhập Anon Key',
              onPress: () => {
                setDraftWebOrigin(webOriginRef.current);
                setIsUrlModalVisible(true);
              },
            },
          ]);
        } else {
          Alert.alert('Lỗi đẩy ảnh lên Supabase', msg);
        }
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [ensureActiveSession]
  );

  // Delete one or multiple photos from mobile app list (and sync removal to Web server)
  const executeDeletePhotos = useCallback(async (idsToRemove: string[]) => {
    if (idsToRemove.length === 0) return;

    const idSet = new Set(idsToRemove);
    let uploadedRemovedCount = 0;

    for (const id of idsToRemove) {
      deletedIdsSetRef.current.add(id);
      if (uploadedIdsSetRef.current.has(id)) {
        uploadedIdsSetRef.current.delete(id);
        uploadedRemovedCount += 1;
      }
    }

    setRecentPhotos((prev) => prev.filter((item) => !idSet.has(item.id)));
    setSelectedPhotoIds((prev) => prev.filter((id) => !idSet.has(id)));
    setUploadedPhotoIds(Array.from(uploadedIdsSetRef.current));
    setLongPressedPhotoId(null);

    if (uploadedRemovedCount > 0) {
      setSessionPhotosCount((prev) => Math.max(0, prev - uploadedRemovedCount));
    }

    // Sync removal to Web server (/api/sync)
    try {
      await fetch(`${webOriginRef.current}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_photos',
          client_photo_ids: idsToRemove,
        }),
      });
    } catch {
      // Ignore if offline
    }

    setStatusMessage(`Đã xoá ${idsToRemove.length} ảnh khỏi danh sách.`);
  }, []);

  const confirmDeletePhotos = useCallback(
    (idsToRemove: string[]) => {
      if (idsToRemove.length === 0) return;

      Alert.alert(
        `Xoá ${idsToRemove.length} ảnh?`,
        idsToRemove.length === 1
          ? 'Ảnh này sẽ được xoá khỏi danh sách trên ứng dụng (và gỡ khỏi album Web nếu đã đẩy).'
          : `${idsToRemove.length} ảnh đã chọn sẽ được xoá khỏi danh sách trên ứng dụng (và gỡ khỏi album Web nếu đã đẩy).`,
        [
          { text: 'Huỷ', style: 'cancel' },
          {
            text: 'Xoá ảnh',
            style: 'destructive',
            onPress: () => {
              void executeDeletePhotos(idsToRemove);
            },
          },
        ]
      );
    },
    [executeDeletePhotos]
  );

  // Manual connect / scan USB OTG Camera
  const handleConnectUsbOtgCamera = useCallback(async () => {
    const status = await scanAndConnectUsbCamera();
    setUsbCameraStatus(status);

    if (status.connected) {
      setStatusMessage(
        `Đã kết nối OTG: ${status.deviceName ?? 'Máy ảnh'} (${status.totalPhotosOnCard} ảnh trên thẻ). Bấm chụp để tự động đẩy lên QR!`
      );
    } else if (status.status === 'REQUESTING_PERMISSION') {
      setStatusMessage(
        `Đang xin quyền USB cho ${status.deviceName ?? 'máy ảnh'} — hãy bấm "Cho phép" (OK) trên hộp thoại Android!`
      );
    } else if (status.status === 'NO_USB_DEVICE') {
      Alert.alert(
        'Chưa phát hiện cáp USB OTG',
        'Hãy cắm cáp USB OTG từ máy ảnh (Canon 6D / Sony / Nikon...) vào điện thoại và bật nguồn máy ảnh.'
      );
    }
  }, []);

  // Pull N latest photos from the connected USB OTG camera's SD card and push straight to Web QR
  const handlePullLatestFromOtgCard = useCallback(
    async (count = 5) => {
      if (uploadingRef.current) return;
      setStatusMessage(
        `Đang đọc ${count} ảnh mới nhất từ thẻ nhớ máy ảnh qua cáp OTG...`
      );
      const imported = await pollNewUsbCameraPhotos(count);
      if (imported.length === 0) {
        Alert.alert(
          'Không tìm thấy ảnh JPEG trên máy ảnh',
          'Hãy kiểm tra máy ảnh đã bật nguồn, cắm cáp OTG chắc chắn và chụp ở định dạng JPEG.'
        );
        return;
      }

      const items: LocalPhotoItem[] = imported.map((p) => ({
        id: p.id,
        uri: p.uri,
        filename: p.filename,
        creationTime: p.creationTime,
      }));

      setRecentPhotos((prev) => {
        const existingUris = new Set(items.map((i) => i.uri));
        return [...items, ...prev.filter((p) => !existingUris.has(p.uri))];
      });

      await uploadPhotosBatch(items);
    },
    [uploadPhotosBatch]
  );

  // Optional: Select an OTG / SD card / DCIM folder via Android StorageAccessFramework
  const handleSelectOtgFolder = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const perm =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perm.granted) return;

      const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(
        perm.directoryUri
      );
      const jpegFiles = files.filter((f) =>
        /\.(jpe?g)$/i.test(decodeURIComponent(f))
      );
      knownSafFilesSetRef.current = new Set(jpegFiles);
      setOtgDirectoryUri(perm.directoryUri);
      setStatusMessage(
        `Đang theo dõi Live thư mục OTG (${jpegFiles.length} ảnh sẵn có). Chụp ảnh mới để tự động đẩy lên QR!`
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Không thể mở thư mục OTG';
      Alert.alert('Lỗi chọn thư mục OTG', msg);
    }
  }, []);

  // Pick photos from Canon Connect / System Photo Picker
  const handlePickFromCanonConnect = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: 20,
        quality: 0.88,
        base64: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const pickedItems: LocalPhotoItem[] = result.assets.map((asset, idx) => {
        const itemId = asset.assetId || `${asset.uri}-${idx}`;
        deletedIdsSetRef.current.delete(itemId);
        return {
          id: itemId,
          uri: asset.uri,
          filename:
            asset.fileName || `CANON_${Date.now()}_${idx + 1}.JPG`,
          creationTime: Date.now() + idx,
          base64: asset.base64,
        };
      });

      setRecentPhotos((prev) => {
        const existingUris = new Set(pickedItems.map((p) => p.uri));
        return [
          ...pickedItems,
          ...prev.filter((p) => !existingUris.has(p.uri)),
        ];
      });

      // Automatically upload the picked Canon Connect photos and generate the QR right away!
      await uploadPhotosBatch(pickedItems);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Không thể mở bộ chọn ảnh';
      Alert.alert('Lỗi chọn ảnh', msg);
    }
  }, [uploadPhotosBatch]);

  // Try MediaLibrary for Standalone APK & iOS; gracefully fall back only if running inside restricted Expo Go
  const fetchAndSyncMediaLibrary = useCallback(
    async (options?: { checkAutoUpload?: boolean }) => {
      try {
        const perm = await MediaLibrary.getPermissionsAsync(false, ['photo']);
        if (perm.status !== 'granted') return;

        const result = await MediaLibrary.getAssetsAsync({
          first: 20,
          mediaType: 'photo',
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });

        const assets: LocalPhotoItem[] = (result.assets ?? [])
          .filter((a) => !deletedIdsSetRef.current.has(a.id))
          .map((a) => ({
            id: a.id,
            uri: a.uri,
            filename: a.filename || `IMG_${a.id}.JPG`,
            creationTime: a.creationTime || 0,
          }));

        setRecentPhotos((prev) => {
          if (assets.length === 0) return prev;
          const otgItems = prev.filter((p) => p.id.startsWith('otg-'));
          const existingIds = new Set(otgItems.map((p) => p.id));
          return [
            ...otgItems,
            ...assets.filter((a) => !existingIds.has(a.id)),
          ];
        });

        if (options?.checkAutoUpload && !uploadingRef.current) {
          const threshold = lastSyncTimeRef.current;
          const newlyArrived = assets.filter(
            (a) =>
              a.creationTime > threshold && !uploadedIdsSetRef.current.has(a.id)
          );

          if (newlyArrived.length > 0) {
            await uploadPhotosBatch(newlyArrived);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('Expo Go')) {
          setIsExpoGoAndroidRestricted(true);
        }
      }
    },
    [uploadPhotosBatch]
  );

  // Initialize permissions & USB OTG check on mount
  useEffect(() => {
    async function init() {
      const isExpoGoRuntime = Boolean(
        (globalThis as { expo?: { modules?: { ExpoGo?: unknown } } }).expo
          ?.modules?.ExpoGo
      );

      if (Platform.OS === 'android' && isExpoGoRuntime) {
        setIsExpoGoAndroidRestricted(true);
      } else {
        try {
          const { status } = await MediaLibrary.requestPermissionsAsync(false, [
            'photo',
          ]);
          if (status === 'granted') {
            await fetchAndSyncMediaLibrary({ checkAutoUpload: false });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('Expo Go')) {
            setIsExpoGoAndroidRestricted(true);
          }
        }
      }

      if (isNativeUsbOtgAvailable) {
        const status = await scanAndConnectUsbCamera();
        setUsbCameraStatus(status);
      }
    }

    void init();
  }, [fetchAndSyncMediaLibrary]);

  // Continuous Live OTG & Tether Watcher Loop (Every 1.8 seconds!)
  useEffect(() => {
    if (!isOtgLiveEnabled) return;

    const interval = setInterval(async () => {
      if (isOtgPollingRef.current || uploadingRef.current) return;
      isOtgPollingRef.current = true;

      try {
        // 1. Direct USB OTG PTP/MTP Camera Watcher (Canon 6D / Sony / Nikon plugged via OTG cable)
        if (isNativeUsbOtgAvailable) {
          const status = await scanAndConnectUsbCamera();
          setUsbCameraStatus(status);

          if (status.connected) {
            const newOtgPhotos = await pollNewUsbCameraPhotos(0);
            if (newOtgPhotos.length > 0) {
              const newItems: LocalPhotoItem[] = newOtgPhotos.map((p) => ({
                id: p.id,
                uri: p.uri,
                filename: p.filename,
                creationTime: p.creationTime,
              }));

              setRecentPhotos((prev) => [...newItems, ...prev]);
              await uploadPhotosBatch(newItems);
              return;
            }
          }
        }

        // 2. USB OTG Folder Watcher (StorageAccessFramework) if an OTG folder was selected
        if (otgDirectoryUri) {
          try {
            const files =
              await FileSystem.StorageAccessFramework.readDirectoryAsync(
                otgDirectoryUri
              );
            const newSafFiles = files.filter(
              (f) =>
                /\.(jpe?g)$/i.test(decodeURIComponent(f)) &&
                !knownSafFilesSetRef.current.has(f)
            );

            if (newSafFiles.length > 0) {
              const safItems: LocalPhotoItem[] = newSafFiles.map(
                (fileUri, idx) => {
                  knownSafFilesSetRef.current.add(fileUri);
                  const decoded = decodeURIComponent(fileUri);
                  const namePart =
                    decoded.split('/').pop()?.split(':').pop() ||
                    `OTG_${Date.now()}_${idx}.JPG`;
                  return {
                    id: `otg-saf-${Date.now()}-${idx}`,
                    uri: fileUri,
                    filename: namePart,
                    creationTime: Date.now() + idx,
                  };
                }
              );

              setRecentPhotos((prev) => [...safItems, ...prev]);
              await uploadPhotosBatch(safItems);
              return;
            }
          } catch {
            // Ignore SAF read error if unplugged
          }
        }

        // 3. Continuous Gallery Watcher (for MTP / Canon Connect auto-save into phone gallery)
        if (!isExpoGoAndroidRestricted) {
          await fetchAndSyncMediaLibrary({ checkAutoUpload: true });
        }
      } finally {
        isOtgPollingRef.current = false;
      }
    }, 1800);

    return () => clearInterval(interval);
  }, [
    fetchAndSyncMediaLibrary,
    isExpoGoAndroidRestricted,
    isOtgLiveEnabled,
    otgDirectoryUri,
    uploadPhotosBatch,
  ]);

  // AppState listener when returning to foreground
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active' && !isExpoGoAndroidRestricted) {
        void fetchAndSyncMediaLibrary({ checkAutoUpload: true });
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [fetchAndSyncMediaLibrary, isExpoGoAndroidRestricted]);

  const toggleSelectPhoto = (id: string, keepModalState = false) => {
    setLongPressedPhotoId(null);
    setSelectedPhotoIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id];
      if (!keepModalState && prev.length === 0 && next.length > 0) {
        setIsSelectionMenuExpanded(true);
      }
      return next;
    });
  };

  const handleLongPressPhoto = (id: string) => {
    setLongPressedPhotoId((prev) => (prev === id ? null : id));
  };

  const handleUploadSelected = async (forceNewSession = false) => {
    const selectedItems = recentPhotos.filter((a) =>
      selectedPhotoIds.includes(a.id)
    );
    if (selectedItems.length === 0) {
      await handlePickFromCanonConnect();
      return;
    }
    setIsSelectionMenuExpanded(false);
    await uploadPhotosBatch(selectedItems, { forceNewSession });
  };

  const handleDeleteSelected = () => {
    if (selectedPhotoIds.length === 0) return;
    setIsSelectionMenuExpanded(false);
    confirmDeletePhotos(selectedPhotoIds);
  };

  const handleSelectAllUploaded = () => {
    const uploadedInGrid = recentPhotos
      .filter((p) => uploadedPhotoIds.includes(p.id))
      .map((p) => p.id);
    setSelectedPhotoIds(uploadedInGrid);
    if (uploadedInGrid.length > 0) {
      setIsSelectionMenuExpanded(true);
    }
  };

  const handleSelectAll = () => {
    const allIds = recentPhotos.map((p) => p.id);
    setSelectedPhotoIds(allIds);
    if (allIds.length > 0) {
      setIsSelectionMenuExpanded(true);
    }
  };

  const handleEndSession = () => {
    setActiveSession(null);
    activeSessionRef.current = null;
    setSessionPhotosCount(0);
    setSelectedPhotoIds([]);
    setLongPressedPhotoId(null);
    const now = Date.now();
    setLastSyncTime(now);
    lastSyncTimeRef.current = now;
    setStatusMessage(
      'Đã kết thúc phiên. Bấm chụp qua cáp OTG hoặc chọn ảnh mới để tạo mã QR tiếp theo.'
    );
  };

  const guestUrl = activeSession
    ? buildGuestUrl(activeSession.qr_code_hash, webOrigin)
    : '';

  const handleShareQrLink = async () => {
    if (!activeSession) return;
    try {
      await Share.share({
        title: activeSession.event_name,
        message: `Nhận ảnh sự kiện tại: ${guestUrl}`,
        url: guestUrl,
      });
    } catch {
      // Ignore cancel
    }
  };

  const selectedUploadedCount = selectedPhotoIds.filter((id) =>
    uploadedPhotoIds.includes(id)
  ).length;

  const selectedPreviewPhotos = recentPhotos
    .filter((p) => selectedPhotoIds.includes(p.id))
    .slice(0, 3);

  const toggleExpandPopupModal = () => {
    setIsSelectionMenuExpanded((prev) => {
      const next = !prev;
      snapPopupTo(0, next ? -12 : 0);
      return next;
    });
  };

  return (
    <View style={styles.safeArea}>
      <ExpoStatusBar style="dark" />

      {/* Top Studio Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            setDraftWebOrigin(webOrigin);
            setIsUrlModalVisible(true);
          }}
          style={styles.brandRow}
        >
          <Image
            source={require('./assets/icon.png')}
            style={styles.brandLogo}
          />
          <View style={styles.brandTextCol}>
            <View style={styles.brandTitleRow}>
              <Text style={styles.brandTitle}>ShotDrop VN</Text>
              <View style={styles.versionBadge}>
                <Text style={styles.versionBadgeText}>v{APP_VERSION}</Text>
              </View>
            </View>
            <Text style={styles.brandSub} numberOfLines={1}>
              {webOrigin.replace(/^https?:\/\//, '')} • Đổi URL
            </Text>
          </View>
        </Pressable>

        <View
          style={[
            styles.statusBadge,
            activeSession || usbCameraStatus.connected
              ? styles.statusBadgeLive
              : styles.statusBadgeStandby,
          ]}
        >
          <View
            style={[
              styles.statusDot,
              activeSession || usbCameraStatus.connected
                ? styles.dotLive
                : styles.dotStandby,
            ]}
          />
          <Text
            style={[
              styles.statusBadgeText,
              (activeSession || usbCameraStatus.connected) &&
                styles.statusBadgeTextLive,
            ]}
          >
            {usbCameraStatus.connected
              ? 'OTG LIVE'
              : activeSession
                ? 'LIVE QR'
                : 'STANDBY'}
          </Text>
        </View>
      </View>

      <FlatList
        data={recentPhotos}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[
          styles.listContent,
          selectedPhotoIds.length > 0 && styles.listContentWithBottomBar,
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            {/* 1. Live QR Studio Deck */}
            <View style={styles.sessionCard}>
              {activeSession ? (
                <View style={styles.activeSessionBox}>
                  <View style={styles.sessionTopRow}>
                    <View style={styles.sessionIdentityCol}>
                      <View style={styles.sessionTitleRow}>
                        <Text style={styles.sessionHashText}>
                          #{activeSession.qr_code_hash}
                        </Text>
                        <View style={styles.liveTagPill}>
                          <View style={styles.dotLiveSmall} />
                          <Text style={styles.liveTagText}>ĐANG PHÁT</Text>
                        </View>
                      </View>
                      <Text style={styles.sessionEventName} numberOfLines={1}>
                        {activeSession.event_name}
                      </Text>
                    </View>

                    <View style={styles.counterBox}>
                      <Text style={styles.counterValue}>
                        {sessionPhotosCount}
                      </Text>
                      <Text style={styles.counterLabel}>ảnh trên Web</Text>
                    </View>
                  </View>

                  {/* Precision QR Viewfinder Frame */}
                  <View style={styles.qrOuterStage}>
                    <View style={[styles.qrCorner, styles.qrCornerTL]} />
                    <View style={[styles.qrCorner, styles.qrCornerTR]} />
                    <View style={[styles.qrCorner, styles.qrCornerBL]} />
                    <View style={[styles.qrCorner, styles.qrCornerBR]} />

                    <View style={styles.qrFrame}>
                      <QRCode
                        value={guestUrl}
                        size={190}
                        color={colors.textPrimary}
                        backgroundColor={colors.surface}
                      />
                    </View>
                  </View>

                  <Pressable
                    onPress={handleShareQrLink}
                    style={({ pressed }) => [
                      styles.guestUrlPill,
                      pressed && styles.subtlePressed,
                    ]}
                  >
                    <Text style={styles.guestUrlText} numberOfLines={1}>
                      {guestUrl}
                    </Text>
                  </Pressable>

                  {/* Pulsing Live Sync Banner */}
                  <Animated.View
                    style={[styles.pulsingBanner, { opacity: pulseAnim }]}
                  >
                    <View style={styles.dotLive} />
                    <Text style={styles.pulsingBannerText}>
                      Đồng bộ Live đang bật • Chụp thêm để tự động đẩy vào QR này
                    </Text>
                  </Animated.View>

                  <View style={styles.sessionActionRow}>
                    <Pressable
                      onPress={handleShareQrLink}
                      accessibilityRole="button"
                      accessibilityLabel="Chia sẻ đường dẫn nhận ảnh"
                      style={({ pressed }) => [
                        styles.shareLinkBtn,
                        pressed && styles.subtlePressed,
                      ]}
                    >
                      <ShareArrowIcon size={17} color={colors.textPrimary} />
                      <Text style={styles.shareLinkBtnText}>Chia sẻ Link</Text>
                    </Pressable>

                    <Pressable
                      onPress={handleEndSession}
                      accessibilityRole="button"
                      accessibilityLabel="Kết thúc phiên chụp hiện tại"
                      style={({ pressed }) => [
                        styles.endSessionBtn,
                        pressed && styles.primaryPressed,
                      ]}
                    >
                      <CloseIcon size={15} color={colors.textInverse} />
                      <Text style={styles.endSessionBtnText}>
                        Kết thúc phiên
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.standbyBox}>
                  <View style={styles.standbyIconBadge}>
                    <QrViewfinderIcon size={26} color={colors.textPrimary} />
                  </View>
                  <Text style={styles.standbyHeadline}>
                    Chụp ảnh qua cáp OTG hoặc chọn ảnh để mở mã QR Live
                  </Text>
                  <Text style={styles.standbySub}>
                    Khi cắm cáp USB OTG và bấm cò máy ảnh, ảnh vừa chụp sẽ tự
                    động đẩy thẳng lên trang Web và hiển thị mã QR tại đây.
                  </Text>
                </View>
              )}
            </View>

            {/* 2. Unified USB OTG Tether & Import Console */}
            <View
              style={[
                styles.tetherConsole,
                usbCameraStatus.connected && styles.tetherConsoleConnected,
              ]}
            >
              <View style={styles.otgHeaderRow}>
                <View style={styles.otgTitleCol}>
                  <View style={styles.otgStatusHeadlineRow}>
                    <View
                      style={[
                        styles.statusDot,
                        usbCameraStatus.connected
                          ? styles.dotLive
                          : isOtgLiveEnabled
                            ? styles.dotWarning
                            : styles.dotStandby,
                      ]}
                    />
                    <Text style={styles.otgHeadline} numberOfLines={1}>
                      {usbCameraStatus.connected
                        ? `Đã kết nối OTG • ${usbCameraStatus.deviceName}`
                        : otgDirectoryUri
                          ? 'Đang theo dõi thư mục OTG Live'
                          : 'Cáp USB OTG & Canon Connect'}
                    </Text>
                  </View>

                  <Text style={styles.otgSubtext}>
                    {usbCameraStatus.connected
                      ? `Đang có ${usbCameraStatus.totalPhotosOnCard} ảnh JPEG trên thẻ. Bấm chụp để tự động đẩy thẳng lên QR Web.`
                      : 'Tự động hút ảnh JPEG vừa chụp qua cáp USB OTG (PTP/MTP) hoặc chọn ảnh từ Canon Connect.'}
                  </Text>
                </View>

                <Pressable
                  onPress={() => setIsOtgLiveEnabled((prev) => !prev)}
                  hitSlop={8}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isOtgLiveEnabled }}
                  accessibilityLabel="Tự động đồng bộ ảnh qua cáp OTG"
                  style={[
                    styles.otgToggleBtn,
                    isOtgLiveEnabled
                      ? styles.otgToggleBtnOn
                      : styles.otgToggleBtnOff,
                  ]}
                >
                  <BoltIcon
                    size={13}
                    color={
                      isOtgLiveEnabled
                        ? colors.textInverse
                        : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.otgToggleBtnText,
                      isOtgLiveEnabled && styles.otgToggleBtnTextOn,
                    ]}
                  >
                    {isOtgLiveEnabled ? 'AUTO ON' : 'TẮT'}
                  </Text>
                </Pressable>
              </View>

              {/* Primary CTA: Pick from Canon Connect / Photo Library */}
              <Pressable
                onPress={handlePickFromCanonConnect}
                disabled={uploading}
                accessibilityRole="button"
                accessibilityLabel="Chọn ảnh từ thư viện hoặc Canon Connect"
                style={({ pressed }) => [
                  styles.canonConnectHeroBtn,
                  uploading && styles.btnDisabled,
                  pressed && styles.primaryPressed,
                ]}
              >
                {uploading ? (
                  <View style={styles.uploadingRow}>
                    <ActivityIndicator size="small" color={colors.textInverse} />
                    <Text
                      style={styles.canonConnectHeroBtnText}
                      numberOfLines={1}
                    >
                      {statusMessage}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.canonBtnInner}>
                    <View style={styles.canonBtnTitleRow}>
                      <CameraApertureIcon size={19} color={colors.textInverse} />
                      <Text style={styles.canonConnectHeroBtnText}>
                        Chọn ảnh từ thư viện / Canon Connect
                      </Text>
                    </View>
                    <Text style={styles.canonConnectHeroBtnSub}>
                      Chọn nhiều ảnh trên điện thoại → Đẩy lên Web & Tạo mã QR
                    </Text>
                  </View>
                )}
              </Pressable>

              {/* Secondary OTG Hardware Controls */}
              <View style={styles.otgActionButtonsRow}>
                <Pressable
                  onPress={handleConnectUsbOtgCamera}
                  disabled={uploading}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.otgSecondaryBtn,
                    pressed && styles.subtlePressed,
                  ]}
                >
                  <UsbCableIcon size={16} color={colors.textPrimary} />
                  <Text style={styles.otgSecondaryBtnText}>
                    {usbCameraStatus.connected
                      ? 'Kiểm tra OTG'
                      : 'Kết nối cáp OTG'}
                  </Text>
                </Pressable>

                {usbCameraStatus.connected ? (
                  <Pressable
                    onPress={() => {
                      void handlePullLatestFromOtgCard(5);
                    }}
                    disabled={uploading}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.otgPrimaryBtn,
                      pressed && styles.primaryPressed,
                    ]}
                  >
                    <DownloadTrayIcon size={16} color={colors.textInverse} />
                    <Text style={styles.otgPrimaryBtnText}>
                      Lấy 5 ảnh vừa chụp
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={handleSelectOtgFolder}
                    disabled={uploading}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.otgSecondaryBtn,
                      pressed && styles.subtlePressed,
                    ]}
                  >
                    <FolderOpenIcon size={16} color={colors.textPrimary} />
                    <Text style={styles.otgSecondaryBtnText}>
                      Thư mục OTG / Thẻ nhớ
                    </Text>
                  </Pressable>
                )}
              </View>

              {/* Live Status Bar inside Console */}
              <View style={styles.consoleStatusFooter}>
                <Text style={styles.statusLineText} numberOfLines={2}>
                  {statusMessage}
                </Text>
                <Text style={styles.hintLineText}>
                  Chạm để chọn nhiều ảnh hoặc nhấn giữ vào ảnh để hiện nút
                  Upload tiếp / Xoá nhanh.
                </Text>
              </View>
            </View>

            {/* 3. Grid Section Header & Quick Filter Chips */}
            <View style={styles.gridHeaderRow}>
              <View style={styles.gridTitleGroup}>
                <Text style={styles.gridHeaderTitle}>Ảnh trong phiên</Text>
                <View style={styles.gridCountPill}>
                  <Text style={styles.gridCountPillText}>
                    {recentPhotos.length}
                  </Text>
                </View>
              </View>

              <View style={styles.gridHeaderActions}>
                {uploadedPhotoIds.length > 0 && (
                  <Pressable
                    onPress={handleSelectAllUploaded}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.filterChip,
                      pressed && styles.subtlePressed,
                    ]}
                  >
                    <CheckIcon size={12} color={colors.liveDark} />
                    <Text style={styles.filterChipText}>
                      Đã đẩy ({uploadedPhotoIds.length})
                    </Text>
                  </Pressable>
                )}

                {recentPhotos.length > 0 &&
                  selectedPhotoIds.length < recentPhotos.length && (
                    <Pressable
                      onPress={handleSelectAll}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.filterChip,
                        pressed && styles.subtlePressed,
                      ]}
                    >
                      <Text style={styles.filterChipText}>Chọn tất cả</Text>
                    </Pressable>
                  )}

                {selectedPhotoIds.length > 0 && (
                  <Pressable
                    onPress={() => setSelectedPhotoIds([])}
                    hitSlop={8}
                    style={styles.clearSelectionBtn}
                  >
                    <Text style={styles.clearSelectionText}>Bỏ chọn</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const isSelected = selectedPhotoIds.includes(item.id);
          const isUploaded = uploadedPhotoIds.includes(item.id);
          const isLongPressed = longPressedPhotoId === item.id;

          return (
            <Pressable
              onPress={() => {
                if (isLongPressed) {
                  setLongPressedPhotoId(null);
                  return;
                }
                toggleSelectPhoto(item.id);
              }}
              onLongPress={() => handleLongPressPhoto(item.id)}
              delayLongPress={240}
              accessibilityRole="imagebutton"
              accessibilityState={{ selected: isSelected }}
              style={[
                styles.photoTile,
                isSelected && styles.photoTileSelected,
              ]}
            >
              <Image source={{ uri: item.uri }} style={styles.photoImage} />

              {isUploaded && !isLongPressed && (
                <View style={styles.uploadedBadge}>
                  <CheckIcon size={10} color={colors.textInverse} />
                  <Text style={styles.uploadedBadgeText}>Đã lên Web</Text>
                </View>
              )}

              {!isLongPressed && (
                <View
                  style={[
                    styles.checkCircle,
                    isSelected && styles.checkCircleSelected,
                  ]}
                >
                  {isSelected && (
                    <CheckIcon size={13} color={colors.textInverse} />
                  )}
                </View>
              )}

              {/* Long-Press Quick Action Overlay (Vector Upload & Delete Icons) */}
              {isLongPressed && (
                <View style={styles.longPressOverlay}>
                  <Pressable
                    onPress={() => setLongPressedPhotoId(null)}
                    style={styles.overlayCloseBtn}
                    hitSlop={10}
                    accessibilityLabel="Đóng menu thao tác nhanh"
                  >
                    <CloseIcon size={12} color={colors.textInverse} />
                  </Pressable>

                  <View style={styles.longPressButtonsRow}>
                    <Pressable
                      onPress={() => {
                        void uploadPhotosBatch([item]);
                      }}
                      disabled={uploading}
                      accessibilityLabel="Upload tiếp ảnh này"
                      style={({ pressed }) => [
                        styles.iconCircleBtn,
                        styles.iconCircleUpload,
                        pressed && styles.primaryPressed,
                      ]}
                    >
                      <UploadArrowIcon size={18} color={colors.textInverse} />
                      <Text style={styles.iconCircleLabel}>Upload</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => confirmDeletePhotos([item.id])}
                      disabled={uploading}
                      accessibilityLabel="Xoá ảnh này"
                      style={({ pressed }) => [
                        styles.iconCircleBtn,
                        styles.iconCircleDelete,
                        pressed && styles.primaryPressed,
                      ]}
                    >
                      <TrashIcon size={17} color={colors.textInverse} />
                      <Text style={styles.iconCircleLabel}>Xoá</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <View style={styles.emptyIconCircle}>
              <CameraApertureIcon size={24} color={colors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>
              Đang chờ ảnh mới từ cáp USB OTG hoặc thư viện
            </Text>
            <Text style={styles.emptySub}>
              Cắm cáp USB OTG từ máy ảnh vào điện thoại và bấm chụp để ảnh tự
              động đẩy lên Web, hoặc nhấn nút chọn ảnh phía trên.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.versionFooterWrap}>
            <Text style={styles.versionFooterText}>
              ShotDropVN Studio • Version {APP_VERSION} (Build 3)
            </Text>
          </View>
        }
      />

      {/* Compact Floating Trigger Bar when Centered Modal is minimized for picking more photos on grid */}
      {selectedPhotoIds.length > 0 && !isSelectionMenuExpanded && (
        <View style={styles.minimizedSelectionBarWrap}>
          <Pressable
            onPress={() => {
              snapPopupTo(0, 0);
              setIsSelectionMenuExpanded(true);
            }}
            style={({ pressed }) => [
              styles.minimizedSelectionPill,
              pressed && styles.primaryPressed,
            ]}
          >
            <View style={styles.minimizedCountBadge}>
              <Text style={styles.minimizedCountText}>
                {selectedPhotoIds.length}
              </Text>
            </View>
            <Text style={styles.minimizedPillTitle} numberOfLines={1}>
              Đã chọn {selectedPhotoIds.length} ảnh • Chạm để mở hộp thoại
            </Text>
            <View style={styles.minimizedOpenActionTag}>
              <Text style={styles.minimizedOpenActionText}>Mở</Text>
            </View>
          </Pressable>
        </View>
      )}

      {/* Centered Dialog Modal ("Đã chọn X ảnh") right in the middle of the screen */}
      <Modal
        visible={selectedPhotoIds.length > 0 && isSelectionMenuExpanded}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSelectionMenuExpanded(false)}
      >
        <Pressable
          onPress={() => setIsSelectionMenuExpanded(false)}
          style={styles.centerSelectionBackdrop}
        >
          <Animated.View
            style={[
              styles.centerSelectionCard,
              {
                transform: [
                  { translateX: popupPan.x },
                  { translateY: popupPan.y },
                  { scale: popupScaleAnim },
                ],
              },
            ]}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={styles.centerSelectionCardInner}
            >
              {/* Draggable Top Handle */}
              <View
                {...popupPanResponder.panHandlers}
                style={styles.sheetGrabberZone}
              >
                <View style={styles.sheetGrabber} />
              </View>

              {/* Center Modal Header */}
              <View
                {...popupPanResponder.panHandlers}
                style={styles.centerModalHeader}
              >
                <View style={styles.selectionSummaryRow}>
                  <View style={styles.centerModalCountCircle}>
                    <Text style={styles.centerModalCountText}>
                      {selectedPhotoIds.length}
                    </Text>
                  </View>

                  <View style={styles.selectionTitleCol}>
                    <Text style={styles.centerModalTitle}>
                      Đã chọn {selectedPhotoIds.length} ảnh
                    </Text>
                    <Text style={styles.centerModalSubtitle} numberOfLines={1}>
                      {selectedUploadedCount > 0
                        ? `Có ${selectedUploadedCount} ảnh đã lên Web`
                        : 'Sẵn sàng đẩy lên mã QR hoặc xoá'}
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => setIsSelectionMenuExpanded(false)}
                  hitSlop={8}
                  accessibilityLabel="Đóng hộp thoại"
                  style={({ pressed }) => [
                    styles.quickClearCircleBtn,
                    pressed && styles.subtlePressed,
                  ]}
                >
                  <CloseIcon size={14} color={colors.textSecondary} />
                </Pressable>
              </View>

              {/* Horizontal Scrollable Photo Strip inside Center Modal */}
              <View style={styles.centerStripSection}>
                <View style={styles.centerStripHeaderRow}>
                  <Text style={styles.centerStripLabel}>
                    Chạm vào ảnh bên dưới để chọn / bỏ chọn nhanh:
                  </Text>
                </View>

                <FlatList
                  data={recentPhotos}
                  keyExtractor={(item) => `modal-${item.id}`}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.centerStripList}
                  renderItem={({ item }) => {
                    const isItemSelected = selectedPhotoIds.includes(item.id);
                    const isItemUploaded = uploadedPhotoIds.includes(item.id);

                    return (
                      <Pressable
                        onPress={() => toggleSelectPhoto(item.id, true)}
                        style={[
                          styles.centerStripThumbWrap,
                          isItemSelected && styles.centerStripThumbSelected,
                        ]}
                      >
                        <Image
                          source={{ uri: item.uri }}
                          style={styles.centerStripThumbImg}
                        />
                        {isItemUploaded && (
                          <View style={styles.centerStripLiveDot} />
                        )}
                        <View
                          style={[
                            styles.centerStripCheckBadge,
                            isItemSelected &&
                              styles.centerStripCheckBadgeActive,
                          ]}
                        >
                          {isItemSelected && (
                            <CheckIcon size={10} color={colors.textInverse} />
                          )}
                        </View>
                      </Pressable>
                    );
                  }}
                />
              </View>

              {/* Quick Filter Chips inside Center Modal */}
              <View style={styles.expandedQuickSelectRow}>
                <Pressable
                  onPress={handleSelectAll}
                  style={({ pressed }) => [
                    styles.expandedChipBtn,
                    pressed && styles.subtlePressed,
                  ]}
                >
                  <CheckIcon size={12} color={colors.textPrimary} />
                  <Text style={styles.expandedChipBtnText}>
                    Chọn tất cả ({recentPhotos.length})
                  </Text>
                </Pressable>

                {uploadedPhotoIds.length > 0 && (
                  <Pressable
                    onPress={handleSelectAllUploaded}
                    style={({ pressed }) => [
                      styles.expandedChipBtn,
                      pressed && styles.subtlePressed,
                    ]}
                  >
                    <CheckIcon size={12} color={colors.liveDark} />
                    <Text style={styles.expandedChipBtnText}>
                      Đã đẩy ({uploadedPhotoIds.length})
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  onPress={() => setIsSelectionMenuExpanded(false)}
                  style={({ pressed }) => [
                    styles.expandedChipBtn,
                    pressed && styles.subtlePressed,
                  ]}
                >
                  <Text style={styles.expandedChipBtnText}>
                    Chọn thêm trên lưới
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setSelectedPhotoIds([]);
                    setIsSelectionMenuExpanded(false);
                  }}
                  style={[styles.expandedChipBtn, styles.expandedChipClear]}
                >
                  <CloseIcon size={12} color={colors.error} />
                  <Text style={styles.expandedChipClearText}>Bỏ chọn hết</Text>
                </Pressable>
              </View>

              {/* Full-Width Primary Actions Stack */}
              <View style={styles.centerModalActionsStack}>
                {/* 1. Primary Upload to Current or New QR */}
                <Pressable
                  onPress={() => {
                    void handleUploadSelected(false);
                  }}
                  disabled={uploading}
                  style={({ pressed }) => [
                    styles.centerPrimaryUploadBtn,
                    uploading && styles.btnDisabled,
                    pressed && styles.primaryPressed,
                  ]}
                >
                  <View style={styles.menuUploadIconBadge}>
                    <UploadArrowIcon size={18} color={colors.textInverse} />
                  </View>
                  <View style={styles.menuUploadTextCol}>
                    <Text style={styles.centerPrimaryUploadTitle}>
                      {activeSession
                        ? `Upload tiếp ${selectedPhotoIds.length} ảnh vào QR hiện tại`
                        : `Tạo mã QR & Upload ${selectedPhotoIds.length} ảnh`}
                    </Text>
                    <Text style={styles.centerPrimaryUploadSub}>
                      {activeSession
                        ? `Đẩy thẳng lên phiên #${activeSession.qr_code_hash}`
                        : 'Khởi tạo ngay mã QR Live mới trên Web'}
                    </Text>
                  </View>
                </Pressable>

                {/* 2. Split into Brand New QR Session */}
                <Pressable
                  onPress={() => {
                    void handleUploadSelected(true);
                  }}
                  disabled={uploading}
                  style={({ pressed }) => [
                    styles.expandedMenuOptionBtn,
                    pressed && styles.subtlePressed,
                  ]}
                >
                  <View style={styles.expandedOptionIconBox}>
                    <SparklesIcon size={18} color={colors.liveDark} />
                  </View>
                  <View style={styles.expandedOptionTextCol}>
                    <Text style={styles.expandedOptionTitle}>
                      Tạo mã QR mới & Upload riêng {selectedPhotoIds.length} ảnh
                    </Text>
                    <Text style={styles.expandedOptionDesc}>
                      Tách sang một album QR độc lập hoàn toàn
                    </Text>
                  </View>
                </Pressable>

                {/* 3. Delete Selected Photos */}
                <Pressable
                  onPress={handleDeleteSelected}
                  disabled={uploading}
                  style={({ pressed }) => [
                    styles.centerDeleteBtn,
                    uploading && styles.btnDisabled,
                    pressed && styles.primaryPressed,
                  ]}
                >
                  <TrashIcon size={16} color={colors.error} />
                  <Text style={styles.menuDeleteBtnText}>
                    Xoá {selectedPhotoIds.length} ảnh đã chọn khỏi danh sách
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Popup Modal to View / Update Public Web URL anytime without rebuilding */}
      <Modal
        visible={isUrlModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsUrlModalVisible(false)}
      >
        <Pressable
          onPress={() => setIsUrlModalVisible(false)}
          style={styles.urlModalOverlay}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={styles.urlModalCard}
          >
            <View style={styles.urlModalHeader}>
              <Text style={styles.urlModalTitle}>Cấu hình URL Web Public</Text>
              <Pressable
                onPress={() => setIsUrlModalVisible(false)}
                hitSlop={8}
                style={styles.quickClearCircleBtn}
              >
                <CloseIcon size={13} color={colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.urlModalDesc}>
              Mã QR và đồng bộ ảnh sẽ sử dụng trực tiếp địa chỉ HTTPS bên dưới
              (hoạt động trên mọi mạng 4G/5G/Wi-Fi, không phụ thuộc IP
              localhost):
            </Text>

            <TextInput
              value={draftWebOrigin}
              onChangeText={setDraftWebOrigin}
              placeholder="https://..."
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.urlModalInput}
            />

            <View style={styles.urlModalPresetRow}>
              <Pressable
                onPress={() => setDraftWebOrigin(RENDER_WEB_URL)}
                style={styles.expandedChipBtn}
              >
                <Text style={styles.expandedChipBtnText}>
                  Render (shotdropvn-web.onrender.com)
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setDraftWebOrigin(PUBLIC_CLOUDFLARE_WEB_URL)}
                style={styles.expandedChipBtn}
              >
                <Text style={styles.expandedChipBtnText}>
                  Cloudflare HTTPS Live
                </Text>
              </Pressable>
            </View>

            {/* Supabase Storage Anon Key */}
            <View style={styles.supabaseKeyHeaderRow}>
              <Text style={styles.urlModalTitle}>Supabase Storage</Text>
              <View
                style={[
                  styles.supabaseStatusPill,
                  supabaseReady
                    ? styles.supabaseStatusPillOk
                    : styles.supabaseStatusPillMissing,
                ]}
              >
                <Text
                  style={[
                    styles.supabaseStatusPillText,
                    supabaseReady
                      ? styles.supabaseStatusTextOk
                      : styles.supabaseStatusTextMissing,
                  ]}
                >
                  {supabaseReady ? 'Đã kết nối' : 'Thiếu Anon Key'}
                </Text>
              </View>
            </View>
            <Text style={styles.urlModalDesc} numberOfLines={1}>
              {SUPABASE_PROJECT_URL.replace(/^https?:\/\//, '')}
            </Text>
            <TextInput
              value={draftAnonKey}
              onChangeText={setDraftAnonKey}
              placeholder="Dán anon public key (eyJ...) hoặc sb_publishable_..."
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={false}
              multiline
              numberOfLines={3}
              style={[styles.urlModalInput, styles.supabaseKeyInput]}
            />

            <View style={styles.urlModalActionsRow}>
              <Pressable
                onPress={() => setIsUrlModalVisible(false)}
                style={[styles.otgSecondaryBtn, { flex: 1 }]}
              >
                <Text style={styles.otgSecondaryBtnText}>Huỷ</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  void handleSaveWebOrigin();
                }}
                style={[styles.otgPrimaryBtn, { flex: 1.4 }]}
              >
                <Text style={styles.otgPrimaryBtnText}>Lưu URL Web</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.canvas,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  brandTextCol: {
    flex: 1,
  },
  brandLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  supabaseKeyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  supabaseStatusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  supabaseStatusPillOk: {
    backgroundColor: colors.liveSoft,
    borderColor: colors.liveBorder,
  },
  supabaseStatusPillMissing: {
    backgroundColor: colors.subtle,
    borderColor: colors.error,
  },
  supabaseStatusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  supabaseStatusTextOk: {
    color: colors.liveDark,
  },
  supabaseStatusTextMissing: {
    color: colors.error,
  },
  supabaseKeyInput: {
    minHeight: 64,
    fontSize: 12,
    textAlignVertical: 'top',
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  versionBadge: {
    backgroundColor: colors.subtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  versionBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },
  versionFooterWrap: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionFooterText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  brandSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    gap: 6,
  },
  statusBadgeLive: {
    backgroundColor: colors.liveSoft,
    borderColor: colors.liveBorder,
  },
  statusBadgeStandby: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotLive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.live,
  },
  dotLiveSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.live,
  },
  dotWarning: {
    backgroundColor: colors.warning,
  },
  dotStandby: {
    backgroundColor: colors.textMuted,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },
  statusBadgeTextLive: {
    color: colors.liveDark,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl * 2,
  },
  listContentWithBottomBar: {
    paddingBottom: 248,
  },
  headerStack: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    shadowColor: '#111110',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  activeSessionBox: {
    alignItems: 'center',
    width: '100%',
  },
  sessionTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sessionIdentityCol: {
    flex: 1,
    gap: 2,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionHashText: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  liveTagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.liveSoft,
    borderWidth: 1,
    borderColor: colors.liveBorder,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  liveTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.liveDark,
    letterSpacing: 0.3,
  },
  sessionEventName: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  counterBox: {
    backgroundColor: colors.subtle,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.md,
    alignItems: 'center',
    minWidth: 82,
  },
  counterValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  counterLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  qrOuterStage: {
    position: 'relative',
    padding: 10,
    marginBottom: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCorner: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderColor: colors.textPrimary,
  },
  qrCornerTL: {
    top: 2,
    left: 2,
    borderTopWidth: 2.5,
    borderLeftWidth: 2.5,
    borderTopLeftRadius: 6,
  },
  qrCornerTR: {
    top: 2,
    right: 2,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    borderTopRightRadius: 6,
  },
  qrCornerBL: {
    bottom: 2,
    left: 2,
    borderBottomWidth: 2.5,
    borderLeftWidth: 2.5,
    borderBottomLeftRadius: 6,
  },
  qrCornerBR: {
    bottom: 2,
    right: 2,
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
    borderBottomRightRadius: 6,
  },
  qrFrame: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  guestUrlPill: {
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    marginBottom: spacing.sm,
    maxWidth: '100%',
  },
  guestUrlText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pulsingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.liveSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.pill,
    gap: 8,
    marginBottom: spacing.md,
  },
  pulsingBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.liveDark,
    textAlign: 'center',
    flexShrink: 1,
  },
  sessionActionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: spacing.sm,
  },
  shareLinkBtn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    gap: 7,
    backgroundColor: colors.subtle,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareLinkBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  endSessionBtn: {
    flex: 1.2,
    minHeight: 48,
    flexDirection: 'row',
    gap: 7,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endSessionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textInverse,
  },
  standbyBox: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: 6,
  },
  standbyIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  standbyHeadline: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  standbySub: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  tetherConsole: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#111110',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
  tetherConsoleConnected: {
    borderColor: colors.live,
    backgroundColor: '#F6FEF9',
  },
  otgHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  otgTitleCol: {
    flex: 1,
    gap: 4,
  },
  otgStatusHeadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  otgHeadline: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  otgSubtext: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  otgToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  otgToggleBtnOn: {
    backgroundColor: colors.live,
    borderColor: colors.live,
  },
  otgToggleBtnOff: {
    backgroundColor: colors.subtle,
    borderColor: colors.border,
  },
  otgToggleBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  otgToggleBtnTextOn: {
    color: colors.textInverse,
  },
  canonConnectHeroBtn: {
    minHeight: 54,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canonBtnInner: {
    alignItems: 'center',
    gap: 3,
  },
  canonBtnTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  canonConnectHeroBtnText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  canonConnectHeroBtnSub: {
    color: '#D4D4D0',
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
  otgActionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  otgSecondaryBtn: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.subtle,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otgSecondaryBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  otgPrimaryBtn: {
    flex: 1.35,
    minHeight: 46,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.live,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otgPrimaryBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textInverse,
    textAlign: 'center',
  },
  consoleStatusFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: 2,
  },
  statusLineText: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  hintLineText: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  gridHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  gridTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  gridHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  gridCountPill: {
    backgroundColor: colors.subtle,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  gridCountPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  gridHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  clearSelectionBtn: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  clearSelectionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.error,
  },
  gridRow: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  photoTile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.subtle,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  photoTileSelected: {
    borderColor: colors.live,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  uploadedBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(22, 163, 74, 0.94)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  uploadedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textInverse,
  },
  checkCircle: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.surface,
    backgroundColor: 'rgba(17, 17, 16, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleSelected: {
    backgroundColor: colors.live,
    borderColor: colors.surface,
  },
  longPressOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.scrimStrong,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  overlayCloseBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  longPressButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  iconCircleBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  iconCircleUpload: {
    backgroundColor: colors.live,
  },
  iconCircleDelete: {
    backgroundColor: colors.error,
  },
  iconCircleLabel: {
    fontSize: 8,
    color: colors.textInverse,
    fontWeight: '800',
  },
  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: 8,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  minimizedSelectionBarWrap: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 24 : 16,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  minimizedSelectionPill: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 16,
    elevation: 16,
  },
  minimizedCountBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 14,
    backgroundColor: colors.live,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minimizedCountText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  minimizedPillTitle: {
    flex: 1,
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: '700',
  },
  minimizedOpenActionTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  minimizedOpenActionText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '800',
  },
  centerSelectionBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 17, 16, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  centerSelectionCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 28,
    overflow: 'hidden',
  },
  centerSelectionCardInner: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 14,
  },
  sheetGrabberZone: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  sheetGrabber: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
  },
  centerModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectionSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  centerModalCountCircle: {
    minWidth: 42,
    height: 42,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: colors.live,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerModalCountText: {
    color: colors.textInverse,
    fontSize: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  selectionTitleCol: {
    flex: 1,
    gap: 2,
  },
  centerModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  centerModalSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  quickClearCircleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerStripSection: {
    backgroundColor: colors.canvas,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    gap: 8,
  },
  centerStripHeaderRow: {
    paddingHorizontal: 12,
  },
  centerStripLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  centerStripList: {
    paddingHorizontal: 12,
    gap: 8,
  },
  centerStripThumbWrap: {
    width: 62,
    height: 62,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
    backgroundColor: colors.subtle,
  },
  centerStripThumbSelected: {
    borderColor: colors.live,
  },
  centerStripThumbImg: {
    width: '100%',
    height: '100%',
  },
  centerStripLiveDot: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.live,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  centerStripCheckBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.surface,
    backgroundColor: 'rgba(17, 17, 16, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerStripCheckBadgeActive: {
    backgroundColor: colors.live,
  },
  centerModalActionsStack: {
    gap: 10,
  },
  centerPrimaryUploadBtn: {
    width: '100%',
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.live,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  menuUploadIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuUploadTextCol: {
    flex: 1,
    gap: 1,
  },
  centerPrimaryUploadTitle: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '800',
  },
  centerPrimaryUploadSub: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 11,
    fontWeight: '600',
  },
  centerDeleteBtn: {
    width: '100%',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.errorSoft,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  menuDeleteBtnText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '800',
  },
  expandedMenuSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  expandedMenuOptionBtn: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  expandedOptionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.liveSoft,
    borderWidth: 1,
    borderColor: colors.liveBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedOptionTextCol: {
    flex: 1,
    gap: 1,
  },
  expandedOptionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  expandedOptionDesc: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  expandedQuickSelectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  expandedChipBtn: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.subtle,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radii.pill,
  },
  expandedChipBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  expandedChipClear: {
    backgroundColor: colors.errorSoft,
  },
  expandedChipClearText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
  },
  subtlePressed: {
    backgroundColor: colors.subtlePressed,
  },
  primaryPressed: {
    opacity: 0.86,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  urlModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 17, 16, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  urlModalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 24,
  },
  urlModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  urlModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  urlModalDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  urlModalInput: {
    backgroundColor: colors.canvas,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  urlModalPresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  urlModalActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
});
