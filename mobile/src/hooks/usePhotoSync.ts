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
  captureUsbLiveViewPhoto,
  clearCameraSessionUploads,
  getCameraPhotosSummary,
  importCameraHandles,
  isNativeUsbOtgAvailable,
  syncUnsyncedCameraPhotos,
  syncUsbCamera,
  type CameraCardPhotoItem,
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
  usbCameraConnected: boolean;
  setUsbCameraStatus: React.Dispatch<React.SetStateAction<UsbCameraStatus>>;
  isCapturingOtgRef?: React.MutableRefObject<boolean>;
  setCapturingOtgState?: (next: boolean) => void;
}

export function usePhotoSync({
  webOriginRef,
  ensureActiveSession,
  onShowToast,
  onRequestConfigureSupabase,
  isOtgLiveEnabled,
  otgDirectoryUri,
  usbCameraConnected,
  setUsbCameraStatus,
  isCapturingOtgRef,
  setCapturingOtgState,
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
  const seededOtgDirectoryRef = useRef<string | null>(null);
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
  // Queues rapid subsequent photos seamlessly so Live View / OTG bursts never drop frames,
  // and always syncs into the current active QR session (or creates one if none exists yet).
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
              !(item.uri && uploadedUrisSetRef.current.has(item.uri)))
        );

      if (uploadingRef.current) {
        if (forceNew) return;
        const freshItems = dedupeAgainstUploaded(itemsToUpload).filter(
          (item) =>
            !pendingUploadQueueRef.current.some(
              (q) => q.id === item.id || (Boolean(item.uri) && q.uri === item.uri)
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
          const resetForNewSession = forceNew && !hasResetForNewSession;
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

          pullQueuedIntoWorkQueue();
        }

        setSelectedPhotoIds([]);
        setStatusMessage(
          `Đã đồng bộ ${successCount} ảnh lên QR #${currentSession.qr_code_hash}`
        );
        onShowToast(
          'success',
          `Đã upload ${successCount} ảnh vào mã QR #${currentSession.qr_code_hash}!`
        );
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

  // Open camera card photo picker modal (only when OTG camera is connected)
  const openCameraPhotoPicker = useCallback(async () => {
    setIsCameraPickerVisible(true);
    setIsLoadingCameraPhotos(true);
    try {
      const summary = await getCameraPhotosSummary(120);
      setCameraCardTotalCount(summary.totalCount);
      setCameraCardUnsyncedCount(summary.unsyncedCount);
      setCameraCardPhotos(summary.photos);
      if (summary.error) {
        onShowToast('error', summary.error);
      }
    } finally {
      setIsLoadingCameraPhotos(false);
    }
  }, [onShowToast]);

  // Auto-sync un-uploaded photos currently on OTG camera/card straight into active (or new) QR session
  const syncCameraUnsyncedBatch = useCallback(
    async (limit = 0) => {
      if (isSyncingCameraRef.current) return;
      isSyncingCameraRef.current = true;
      setIsSyncingCamera(true);
      try {
        if (usbCameraConnectedRef.current) {
          setStatusMessage('Đang đồng bộ ảnh từ máy ảnh qua USB OTG...');
          const res = await syncUnsyncedCameraPhotos(limit);
          if (res.error) {
            onShowToast('error', res.error);
            return;
          }
          const items: LocalPhotoItem[] = res.photos
            .filter((p) => !uploadedUrisSetRef.current.has(p.uri))
            .map((p) => ({
              id: p.id,
              uri: p.uri,
              filename: p.filename,
              creationTime: p.creationTime,
            }));

          if (items.length === 0) {
            onShowToast(
              'info',
              'Tất cả ảnh trên máy ảnh đã có trong phiên QR hiện tại!'
            );
            setStatusMessage('Mọi ảnh từ máy ảnh đã được đồng bộ.');
            return;
          }

          setIsCameraPickerVisible(false);
          await uploadPhotosBatch(items);
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
          const toPull =
            limit > 0 ? jpegFiles.slice(-limit) : jpegFiles;
          if (toPull.length === 0) {
            onShowToast('info', 'Tất cả ảnh trong thư mục OTG đã được đẩy lên QR!');
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
    [onShowToast, otgDirectoryUri, uploadPhotosBatch]
  );

  // Sync button on OtgTetherConsole: pushes un-uploaded old photos on camera into active (or new) QR session
  const handleSyncCameraPhotos = useCallback(async () => {
    if (isSyncingCameraRef.current) return;
    if (usbCameraConnectedRef.current) {
      isSyncingCameraRef.current = true;
      setIsSyncingCamera(true);
      let summary;
      try {
        setStatusMessage('Đang kiểm tra ảnh chưa đồng bộ trên máy ảnh...');
        summary = await getCameraPhotosSummary(250);
      } finally {
        isSyncingCameraRef.current = false;
        setIsSyncingCamera(false);
      }

      if (summary.error) {
        onShowToast('error', summary.error);
        return;
      }
      if (summary.totalCount === 0) {
        onShowToast('info', 'Chưa có ảnh JPEG nào trên thẻ nhớ máy ảnh.');
        return;
      }
      if (summary.unsyncedCount === 0) {
        Alert.alert(
          'Tất cả ảnh đã lên QR',
          `Toàn bộ ${summary.totalCount} ảnh hiện có trên máy ảnh đã được đồng bộ. Bạn có muốn mở thẻ nhớ để chọn lại ảnh cũ không?`,
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
      if (summary.unsyncedCount <= 25) {
        await syncCameraUnsyncedBatch(0);
        return;
      }

      Alert.alert(
        `Có ${summary.unsyncedCount} ảnh chưa đẩy trên máy ảnh`,
        'Chọn cách đồng bộ vào phiên QR hiện tại (nếu chưa có QR app sẽ tự tạo mới):',
        [
          { text: 'Huỷ', style: 'cancel' },
          {
            text: 'Chọn từng ảnh',
            onPress: () => void openCameraPhotoPicker(),
          },
          {
            text: 'Sync 20 ảnh gần nhất',
            onPress: () => void syncCameraUnsyncedBatch(20),
          },
          {
            text: `Sync tất cả (${summary.unsyncedCount})`,
            onPress: () => void syncCameraUnsyncedBatch(0),
          },
        ]
      );
      return;
    }

    if (otgDirectoryUri) {
      await syncCameraUnsyncedBatch(25);
    }
  }, [
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
        const items: LocalPhotoItem[] = res.photos.map((p) => ({
          id: p.id,
          uri: p.uri,
          filename: p.filename,
          creationTime: p.creationTime,
        }));
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

  // Unified Upload Button handler (Req 4 & 5):
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

      const items: LocalPhotoItem[] = imported.map((p) => ({
        id: p.id,
        uri: p.uri,
        filename: p.filename,
        creationTime: p.creationTime,
      }));

      await uploadPhotosBatch(items);
    },
    [setUsbCameraStatus, uploadPhotosBatch]
  );

  // Trigger remote shutter via USB OTG (even while Live View is active) and push JPEG straight to QR Web
  const handleCaptureLiveViewPhoto = useCallback(
    async (withAf = true) => {
      if (isCapturingOtgRef?.current) return;
      setCapturingOtgState?.(true);
      isOtgPollingRef.current = true;
      setStatusMessage('Đang chụp & xuất ảnh từ máy ảnh qua USB OTG...');

      let importedPhotos: LocalPhotoItem[] = [];
      try {
        const res = await captureUsbLiveViewPhoto(withAf);
        setUsbCameraStatus((prev) => ({
          ...prev,
          liveViewActive: res.liveViewActive ?? prev.liveViewActive,
          totalPhotosOnCard: res.totalPhotosOnCard ?? prev.totalPhotosOnCard,
        }));

        if (!res.ok) {
          const errMsg =
            res.error || 'Không thể chụp từ xa qua USB OTG trên máy ảnh';
          setStatusMessage(`Lỗi chụp OTG: ${errMsg}`);
          onShowToast('error', errMsg);
          return;
        }

        if (res.warning) {
          onShowToast('info', res.warning);
        }

        importedPhotos = res.photos.map((p) => ({
          id: p.id,
          uri: p.uri,
          filename: p.filename,
          creationTime: p.creationTime,
        }));
      } finally {
        setCapturingOtgState?.(false);
        isOtgPollingRef.current = false;
      }

      if (importedPhotos.length > 0) {
        await uploadPhotosBatch(importedPhotos);
      } else {
        setStatusMessage('Đã chụp trên máy ảnh, đang đồng bộ ảnh JPEG...');
      }
    },
    [
      isCapturingOtgRef,
      onShowToast,
      setCapturingOtgState,
      setUsbCameraStatus,
      uploadPhotosBatch,
    ]
  );

  // Continuous background polling strictly for physical USB OTG camera / SAF folder
  useEffect(() => {
    if (!isOtgLiveEnabled) return;

    const interval = setInterval(async () => {
      if (isOtgPollingRef.current || isCapturingOtgRef?.current) {
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
            const newItems: LocalPhotoItem[] = newPhotos.map((p) => ({
              id: p.id,
              uri: p.uri,
              filename: p.filename,
              creationTime: p.creationTime,
            }));

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
    void clearCameraSessionUploads();
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
    handleCaptureLiveViewPhoto,
    toggleSelectPhoto,
    handleLongPressPhoto,
    handleSelectAll,
    handleSelectAllUploaded,
    clearSelection,
    clearSessionPhotos,
    isPhotoUploaded,
  };
}
