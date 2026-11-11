import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import type { ActiveSession, LocalPhotoItem } from '../types';
import {
  STORAGE_BUCKET,
  getSupabaseClient,
} from '../lib/supabase';
import {
  getCameraPhotosSummary,
  importCameraHandles,
  isNativeUsbOtgAvailable,
  syncUsbCamera,
  type CameraCardPhotoItem,
  type ImportedOtgPhoto,
  type UsbCameraStatus,
} from '../lib/usbOtg';
import { SupabaseNotConfiguredError } from './useActiveSession';

const ACTIVE_PHOTOS_FILE = 'shotdrop_active_photos.json';

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

function mapImportedOtgPhoto(p: ImportedOtgPhoto): LocalPhotoItem {
  return {
    id: p.id,
    uri: p.uri,
    filename: p.filename,
    creationTime: p.creationTime,
    cameraHandle: p.handle,
    cameraKey: p.cameraKey,
    fileSize: p.size,
  };
}

interface UsePhotoSyncOptions {
  activeSessionRef: React.MutableRefObject<ActiveSession | null>;
  webOriginRef: React.MutableRefObject<string>;
  ensureActiveSession: (forceNew?: boolean) => Promise<ActiveSession>;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
  onRequestConfigureSupabase: () => void;
  isOtgLiveEnabled: boolean;
  otgDirectoryUri: string | null;
  usbCameraConnected: boolean;
  setUsbCameraStatus: React.Dispatch<React.SetStateAction<UsbCameraStatus>>;
}

