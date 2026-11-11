import { NativeModules, Platform } from 'react-native';

export const USB_OTG_CHANGED_EVENT = 'ShotDropUsbOtgChanged';

export interface UsbCameraStatus {
  connected: boolean;
  usbAttached?: boolean;
  status:
    | 'CONNECTED'
    | 'REQUESTING_PERMISSION'
    | 'PERMISSION_DENIED'
    | 'HUB_ONLY'
    | 'MASS_STORAGE'
    | 'NO_USB_DEVICE'
    | 'NO_USB_SERVICE'
    | 'OPEN_FAILED'
    | 'MTP_OPEN_FAILED'
    | 'PTP_SYNC_ERROR'
    | 'UNSUPPORTED_PLATFORM'
    | 'ERROR';
  deviceName: string | null;
  totalPhotosOnCard: number;
  isCanonEos?: boolean;
  supportsLiveView?: boolean;
  supportsRemoteCapture?: boolean;
  supportsAutoFocus?: boolean;
  liveViewActive?: boolean;
  diagnosticInfo?: string;
  error?: string;
}

export interface ImportedOtgPhoto {
  id: string;
  uri: string;
  filename: string;
  creationTime: number;
}

export interface SyncUsbCameraResult {
  status: UsbCameraStatus;
  newPhotos: ImportedOtgPhoto[];
}

export interface LiveViewControlResult {
  active: boolean;
  evfOutputDevice?: number;
  ok?: boolean;
  error?: string;
}

export interface LiveViewFrameResult {
  active: boolean;
  uri: string | null;
  bytes?: number;
}

export interface OtgAutoFocusResult {
  ok: boolean;
  error?: string;
}

export interface CaptureOtgPhotoResult {
  ok: boolean;
  captured: boolean;
  liveViewActive?: boolean;
  totalPhotosOnCard?: number;
  photos: ImportedOtgPhoto[];
  warning?: string;
  error?: string;
}

export interface CameraCardPhotoItem {
  handle: number;
  filename: string;
  size: number;
  alreadyUploaded: boolean;
  thumbUri: string | null;
}

export interface CameraPhotosSummaryResult {
  totalCount: number;
  unsyncedCount: number;
  photos: CameraCardPhotoItem[];
  error?: string;
}

export interface SyncUnsyncedCameraResult {
  totalOnCard: number;
  totalUnsyncedBefore: number;
  remainingUnsynced: number;
  photos: ImportedOtgPhoto[];
  error?: string;
}

interface ShotDropUsbOtgNativeModule {
  scanAndConnectCamera(): Promise<UsbCameraStatus>;
  pollNewPhotosFromCamera(fetchRecentCount: number): Promise<ImportedOtgPhoto[]>;
  syncUsbCamera?(
    manualRequest: boolean,
    fetchRecentCount: number
  ): Promise<SyncUsbCameraResult>;
  startLiveView?(): Promise<LiveViewControlResult>;
  stopLiveView?(): Promise<LiveViewControlResult>;
  getLiveViewFrame?(): Promise<LiveViewFrameResult | null>;
  triggerAutoFocus?(): Promise<OtgAutoFocusResult>;
  captureLiveViewPhoto?(withAf: boolean): Promise<CaptureOtgPhotoResult>;
  getCameraPhotosSummary?(maxItems: number): Promise<CameraPhotosSummaryResult>;
  getCameraPhotoThumbnail?(handle: number): Promise<{ uri: string | null }>;
  importCameraHandles?(
    handles: number[]
  ): Promise<{ photos: ImportedOtgPhoto[]; error?: string }>;
  syncUnsyncedCameraPhotos?(limit: number): Promise<SyncUnsyncedCameraResult>;
  clearCameraSessionUploads?(): Promise<boolean>;
}

const NativeUsbOtg = NativeModules.ShotDropUsbOtg as
  | ShotDropUsbOtgNativeModule
  | undefined;

