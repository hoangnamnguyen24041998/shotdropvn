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
  webOriginRef,
  ensureActiveSession,
  onShowToast,
  onRequestConfigureSupabase,
  isOtgLiveEnabled,
  otgDirectoryUri,
  setUsbCameraStatus,
}: UsePhotoSyncOptions) {
  // Strictly contains ONLY photos verified as uploaded in the current session
  const [recentPhotos, setRecentPhotos] = useState<LocalPhotoItem[]>([]);
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
  const uploadedMetaMapRef = useRef<Map<string, { storagePath?: string }>>(
    new Map()
  );
  const knownSafFilesSetRef = useRef<Set<string>>(new Set());
  const isOtgPollingRef = useRef<boolean>(false);

  useEffect(() => {
    uploadingRef.current = uploading;
  }, [uploading]);

  // Derive uploaded IDs & count cleanly from recentPhotos
  useEffect(() => {
    setUploadedPhotoIds(recentPhotos.map((p) => p.id));
    setSessionPhotosCount(recentPhotos.length);
  }, [recentPhotos]);

  const isPhotoUploaded = useCallback((item: LocalPhotoItem) => {
    return (
      uploadedIdsSetRef.current.has(item.id) ||
      (Boolean(item.uri) && uploadedUrisSetRef.current.has(item.uri))
    );
  }, []);

  // Upload a batch of LocalPhotoItem to Supabase AND relay to Web Server.
  // Only adds photos to `recentPhotos` AFTER upload succeeds so un-uploaded photos never appear.
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
        let hasResetForNewSession = false;

        for (let i = 0; i < itemsToUpload.length; i++) {
          const item = itemsToUpload[i];
          setStatusMessage(
            `Đang upload ${i + 1}/${itemsToUpload.length}...`
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

          // Clear previous session photo tracking once on the first succeeded upload when detaching into a new QR
          const resetForNewSession =
            Boolean(options?.forceNewSession) && !hasResetForNewSession;
          if (resetForNewSession) {
            hasResetForNewSession = true;
            uploadedIdsSetRef.current.clear();
            uploadedUrisSetRef.current.clear();
            uploadedMetaMapRef.current.clear();
          }

          uploadedMetaMapRef.current.set(item.id, { storagePath });
          uploadedIdsSetRef.current.add(item.id);
          if (item.uri) {
            uploadedUrisSetRef.current.add(item.uri);
          }
          successCount += 1;

          setRecentPhotos((prev) => {
            const baseList = resetForNewSession ? [] : prev;
            const alreadyPresent = baseList.some(
              (p) => p.id === item.id || (Boolean(item.uri) && p.uri === item.uri)
            );
            return alreadyPresent ? baseList : [item, ...baseList];
          });
        }

        setSelectedPhotoIds([]);
        setStatusMessage(`Đã upload ${successCount} ảnh lên Web`);
        onShowToast('success', `Đã upload ${successCount} ảnh thành công!`);
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
          Alert.alert('Lỗi upload ảnh', msg);
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
        const itemsToDelete = recentPhotos.filter((p) => idSet.has(p.id));
        const urisToDelete = new Set(itemsToDelete.map((p) => p.uri));

        for (const id of idsToRemove) {
          uploadedIdsSetRef.current.delete(id);
        }
        for (const uri of urisToDelete) {
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

        // 3. Update local uploaded photos list cleanly
        setRecentPhotos((prev) => {
          const remaining = prev.filter(
            (item) => !idSet.has(item.id) && !urisToDelete.has(item.uri)
          );

          if (remaining.length === 0) {
            uploadedIdsSetRef.current.clear();
            uploadedUrisSetRef.current.clear();
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
    [onShowToast, recentPhotos, webOriginRef]
  );

  // Pick photos from phone gallery / Canon Connect and upload immediately
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
        return {
          id: itemId,
          uri: asset.uri,
          filename: asset.fileName || `PHOTO_${Date.now()}_${idx + 1}.JPG`,
          creationTime: Date.now() + idx,
          base64: asset.base64,
        };
      });

      // Upload directly; only successfully uploaded items will appear in the list below
      await uploadPhotosBatch(pickedItems);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Không thể mở bộ chọn ảnh';
      Alert.alert('Lỗi chọn ảnh', msg);
    }
  }, [uploadPhotosBatch]);

  // Pull N latest photos from connected USB OTG camera and upload immediately
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

      await uploadPhotosBatch(items);
    },
    [uploadPhotosBatch]
  );

  // Continuous background polling strictly for physical USB OTG camera / SAF folder
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
    setRecentPhotos([]);
    setSelectedPhotoIds([]);
    setUploadedPhotoIds([]);
    setSessionPhotosCount(0);
    uploadedIdsSetRef.current.clear();
    uploadedUrisSetRef.current.clear();
    uploadedMetaMapRef.current.clear();
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