export function usePhotoSync({
  activeSessionRef,
  webOriginRef,
  ensureActiveSession,
  onShowToast,
  onRequestConfigureSupabase,
  isOtgLiveEnabled,
  otgDirectoryUri,
  usbCameraConnected,
  setUsbCameraStatus,
}: UsePhotoSyncOptions) {
  // Strictly contains ONLY photos verified as uploaded in the current session
  const [recentPhotos, setRecentPhotos] = useState<LocalPhotoItem[]>([]);
  const recentPhotosRef = useRef<LocalPhotoItem[]>(recentPhotos);
  recentPhotosRef.current = recentPhotos;

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [uploadedPhotoIds, setUploadedPhotoIds] = useState<string[]>([]);
  const [longPressedPhotoId, setLongPressedPhotoId] = useState<string | null>(
    null
  );
  const [uploading, setUploading] = useState<boolean>(false);
  const [sessionPhotosCount, setSessionPhotosCount] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Chọn ảnh để upload và tạo mã QR'
  );

  // Deleting Photos State (Loading Spinner & Toast notification)
  const [isDeletingPhotos, setIsDeletingPhotos] = useState<boolean>(false);
  const [deletingCount, setDeletingCount] = useState<number>(0);

  // Refs to prevent stale closures and race conditions
  const uploadingRef = useRef<boolean>(uploading);
  const uploadedIdsSetRef = useRef<Set<string>>(new Set());
  const uploadedUrisSetRef = useRef<Set<string>>(new Set());
  const uploadedCameraKeysSetRef = useRef<Set<string>>(new Set());
  const uploadedMetaMapRef = useRef<Map<string, { storagePath?: string }>>(
    new Map()
  );
  const knownSafFilesSetRef = useRef<Set<string>>(new Set());
  const seededOtgDirectoryRef = useRef<string | null>(null);
  const initialBaselineKeysRef = useRef<Set<string>>(new Set());
  const baselineCapturedRef = useRef<boolean>(false);
  const isOtgPollingRef = useRef<boolean>(false);
  const pendingUploadQueueRef = useRef<LocalPhotoItem[]>([]);
  const usbCameraConnectedRef = useRef<boolean>(usbCameraConnected);
  usbCameraConnectedRef.current = usbCameraConnected;

  // Camera OTG Card Browser & Sync State
  const [isCameraPickerVisible, setIsCameraPickerVisible] =
    useState<boolean>(false);
  const [isLoadingCameraPhotos, setIsLoadingCameraPhotos] =
    useState<boolean>(false);
  const [cameraCardPhotos, setCameraCardPhotos] = useState<
    CameraCardPhotoItem[]
  >([]);
  const [cameraCardTotalCount, setCameraCardTotalCount] = useState<number>(0);
  const [cameraCardUnsyncedCount, setCameraCardUnsyncedCount] =
    useState<number>(0);
  const [isSyncingCamera, setIsSyncingCamera] = useState<boolean>(false);
  const isSyncingCameraRef = useRef<boolean>(false);

  useEffect(() => {
    uploadingRef.current = uploading;
  }, [uploading]);

  // Persist current session's uploaded photo list (metadata + cameraKeys) without base64 blobs
  useEffect(() => {
    setUploadedPhotoIds(recentPhotos.map((p) => p.id));
    setSessionPhotosCount(recentPhotos.length);

    const photosPath = `${FileSystem.documentDirectory ?? ''}${ACTIVE_PHOTOS_FILE}`;
    if (!photosPath) return;

    const sessionId = activeSessionRef.current?.id;
    if (!sessionId || recentPhotos.length === 0) {
      if (!sessionId) {
        void FileSystem.deleteAsync(photosPath, { idempotent: true }).catch(
          () => undefined
        );
      }
      return;
    }

    const compact = recentPhotos.map((p) => ({
      id: p.id,
      uri: p.uri,
      filename: p.filename,
      creationTime: p.creationTime,
      cameraHandle: p.cameraHandle,
      cameraKey: p.cameraKey,
      fileSize: p.fileSize,
    }));
    void FileSystem.writeAsStringAsync(
      photosPath,
      JSON.stringify({ sessionId, photos: compact })
    ).catch(() => undefined);
  }, [activeSessionRef, recentPhotos]);

  // Capture initial card photo keys when OTG camera connects so Sync knows pre-existing vs freshly shot photos
  useEffect(() => {
    if (!usbCameraConnected) {
      baselineCapturedRef.current = false;
      initialBaselineKeysRef.current.clear();
      return;
    }
    if (baselineCapturedRef.current) return;
    baselineCapturedRef.current = true;

    let cancelled = false;
    void (async () => {
      const summary = await getCameraPhotosSummary(0);
      if (cancelled || summary.error) return;
      const keys = new Set<string>();
      for (const item of summary.photos) {
        if (item.cameraKey) {
          keys.add(item.cameraKey);
        }
      }
      initialBaselineKeysRef.current = keys;
    })();

    return () => {
      cancelled = true;
    };
  }, [usbCameraConnected]);

  const isPhotoUploaded = useCallback((item: LocalPhotoItem) => {
    return (
      uploadedIdsSetRef.current.has(item.id) ||
      (Boolean(item.uri) && uploadedUrisSetRef.current.has(item.uri)) ||
      (item.cameraKey ? uploadedCameraKeysSetRef.current.has(item.cameraKey) : false)
    );
  }, []);

  // Compare camera card item against current uploaded list in this session
  const isCardPhotoUploaded = useCallback(
    (cardItem: CameraCardPhotoItem): boolean => {
      if (
        cardItem.cameraKey &&
        uploadedCameraKeysSetRef.current.has(cardItem.cameraKey)
      ) {
        return true;
      }
      const lowerCardName = cardItem.filename.toLowerCase();
      return recentPhotosRef.current.some((uploaded) => {
        if (
          uploaded.cameraKey &&
          cardItem.cameraKey &&
          uploaded.cameraKey === cardItem.cameraKey
        ) {
          return true;
        }
        if (
          uploaded.cameraHandle !== undefined &&
          uploaded.cameraHandle === cardItem.handle &&
          uploaded.filename.toLowerCase() === lowerCardName
        ) {
          return true;
        }
        if (uploaded.filename.toLowerCase() === lowerCardName) {
          if (cardItem.size > 0 && uploaded.fileSize && uploaded.fileSize > 0) {
            return uploaded.fileSize === cardItem.size;
          }
          return true;
        }
        return false;
      });
    },
    []
  );

  // Restore session's uploaded photos on app relaunch (reconciling local metadata with Supabase)
  const restoreSessionPhotos = useCallback(
    async (session: ActiveSession) => {
      const photosPath = `${FileSystem.documentDirectory ?? ''}${ACTIVE_PHOTOS_FILE}`;
      const localById = new Map<string, LocalPhotoItem>();
      try {
        const info = await FileSystem.getInfoAsync(photosPath);
        if (info.exists) {
          const raw = await FileSystem.readAsStringAsync(photosPath);
          const parsed = JSON.parse(raw) as {
            sessionId?: string;
            photos?: LocalPhotoItem[];
          } | null;
          if (parsed?.sessionId === session.id && Array.isArray(parsed.photos)) {
            for (const p of parsed.photos) {
              if (p?.id) localById.set(p.id, p);
            }
          }
        }
      } catch {
        // Ignore corrupt cache
      }

      try {
        const client = getSupabaseClient();
        const { data: rows, error } = await client
          .from('photos')
          .select('id, client_photo_id, image_url, storage_path, created_at')
          .eq('session_id', session.id)
          .order('created_at', { ascending: false });

        if (error) {
          const fallbackList = Array.from(localById.values());
          if (fallbackList.length > 0) {
            setRecentPhotos(fallbackList);
          }
          return;
        }

        const restored: LocalPhotoItem[] = [];
        uploadedIdsSetRef.current.clear();
        uploadedUrisSetRef.current.clear();
        uploadedCameraKeysSetRef.current.clear();
        uploadedMetaMapRef.current.clear();

        for (const row of rows ?? []) {
          const id = (row.client_photo_id as string | null) || (row.id as string);
          const localMatch = localById.get(id);
          const item: LocalPhotoItem = localMatch
            ? {
                ...localMatch,
                uri: localMatch.uri || (row.image_url as string),
              }
            : {
                id,
                uri: row.image_url as string,
                filename:
                  (row.storage_path as string | null)?.split('/').pop() ||
                  `PHOTO_${restored.length + 1}.JPG`,
                creationTime: row.created_at
                  ? Date.parse(row.created_at as string) || Date.now()
                  : Date.now(),
              };

          restored.push(item);
          uploadedIdsSetRef.current.add(item.id);
          if (item.uri) uploadedUrisSetRef.current.add(item.uri);
          if (item.cameraKey) uploadedCameraKeysSetRef.current.add(item.cameraKey);
          uploadedMetaMapRef.current.set(item.id, {
            storagePath: (row.storage_path as string | null) ?? undefined,
          });
        }

        setRecentPhotos(restored);
        if (restored.length > 0) {
          setStatusMessage(
            `Đang tiếp tục phiên #${session.qr_code_hash} (${restored.length} ảnh đã lên QR)`
          );
        }
      } catch {
        // Ignore restore failure
      }
    },
    []
  );

  // Upload a batch of LocalPhotoItem to Supabase AND relay to Web Server.
  // Queues rapid subsequent photos seamlessly so OTG bursts never drop shots,
  // and ALWAYS appends into the current active QR session (or creates one if none exists yet).
  const uploadPhotosBatch = useCallback(
    async (
      itemsToUpload: LocalPhotoItem[],
      options?: { forceNewSession?: boolean }
    ) => {
      if (itemsToUpload.length === 0) return;

      const forceNew = Boolean(options?.forceNewSession);
      const dedupeAgainstUploaded = (items: LocalPhotoItem[]) =>
        items.filter(
          (item) =>
            forceNew ||
            (!uploadedIdsSetRef.current.has(item.id) &&
              !(item.uri && uploadedUrisSetRef.current.has(item.uri)) &&
              !(
                item.cameraKey &&
                uploadedCameraKeysSetRef.current.has(item.cameraKey)
              ))
        );

      if (uploadingRef.current) {
        if (forceNew) return;
        const freshItems = dedupeAgainstUploaded(itemsToUpload).filter(
          (item) =>
            !pendingUploadQueueRef.current.some(
              (q) =>
                q.id === item.id ||
                (Boolean(item.uri) && q.uri === item.uri) ||
                (Boolean(item.cameraKey) && q.cameraKey === item.cameraKey)
            )
        );
        if (freshItems.length > 0) {
          pendingUploadQueueRef.current.push(...freshItems);
          setStatusMessage(
            `Đang xếp hàng +${pendingUploadQueueRef.current.length} ảnh vào phiên QR...`
          );
        }
        return;
      }

      const workQueue = dedupeAgainstUploaded(itemsToUpload);
      if (workQueue.length === 0) return;

      uploadingRef.current = true;
      setUploading(true);
      setLongPressedPhotoId(null);

      try {
        setStatusMessage('Đang chuẩn bị mã QR phiên chụp...');
        const currentSession = await ensureActiveSession(forceNew);

        let successCount = 0;
        let failedCount = 0;
        let lastItemError = '';
        let hasResetForNewSession = false;

        const pullQueuedIntoWorkQueue = () => {
          while (pendingUploadQueueRef.current.length > 0) {
            const next = pendingUploadQueueRef.current.shift();
            if (next) {
              workQueue.push(next);
            }
          }
        };

        for (let i = 0; i < workQueue.length; i++) {
          const item = workQueue[i];
          setStatusMessage(
            `Đang đẩy ${i + 1}/${workQueue.length} ảnh → #${currentSession.qr_code_hash}...`
          );

          try {
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
                `Không đọc được file "${item.filename}": ${readMsg}`
              );
            }

            const cleanFilename = (
              item.filename || `PHOTO_${Date.now()}.JPG`
            ).replace(/[^a-zA-Z0-9._-]/g, '_');

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
                (storageErr as { statusCode?: string | number }).statusCode ??
                '';
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
              client_photo_id: item.id,
              storage_path: storagePath,
            });

            if (dbErr) {
              throw new Error(
                `Lỗi lưu bảng photos (${dbErr.code ?? 'unknown'}): ${dbErr.message}`
              );
            }

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

            // Clear previous session photo tracking once on the first succeeded upload when detaching into a new QR
            const resetForNewSession = forceNew && !hasResetForNewSession;
            if (resetForNewSession) {
              hasResetForNewSession = true;
              uploadedIdsSetRef.current.clear();
              uploadedUrisSetRef.current.clear();
              uploadedCameraKeysSetRef.current.clear();
              uploadedMetaMapRef.current.clear();
            }

            uploadedMetaMapRef.current.set(item.id, { storagePath });
            uploadedIdsSetRef.current.add(item.id);
            if (item.uri) {
              uploadedUrisSetRef.current.add(item.uri);
            }
            if (item.cameraKey) {
              uploadedCameraKeysSetRef.current.add(item.cameraKey);
            }
            successCount += 1;

            setRecentPhotos((prev) => {
              const baseList = resetForNewSession ? [] : prev;
              const alreadyPresent = baseList.some(
                (p) =>
                  p.id === item.id ||
                  (Boolean(item.uri) && p.uri === item.uri) ||
                  (Boolean(item.cameraKey) && p.cameraKey === item.cameraKey)
              );
              return alreadyPresent ? baseList : [item, ...baseList];
            });
          } catch (itemErr) {
            failedCount += 1;
            lastItemError =
              itemErr instanceof Error ? itemErr.message : String(itemErr);
            console.warn('[ShotDropVN] Item upload failed:', lastItemError);
          }

          pullQueuedIntoWorkQueue();
        }

        if (successCount > 0) {
          setSelectedPhotoIds([]);
        }

        if (successCount > 0 && failedCount === 0) {
          setStatusMessage(
            `Đã đồng bộ ${successCount} ảnh lên QR #${currentSession.qr_code_hash}`
          );
          onShowToast(
            'success',
            `Đã upload ${successCount} ảnh vào mã QR #${currentSession.qr_code_hash}!`
          );
        } else if (successCount > 0 && failedCount > 0) {
          setStatusMessage(
            `Đã lên ${successCount} ảnh, còn ${failedCount} ảnh lỗi — bấm Sync để thử lại.`
          );
          onShowToast(
            'error',
            `Đã lên ${successCount} ảnh, ${failedCount} ảnh lỗi — bấm "Sync ảnh mới nhất" để đẩy lại.`
          );
        } else if (failedCount > 0) {
          setStatusMessage(`Upload thất bại: ${lastItemError}`);
          onShowToast(
            'error',
            `Upload thất bại — bấm "Sync ảnh mới nhất từ máy ảnh" để thử lại.`
          );
        }
      } catch (err) {
        pendingUploadQueueRef.current = [];
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[ShotDropVN] Upload to Supabase failed:', err);
        setStatusMessage(`Lỗi: ${msg}`);
        if (err instanceof SupabaseNotConfiguredError) {
          Alert.alert('Chưa cấu hình Supabase', msg, [
            { text: 'Để sau', style: 'cancel' },
            {
              text: 'Nhập Anon Key',
              onPress: onRequestConfigureSupabase,
            },
          ]);
        } else {
          onShowToast('error', `Lỗi tạo phiên/upload: ${msg}`);
        }
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [
      ensureActiveSession,
      onRequestConfigureSupabase,
      onShowToast,
      webOriginRef,
    ]
  );

  // Delete one or multiple uploaded photos and sync removal across remote and local states
  const executeDeletePhotos = useCallback(
    async (idsToRemove: string[]) => {
      if (idsToRemove.length === 0) return;

      const count = idsToRemove.length;
      setDeletingCount(count);
      setIsDeletingPhotos(true);
      setLongPressedPhotoId(null);

      try {
        const idSet = new Set(idsToRemove);
        const itemsToDelete = recentPhotosRef.current.filter((p) =>
          idSet.has(p.id)
        );
        const urisToDelete = new Set(itemsToDelete.map((p) => p.uri));
        const keysToDelete = new Set(
          itemsToDelete
            .map((p) => p.cameraKey)
            .filter((k): k is string => Boolean(k))
        );

        for (const id of idsToRemove) {
          uploadedIdsSetRef.current.delete(id);
        }
        for (const uri of urisToDelete) {
          uploadedUrisSetRef.current.delete(uri);
        }
        for (const key of keysToDelete) {
          uploadedCameraKeysSetRef.current.delete(key);
        }

        // 1. Delete from Supabase Database and Storage
        const client = getSupabaseClient();
        if (client) {
          try {
            const { data: dbRows } = await client
              .from('photos')
              .select('id, storage_path, client_photo_id')
              .in('client_photo_id', idsToRemove);

            const storagePaths: string[] = [];
            if (dbRows && dbRows.length > 0) {
              for (const row of dbRows) {
                if (row.storage_path) {
                  storagePaths.push(row.storage_path);
                }
              }
            }
            for (const id of idsToRemove) {
              const meta = uploadedMetaMapRef.current.get(id);
              if (meta?.storagePath && !storagePaths.includes(meta.storagePath)) {
                storagePaths.push(meta.storagePath);
              }
              uploadedMetaMapRef.current.delete(id);
            }

            if (storagePaths.length > 0) {
              await client.storage.from(STORAGE_BUCKET).remove(storagePaths);
            }

            await client
              .from('photos')
              .delete()
              .in('client_photo_id', idsToRemove);
          } catch (sbErr) {
            console.warn('[Supabase] Lỗi xoá remote photo:', sbErr);
          }
        }

        // 2. Sync removal to Web server
        try {
          await fetchWithTimeout(`${webOriginRef.current}/api/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'delete_photos',
              client_photo_ids: idsToRemove,
            }),
          });
        } catch {
          // Ignore offline
        }

        // 3. Update local uploaded photos list cleanly
        setRecentPhotos((prev) => {
          const remaining = prev.filter(
            (item) => !idSet.has(item.id) && !urisToDelete.has(item.uri)
          );

          if (remaining.length === 0) {
            uploadedIdsSetRef.current.clear();
            uploadedUrisSetRef.current.clear();
            uploadedCameraKeysSetRef.current.clear();
          }

          return remaining;
        });

        setSelectedPhotoIds((prev) => prev.filter((id) => !idSet.has(id)));

        setStatusMessage(`Đã xoá ${count} ảnh.`);
        onShowToast(
          'success',
          count > 1 ? `Đã xoá ${count} ảnh thành công!` : 'Đã xoá ảnh thành công!'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onShowToast('error', `Xoá ảnh thất bại: ${msg}`);
      } finally {
        setIsDeletingPhotos(false);
        setDeletingCount(0);
      }
    },
    [onShowToast, webOriginRef]
  );

  // Pick photos strictly from phone library and upload immediately into active/new QR
  const handlePickFromPhoneGallery = useCallback(async () => {
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
        const itemId = asset.assetId || `pick-${Date.now()}-${idx}`;
        return {
          id: itemId,
          uri: asset.uri,
          filename: asset.fileName || `PHOTO_${Date.now()}_${idx + 1}.JPG`,
          creationTime: Date.now() + idx,
          base64: asset.base64,
        };
      });

      await uploadPhotosBatch(pickedItems);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Không thể mở thư viện ảnh điện thoại';
      Alert.alert('Lỗi chọn ảnh', msg);
    }
  }, [uploadPhotosBatch]);

  // Open camera card photo picker modal with accurate compare-derived badges
  const openCameraPhotoPicker = useCallback(async () => {
    setIsCameraPickerVisible(true);
    setIsLoadingCameraPhotos(true);
    try {
      const summary = await getCameraPhotosSummary(150);
      const hydrated: CameraCardPhotoItem[] = summary.photos.map((item) => ({
        ...item,
        alreadyUploaded: isCardPhotoUploaded(item),
      }));
      const unsynced = hydrated.filter((item) => !item.alreadyUploaded).length;
      setCameraCardTotalCount(summary.totalCount);
      setCameraCardUnsyncedCount(unsynced);
      setCameraCardPhotos(hydrated);
      if (summary.error) {
        onShowToast('error', summary.error);
      }
    } finally {
      setIsLoadingCameraPhotos(false);
    }
  }, [isCardPhotoUploaded, onShowToast]);

  // Shared helper: import selected card photo targets in manageable chunks and push to active/new QR
  const importAndUploadCardTargets = useCallback(
    async (targets: CameraCardPhotoItem[]) => {
      if (targets.length === 0) return;

      const chunkSize = 15;
      let totalImported = 0;

      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const handles = chunk.map((item) => item.handle);
        setStatusMessage(
          `Đang chép ${Math.min(i + chunk.length, targets.length)}/${targets.length} ảnh mới từ máy ảnh...`
        );

        const res = await importCameraHandles(handles);
        if (res.error) {
          onShowToast('error', res.error);
        }

        const importedItems = res.photos
          .map(mapImportedOtgPhoto)
          .filter(
            (p) =>
              !uploadedIdsSetRef.current.has(p.id) &&
              !(p.uri && uploadedUrisSetRef.current.has(p.uri)) &&
              !(p.cameraKey && uploadedCameraKeysSetRef.current.has(p.cameraKey))
          );

        if (importedItems.length > 0) {
          totalImported += importedItems.length;
          await uploadPhotosBatch(importedItems);
        }
      }

      if (totalImported === 0) {
        onShowToast(
          'info',
          'Không có ảnh mới nào cần upload từ thẻ nhớ máy ảnh.'
        );
      }
    },
    [onShowToast, uploadPhotosBatch]
  );

  // Auto-sync un-uploaded photos comparing card photo list against current session's recentPhotos
  const syncCameraUnsyncedBatch = useCallback(
    async (limit = 0) => {
      if (isSyncingCameraRef.current) return;
      isSyncingCameraRef.current = true;
      setIsSyncingCamera(true);
      try {
        if (usbCameraConnectedRef.current) {
          setStatusMessage('Đang so sánh danh sách ảnh thẻ nhớ với phiên QR...');
          const summary = await getCameraPhotosSummary(0);
          if (summary.error) {
            onShowToast('error', summary.error);
            return;
          }

          const missing = summary.photos.filter(
            (item) => !isCardPhotoUploaded(item)
          );
          if (missing.length === 0) {
            onShowToast(
              'info',
              'Tất cả ảnh trên máy ảnh đã có trong phiên QR hiện tại!'
            );
            setStatusMessage('Mọi ảnh từ máy ảnh đã được đồng bộ.');
            return;
          }

          const targets = limit > 0 ? missing.slice(0, limit) : missing;
          setIsCameraPickerVisible(false);
          await importAndUploadCardTargets(targets);
          return;
        }

        if (otgDirectoryUri) {
          const files =
            await FileSystem.StorageAccessFramework.readDirectoryAsync(
              otgDirectoryUri
            );
          const jpegFiles = files
            .filter((f) => /\.(jpe?g)$/i.test(decodeURIComponent(f)))
            .filter((f) => !uploadedUrisSetRef.current.has(f));
          const toPull = limit > 0 ? jpegFiles.slice(-limit) : jpegFiles;
          if (toPull.length === 0) {
            onShowToast(
              'info',
              'Tất cả ảnh trong thư mục OTG đã được đẩy lên QR!'
            );
            return;
          }
          const safItems: LocalPhotoItem[] = toPull.map((fileUri, idx) => {
            knownSafFilesSetRef.current.add(fileUri);
            const decoded = decodeURIComponent(fileUri);
            const namePart =
              decoded.split('/').pop()?.split(':').pop() ||
              `OTG_${Date.now()}_${idx}.JPG`;
            return {
              id: `otg-saf-sync-${Date.now()}-${idx}`,
              uri: fileUri,
              filename: namePart,
              creationTime: Date.now() + idx,
            };
          });
          setIsCameraPickerVisible(false);
          await uploadPhotosBatch(safItems);
        }
      } finally {
        isSyncingCameraRef.current = false;
        setIsSyncingCamera(false);
      }
    },
    [
      importAndUploadCardTargets,
      isCardPhotoUploaded,
      onShowToast,
      otgDirectoryUri,
      uploadPhotosBatch,
    ]
  );

  // Sync button on OtgTetherConsole: compares card photos vs uploaded photos and uploads ONLY missing ones
  const handleSyncCameraPhotos = useCallback(async () => {
    if (isSyncingCameraRef.current) return;

    if (usbCameraConnectedRef.current) {
      isSyncingCameraRef.current = true;
      setIsSyncingCamera(true);
      try {
        setStatusMessage('Đang đối chiếu danh sách ảnh trên thẻ nhớ máy ảnh...');
        const summary = await getCameraPhotosSummary(0);

        if (summary.error) {
          onShowToast('error', summary.error);
          return;
        }
        if (summary.totalCount === 0) {
          onShowToast('info', 'Chưa có ảnh JPEG nào trên thẻ nhớ máy ảnh.');
          setStatusMessage('Thẻ nhớ máy ảnh hiện chưa có ảnh JPEG.');
          return;
        }

        const allMissing = summary.photos.filter(
          (item) => !isCardPhotoUploaded(item)
        );
        if (allMissing.length === 0) {
          Alert.alert(
            'Tất cả ảnh đã lên QR',
            `Toàn bộ ${summary.totalCount} ảnh trên máy ảnh đã có trong phiên QR hiện tại. Bạn có muốn mở thẻ nhớ để xem/chọn lại ảnh không?`,
            [
              { text: 'Đóng', style: 'cancel' },
              {
                text: 'Chọn ảnh trên thẻ',
                onPress: () => void openCameraPhotoPicker(),
              },
            ]
          );
          return;
        }

        // Prioritize freshly shot photos since plug-in if card also had old pre-existing photos
        const baselineKeys = initialBaselineKeysRef.current;
        const newlyShotMissing =
          baselineKeys.size > 0
            ? allMissing.filter(
                (item) => !item.cameraKey || !baselineKeys.has(item.cameraKey)
              )
            : allMissing;

        if (newlyShotMissing.length > 0 && newlyShotMissing.length <= 30) {
          await importAndUploadCardTargets(newlyShotMissing);
          return;
        }

        if (allMissing.length <= 30) {
          await importAndUploadCardTargets(allMissing);
          return;
        }

        Alert.alert(
          `Phát hiện ${allMissing.length} ảnh chưa lên QR`,
          'Chọn cách đồng bộ vào phiên QR hiện tại (nếu chưa có QR app sẽ tự tạo mới):',
          [
            { text: 'Huỷ', style: 'cancel' },
            {
              text: 'Chọn từng ảnh',
              onPress: () => void openCameraPhotoPicker(),
            },
            {
              text: 'Sync 20 ảnh mới nhất',
              onPress: () => void syncCameraUnsyncedBatch(20),
            },
            {
              text: `Sync tất cả (${allMissing.length})`,
              onPress: () => void syncCameraUnsyncedBatch(0),
            },
          ]
        );
      } finally {
        isSyncingCameraRef.current = false;
        setIsSyncingCamera(false);
      }
      return;
    }

    if (otgDirectoryUri) {
      await syncCameraUnsyncedBatch(25);
    }
  }, [
    importAndUploadCardTargets,
    isCardPhotoUploaded,
    onShowToast,
    openCameraPhotoPicker,
    otgDirectoryUri,
    syncCameraUnsyncedBatch,
  ]);

  // Import specifically chosen handles from CameraOtgPickerModal and auto-upload to active/new QR
  const handleImportSelectedCameraHandles = useCallback(
    async (handles: number[]) => {
      if (handles.length === 0 || isSyncingCameraRef.current) return;
      isSyncingCameraRef.current = true;
      setIsSyncingCamera(true);
      try {
        setStatusMessage(`Đang chép ${handles.length} ảnh từ máy ảnh USB OTG...`);
        const res = await importCameraHandles(handles);
        if (res.error) {
          onShowToast('error', res.error);
        }
        const items = res.photos.map(mapImportedOtgPhoto);
        setIsCameraPickerVisible(false);
        if (items.length > 0) {
          await uploadPhotosBatch(items);
        } else {
          onShowToast('error', 'Không chép được ảnh đã chọn từ máy ảnh.');
        }
      } finally {
        isSyncingCameraRef.current = false;
        setIsSyncingCamera(false);
      }
    },
    [onShowToast, uploadPhotosBatch]
  );

  // Unified Upload Button handler:
  // - OTG USB connected: defaults to Camera source (with phone gallery option inside modal)
  // - No OTG USB connected: opens Phone Gallery strictly
  const handlePickUploadPhotos = useCallback(() => {
    if (usbCameraConnectedRef.current) {
      void openCameraPhotoPicker();
      return;
    }
    if (otgDirectoryUri) {
      Alert.alert(
        'Chọn nguồn ảnh Upload',
        'Đang kết nối bộ nhớ/thư mục USB OTG — chọn nguồn lấy ảnh:',
        [
          { text: 'Huỷ', style: 'cancel' },
          {
            text: 'Thư viện điện thoại',
            onPress: () => void handlePickFromPhoneGallery(),
          },
          {
            text: 'Thư mục USB OTG',
            onPress: () => void handleSyncCameraPhotos(),
          },
        ]
      );
      return;
    }
    void handlePickFromPhoneGallery();
  }, [
    handlePickFromPhoneGallery,
    handleSyncCameraPhotos,
    openCameraPhotoPicker,
    otgDirectoryUri,
  ]);

  // Pull N latest photos from connected USB OTG camera and upload immediately
  const handlePullLatestFromOtgCard = useCallback(
    async (count = 5) => {
      setStatusMessage(
        `Đang đọc ${count} ảnh mới nhất từ thẻ nhớ máy ảnh qua cáp OTG...`
      );
      const { status, newPhotos: imported } = await syncUsbCamera({
        manualRequest: true,
        fetchRecentCount: count,
      });
      setUsbCameraStatus(status);
      if (imported.length === 0) {
        Alert.alert(
          'Không tìm thấy ảnh JPEG trên máy ảnh',
          'Hãy kiểm tra máy ảnh đã bật nguồn, tắt Wi-Fi máy ảnh (nếu có), cắm cáp OTG chắc chắn và chụp ở định dạng JPEG.'
        );
        return;
      }

      const items = imported.map(mapImportedOtgPhoto);
      await uploadPhotosBatch(items);
    },
    [setUsbCameraStatus, uploadPhotosBatch]
  );

  // Continuous background polling strictly for physical USB OTG camera / SAF folder
  useEffect(() => {
    if (!isOtgLiveEnabled) return;

    const interval = setInterval(async () => {
      if (isOtgPollingRef.current) {
        return;
      }
      isOtgPollingRef.current = true;

      try {
        if (isNativeUsbOtgAvailable) {
          const { status, newPhotos } = await syncUsbCamera({
            manualRequest: false,
            fetchRecentCount: 0,
          });
          setUsbCameraStatus(status);

          if (status.connected && newPhotos.length > 0) {
            const newItems = newPhotos.map(mapImportedOtgPhoto);
            await uploadPhotosBatch(newItems);
            return;
          }
        }

        if (otgDirectoryUri) {
          try {
            const files =
              await FileSystem.StorageAccessFramework.readDirectoryAsync(
                otgDirectoryUri
              );
            const jpegFiles = files.filter((f) =>
              /\.(jpe?g)$/i.test(decodeURIComponent(f))
            );

            // Establish baseline for newly selected SAF folder so only freshly shot photos upload automatically
            if (seededOtgDirectoryRef.current !== otgDirectoryUri) {
              seededOtgDirectoryRef.current = otgDirectoryUri;
              knownSafFilesSetRef.current = new Set(jpegFiles);
              return;
            }

            const newSafFiles = jpegFiles.filter(
              (f) => !knownSafFilesSetRef.current.has(f)
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

              await uploadPhotosBatch(safItems);
              return;
            }
          } catch {
            // Ignore SAF read error if unplugged
          }
        }
      } finally {
        isOtgPollingRef.current = false;
      }
    }, 1800);

    return () => clearInterval(interval);
  }, [
    isOtgLiveEnabled,
    otgDirectoryUri,
    setUsbCameraStatus,
    uploadPhotosBatch,
  ]);

  const toggleSelectPhoto = useCallback((id: string) => {
    setLongPressedPhotoId(null);
    setSelectedPhotoIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const handleLongPressPhoto = useCallback((id: string) => {
    setLongPressedPhotoId((prev) => (prev === id ? null : id));
  }, []);

  const handleSelectAll = useCallback(() => {
    const allIds = recentPhotos.map((p) => p.id);
    setSelectedPhotoIds(allIds);
  }, [recentPhotos]);

  const handleSelectAllUploaded = useCallback(() => {
    const uploadedInGrid = recentPhotos
      .filter((p) => isPhotoUploaded(p))
      .map((p) => p.id);
    setSelectedPhotoIds(uploadedInGrid);
  }, [isPhotoUploaded, recentPhotos]);

  const clearSelection = useCallback(() => {
    setSelectedPhotoIds([]);
  }, []);

  const clearSessionPhotos = useCallback(() => {
    pendingUploadQueueRef.current = [];
    setRecentPhotos([]);
    setSelectedPhotoIds([]);
    setUploadedPhotoIds([]);
    setSessionPhotosCount(0);
    uploadedIdsSetRef.current.clear();
    uploadedUrisSetRef.current.clear();
    uploadedCameraKeysSetRef.current.clear();
    uploadedMetaMapRef.current.clear();
    const photosPath = `${FileSystem.documentDirectory ?? ''}${ACTIVE_PHOTOS_FILE}`;
    if (photosPath) {
      void FileSystem.deleteAsync(photosPath, { idempotent: true }).catch(
        () => undefined
      );
    }
    setStatusMessage('Chọn ảnh để upload và tạo mã QR');
  }, []);

  return {
    recentPhotos,
    selectedPhotoIds,
    uploadedPhotoIds,
    longPressedPhotoId,
    setLongPressedPhotoId,
    uploading,
    isDeletingPhotos,
    deletingCount,
    statusMessage,
    sessionPhotosCount,
    isCameraPickerVisible,
    setIsCameraPickerVisible,
    isLoadingCameraPhotos,
    cameraCardPhotos,
    cameraCardTotalCount,
    cameraCardUnsyncedCount,
    isSyncingCamera,
    uploadPhotosBatch,
    executeDeletePhotos,
    handlePickUploadPhotos,
    handlePickFromPhoneGallery,
    openCameraPhotoPicker,
    handleSyncCameraPhotos,
    syncCameraUnsyncedBatch,
    handleImportSelectedCameraHandles,
    handlePullLatestFromOtgCard,
    toggleSelectPhoto,
    handleLongPressPhoto,
    handleSelectAll,
    handleSelectAllUploaded,
    clearSelection,
    clearSessionPhotos,
    restoreSessionPhotos,
    isPhotoUploaded,
  };
}
