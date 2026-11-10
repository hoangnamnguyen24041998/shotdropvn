import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import type { ActiveSession, LocalPhotoItem } from '../types';
import {
  STORAGE_BUCKET,
  getSupabaseClient,
  isSupabaseReady,
} from '../lib/supabase';
import {
  isNativeUsbOtgAvailable,
  pollNewUsbCameraPhotos,
  scanAndConnectUsbCamera,
  type UsbCameraStatus,
} from '../lib/usbOtg';
import { SupabaseNotConfiguredError } from './useActiveSession';

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

interface UsePhotoSyncOptions {
  activeSessionRef: React.MutableRefObject<ActiveSession | null>;
  webOriginRef: React.MutableRefObject<string>;
  ensureActiveSession: (forceNew?: boolean) => Promise<ActiveSession>;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
  onRequestConfigureSupabase: () => void;
  isOtgLiveEnabled: boolean;
  otgDirectoryUri: string | null;
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
  setUsbCameraStatus,
}: UsePhotoSyncOptions) {
  const [recentPhotos, setRecentPhotos] = useState<LocalPhotoItem[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [uploadedPhotoIds, setUploadedPhotoIds] = useState<string[]>([]);
  const [longPressedPhotoId, setLongPressedPhotoId] = useState<string | null>(
    null
  );
  const [uploading, setUploading] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(() => Date.now());
  const [sessionPhotosCount, setSessionPhotosCount] = useState<number>(0);
  const [isExpoGoAndroidRestricted, setIsExpoGoAndroidRestricted] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Sẵn sàng đồng bộ Live qua cáp USB OTG hoặc Canon Connect'
  );

  // Deleting Photos State (Loading Spinner & Toast notification)
  const [isDeletingPhotos, setIsDeletingPhotos] = useState<boolean>(false);
  const [deletingCount, setDeletingCount] = useState<number>(0);

  // Synchronization refs to prevent race conditions and ID mismatch bugs
  const uploadingRef = useRef<boolean>(uploading);
  const lastSyncTimeRef = useRef<number>(lastSyncTime);
  const uploadedIdsSetRef = useRef<Set<string>>(new Set());
  const uploadedUrisSetRef = useRef<Set<string>>(new Set());
  const deletedIdsSetRef = useRef<Set<string>>(new Set());
  const deletedUrisSetRef = useRef<Set<string>>(new Set());
  const uploadedMetaMapRef = useRef<Map<string, { storagePath?: string }>>(
    new Map()
  );
  const knownSafFilesSetRef = useRef<Set<string>>(new Set());
  const isOtgPollingRef = useRef<boolean>(false);

  useEffect(() => {
    uploadingRef.current = uploading;
  }, [uploading]);

  useEffect(() => {
    lastSyncTimeRef.current = lastSyncTime;
  }, [lastSyncTime]);

  const isPhotoUploaded = useCallback((item: LocalPhotoItem) => {
    return (
      uploadedIdsSetRef.current.has(item.id) ||
      (Boolean(item.uri) && uploadedUrisSetRef.current.has(item.uri))
    );
  }, []);

  // Upload a batch of LocalPhotoItem to Supabase AND relay to Web Server
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

          const client = getSupabaseClient();
          const arrayBuffer = decode(base64Data);
          const storagePath = `${currentSession.id}/${Date.now()}_${cleanFilename}`;
          uploadedMetaMapRef.current.set(item.id, { storagePath });

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

          // Track both ID and URI for robust matching
          uploadedIdsSetRef.current.add(item.id);
          if (item.uri) {
            uploadedUrisSetRef.current.add(item.uri);
          }
          successCount += 1;
        }

        // Update uploaded IDs by matching both id and uri against current recentPhotos
        setRecentPhotos((curr) => {
          const uploadedIds = curr
            .filter((p) => isPhotoUploaded(p))
            .map((p) => p.id);
          setUploadedPhotoIds(uploadedIds);
          setSessionPhotosCount(uploadedIds.length);
          return curr;
        });

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
              onPress: onRequestConfigureSupabase,
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
    [
      ensureActiveSession,
      isPhotoUploaded,
      onRequestConfigureSupabase,
      webOriginRef,
    ]
  );

  // Delete one or multiple photos and synchronize removal across remote and local states
  const executeDeletePhotos = useCallback(
    async (idsToRemove: string[]) => {
      if (idsToRemove.length === 0) return;

      const count = idsToRemove.length;
      setDeletingCount(count);
      setIsDeletingPhotos(true);
      setLongPressedPhotoId(null);

      try {
        const idSet = new Set(idsToRemove);
        const itemsToDelete = recentPhotos.filter((p) => idSet.has(p.id));
        const urisToDelete = new Set(itemsToDelete.map((p) => p.uri));

        for (const id of idsToRemove) {
          deletedIdsSetRef.current.add(id);
          uploadedIdsSetRef.current.delete(id);
        }
        for (const uri of urisToDelete) {
          deletedUrisSetRef.current.add(uri);
          uploadedUrisSetRef.current.delete(uri);
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

        // 3. Update local photos list and recalculate uploadedPhotoIds accurately
        setRecentPhotos((prev) => {
          const remaining = prev.filter(
            (item) => !idSet.has(item.id) && !urisToDelete.has(item.uri)
          );

          if (remaining.length === 0) {
            uploadedIdsSetRef.current.clear();
            uploadedUrisSetRef.current.clear();
            setUploadedPhotoIds([]);
            setSessionPhotosCount(0);
          } else {
            const remainingUploaded = remaining
              .filter((p) => isPhotoUploaded(p))
              .map((p) => p.id);
            setUploadedPhotoIds(remainingUploaded);
            setSessionPhotosCount(remainingUploaded.length);
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
    [isPhotoUploaded, onShowToast, recentPhotos, webOriginRef]
  );

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
        const itemId = asset.assetId || `pick-${Date.now()}-${idx}`;
        deletedIdsSetRef.current.delete(itemId);
        if (asset.uri) {
          deletedUrisSetRef.current.delete(asset.uri);
        }
        return {
          id: itemId,
          uri: asset.uri,
          filename: asset.fileName || `CANON_${Date.now()}_${idx + 1}.JPG`,
          creationTime: Date.now() + idx,
          base64: asset.base64,
        };
      });

      // Insert and preserve all picked items into recentPhotos
      setRecentPhotos((prev) => {
        const existingUris = new Set(prev.map((p) => p.uri));
        const newUnique = pickedItems.filter((p) => !existingUris.has(p.uri));
        return [...newUnique, ...prev];
      });

      // Automatically upload the picked photos and generate the live QR code
      await uploadPhotosBatch(pickedItems);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Không thể mở bộ chọn ảnh';
      Alert.alert('Lỗi chọn ảnh', msg);
    }
  }, [uploadPhotosBatch]);

  // Pull N latest photos from connected USB camera
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
        const existingUris = new Set(prev.map((i) => i.uri));
        const newUnique = items.filter((i) => !existingUris.has(i.uri));
        return [...newUnique, ...prev];
      });

      await uploadPhotosBatch(items);
    },
    [uploadPhotosBatch]
  );

  // Sync with MediaStore without wiping picked items
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
          .filter(
            (a) =>
              !deletedIdsSetRef.current.has(a.id) &&
              !deletedUrisSetRef.current.has(a.uri)
          )
          .map((a) => ({
            id: a.id,
            uri: a.uri,
            filename: a.filename || `IMG_${a.id}.JPG`,
            creationTime: a.creationTime || 0,
          }));

        // Deduplicate and merge without dropping previously picked photos
        setRecentPhotos((prev) => {
          if (assets.length === 0) return prev;
          const existingIds = new Set(prev.map((p) => p.id));
          const existingUris = new Set(prev.map((p) => p.uri));

          const newAssets = assets.filter(
            (a) => !existingIds.has(a.id) && !existingUris.has(a.uri)
          );

          // Sync uploaded status between picked items and newly discovered gallery assets
          assets.forEach((a) => {
            if (uploadedUrisSetRef.current.has(a.uri)) {
              uploadedIdsSetRef.current.add(a.id);
            }
          });

          return [...prev, ...newAssets];
        });

        if (
          options?.checkAutoUpload &&
          !uploadingRef.current &&
          activeSessionRef.current !== null
        ) {
          const threshold = lastSyncTimeRef.current;
          const newlyArrived = assets.filter(
            (a) =>
              a.creationTime > threshold &&
              !uploadedIdsSetRef.current.has(a.id) &&
              !uploadedUrisSetRef.current.has(a.uri)
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
    [activeSessionRef, uploadPhotosBatch]
  );

  // Initialize MediaLibrary permissions
  useEffect(() => {
    async function initPerms() {
      const isExpoGoRuntime = Boolean(
        (globalThis as { expo?: { modules?: { ExpoGo?: unknown } } }).expo
          ?.modules?.ExpoGo
      );

      if (Platform.OS === 'android' && isExpoGoRuntime) {
        setIsExpoGoAndroidRestricted(true);
      } else {
        try {
          await MediaLibrary.requestPermissionsAsync(false, ['photo']);
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('Expo Go')) {
            setIsExpoGoAndroidRestricted(true);
          }
        }
      }
    }
    void initPerms();
  }, []);

  // Continuous background polling loop (OTG, SAF, and Gallery auto-sync)
  useEffect(() => {
    if (!isOtgLiveEnabled) return;

    const interval = setInterval(async () => {
      if (isOtgPollingRef.current || uploadingRef.current) return;
      isOtgPollingRef.current = true;

      try {
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

        if (!isExpoGoAndroidRestricted && activeSessionRef.current !== null) {
          await fetchAndSyncMediaLibrary({ checkAutoUpload: true });
        }
      } finally {
        isOtgPollingRef.current = false;
      }
    }, 1800);

    return () => clearInterval(interval);
  }, [
    activeSessionRef,
    fetchAndSyncMediaLibrary,
    isExpoGoAndroidRestricted,
    isOtgLiveEnabled,
    otgDirectoryUri,
    setUsbCameraStatus,
    uploadPhotosBatch,
  ]);

  // AppState change listener
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (
        nextState === 'active' &&
        !isExpoGoAndroidRestricted &&
        activeSessionRef.current !== null
      ) {
        void fetchAndSyncMediaLibrary({ checkAutoUpload: true });
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [activeSessionRef, fetchAndSyncMediaLibrary, isExpoGoAndroidRestricted]);

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
    setRecentPhotos([]);
    setSelectedPhotoIds([]);
    setUploadedPhotoIds([]);
    setSessionPhotosCount(0);
    uploadedIdsSetRef.current.clear();
    uploadedUrisSetRef.current.clear();
    deletedIdsSetRef.current.clear();
    deletedUrisSetRef.current.clear();
    uploadedMetaMapRef.current.clear();
    const now = Date.now();
    setLastSyncTime(now);
    lastSyncTimeRef.current = now;
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
    uploadPhotosBatch,
    executeDeletePhotos,
    handlePickFromCanonConnect,
    handlePullLatestFromOtgCard,
    toggleSelectPhoto,
    handleLongPressPhoto,
    handleSelectAll,
    handleSelectAllUploaded,
    clearSelection,
    clearSessionPhotos,
    isPhotoUploaded,
  };
}