export const isNativeUsbOtgAvailable =
  Platform.OS === 'android' && Boolean(NativeUsbOtg);

const UNSUPPORTED_STATUS: UsbCameraStatus = {
  connected: false,
  usbAttached: false,
  status: 'UNSUPPORTED_PLATFORM',
  deviceName: null,
  totalPhotosOnCard: 0,
};

export async function syncUsbCamera(options?: {
  manualRequest?: boolean;
  fetchRecentCount?: number;
}): Promise<SyncUsbCameraResult> {
  if (Platform.OS !== 'android' || !NativeUsbOtg) {
    return { status: UNSUPPORTED_STATUS, newPhotos: [] };
  }

  const manualRequest = options?.manualRequest ?? false;
  const fetchRecentCount = options?.fetchRecentCount ?? -1;

  try {
    if (typeof NativeUsbOtg.syncUsbCamera === 'function') {
      const result = await NativeUsbOtg.syncUsbCamera(
        manualRequest,
        fetchRecentCount
      );
      return {
        status: result?.status ?? UNSUPPORTED_STATUS,
        newPhotos: Array.isArray(result?.newPhotos) ? result.newPhotos : [],
      };
    }

    const status = await NativeUsbOtg.scanAndConnectCamera();
    if (!status.connected || fetchRecentCount < 0) {
      return { status, newPhotos: [] };
    }
    const items = await NativeUsbOtg.pollNewPhotosFromCamera(fetchRecentCount);
    return {
      status,
      newPhotos: Array.isArray(items) ? items : [],
    };
  } catch (err) {
    return {
      status: {
        connected: false,
        usbAttached: false,
        status: 'ERROR',
        deviceName: null,
        totalPhotosOnCard: 0,
        error: err instanceof Error ? err.message : 'Lỗi kết nối USB OTG',
      },
      newPhotos: [],
    };
  }
}

export async function scanAndConnectUsbCamera(
  manualRequest = true
): Promise<UsbCameraStatus> {
  const { status } = await syncUsbCamera({
    manualRequest,
    fetchRecentCount: -1,
  });
  return status;
}

export async function pollNewUsbCameraPhotos(
  fetchRecentCount = 0
): Promise<ImportedOtgPhoto[]> {
  if (Platform.OS !== 'android' || !NativeUsbOtg) {
    return [];
  }

  try {
    const items = await NativeUsbOtg.pollNewPhotosFromCamera(fetchRecentCount);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export async function startUsbLiveView(): Promise<LiveViewControlResult> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.startLiveView !== 'function'
  ) {
    return { active: false, error: 'Thiết bị chưa hỗ trợ USB Live View' };
  }
  try {
    return await NativeUsbOtg.startLiveView();
  } catch (err) {
    return {
      active: false,
      error: err instanceof Error ? err.message : 'Lỗi bật Live View',
    };
  }
}

export async function stopUsbLiveView(): Promise<LiveViewControlResult> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.stopLiveView !== 'function'
  ) {
    return { active: false, ok: false };
  }
  try {
    return await NativeUsbOtg.stopLiveView();
  } catch {
    return { active: false, ok: false };
  }
}

export async function fetchUsbLiveViewFrame(): Promise<LiveViewFrameResult | null> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.getLiveViewFrame !== 'function'
  ) {
    return null;
  }
  try {
    return await NativeUsbOtg.getLiveViewFrame();
  } catch {
    return null;
  }
}

export async function triggerUsbAutoFocus(): Promise<OtgAutoFocusResult> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.triggerAutoFocus !== 'function'
  ) {
    return { ok: false, error: 'Thiết bị chưa hỗ trợ AF qua USB' };
  }
  try {
    return await NativeUsbOtg.triggerAutoFocus();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Lỗi lấy nét AF',
    };
  }
}

export async function captureUsbLiveViewPhoto(
  withAf = true
): Promise<CaptureOtgPhotoResult> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.captureLiveViewPhoto !== 'function'
  ) {
    return {
      ok: false,
      captured: false,
      photos: [],
      error: 'Thiết bị chưa hỗ trợ chụp từ xa qua USB',
    };
  }
  try {
    const res = await NativeUsbOtg.captureLiveViewPhoto(withAf);
    return {
      ok: Boolean(res?.ok),
      captured: Boolean(res?.captured),
      liveViewActive: res?.liveViewActive,
      totalPhotosOnCard: res?.totalPhotosOnCard,
      photos: Array.isArray(res?.photos) ? res.photos : [],
      warning: res?.warning,
      error: res?.error,
    };
  } catch (err) {
    return {
      ok: false,
      captured: false,
      photos: [],
      error: err instanceof Error ? err.message : 'Lỗi chụp ảnh qua USB OTG',
    };
  }
}

export async function getCameraPhotosSummary(
  maxItems = 120
): Promise<CameraPhotosSummaryResult> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.getCameraPhotosSummary !== 'function'
  ) {
    return { totalCount: 0, unsyncedCount: 0, photos: [] };
  }
  try {
    const res = await NativeUsbOtg.getCameraPhotosSummary(maxItems);
    return {
      totalCount: res?.totalCount ?? 0,
      unsyncedCount: res?.unsyncedCount ?? 0,
      photos: Array.isArray(res?.photos) ? res.photos : [],
      error: res?.error,
    };
  } catch (err) {
    return {
      totalCount: 0,
      unsyncedCount: 0,
      photos: [],
      error: err instanceof Error ? err.message : 'Lỗi đọc thẻ nhớ máy ảnh',
    };
  }
}

export async function getCameraPhotoThumbnail(
  handle: number
): Promise<string | null> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.getCameraPhotoThumbnail !== 'function'
  ) {
    return null;
  }
  try {
    const res = await NativeUsbOtg.getCameraPhotoThumbnail(handle);
    return res?.uri ?? null;
  } catch {
    return null;
  }
}

export async function importCameraHandles(
  handles: number[]
): Promise<{ photos: ImportedOtgPhoto[]; error?: string }> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.importCameraHandles !== 'function'
  ) {
    return { photos: [] };
  }
  try {
    const res = await NativeUsbOtg.importCameraHandles(handles);
    return {
      photos: Array.isArray(res?.photos) ? res.photos : [],
      error: res?.error,
    };
  } catch (err) {
    return {
      photos: [],
      error: err instanceof Error ? err.message : 'Lỗi tải ảnh từ máy ảnh',
    };
  }
}

export async function syncUnsyncedCameraPhotos(
  limit = 0
): Promise<SyncUnsyncedCameraResult> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.syncUnsyncedCameraPhotos !== 'function'
  ) {
    return {
      totalOnCard: 0,
      totalUnsyncedBefore: 0,
      remainingUnsynced: 0,
      photos: [],
    };
  }
  try {
    const res = await NativeUsbOtg.syncUnsyncedCameraPhotos(limit);
    return {
      totalOnCard: res?.totalOnCard ?? 0,
      totalUnsyncedBefore: res?.totalUnsyncedBefore ?? 0,
      remainingUnsynced: res?.remainingUnsynced ?? 0,
      photos: Array.isArray(res?.photos) ? res.photos : [],
      error: res?.error,
    };
  } catch (err) {
    return {
      totalOnCard: 0,
      totalUnsyncedBefore: 0,
      remainingUnsynced: 0,
      photos: [],
      error: err instanceof Error ? err.message : 'Lỗi sync ảnh từ máy ảnh',
    };
  }
}

export async function clearCameraSessionUploads(): Promise<void> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.clearCameraSessionUploads !== 'function'
  ) {
    return;
  }
  try {
    await NativeUsbOtg.clearCameraSessionUploads();
  } catch {
    // Ignore native cleanup failure
  }
}
