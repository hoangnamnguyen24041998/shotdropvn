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
  diagnosticInfo?: string;
  error?: string;
}

export interface ImportedOtgPhoto {
  id: string;
  uri: string;
  filename: string;
  handle?: number;
  size?: number;
  cameraKey?: string;
  creationTime: number;
}

export interface SyncUsbCameraResult {
  status: UsbCameraStatus;
  newPhotos: ImportedOtgPhoto[];
}

export interface CameraCardPhotoItem {
  handle: number;
  filename: string;
  size: number;
  cameraKey: string;
  alreadyUploaded?: boolean;
  thumbUri: string | null;
}

export interface CameraPhotosSummaryResult {
  totalCount: number;
  photos: CameraCardPhotoItem[];
  error?: string;
}

interface ShotDropUsbOtgNativeModule {
  scanAndConnectCamera(): Promise<UsbCameraStatus>;
  pollNewPhotosFromCamera(fetchRecentCount: number): Promise<ImportedOtgPhoto[]>;
  syncUsbCamera?(
    manualRequest: boolean,
    fetchRecentCount: number
  ): Promise<SyncUsbCameraResult>;
  getCameraPhotosSummary?(maxItems: number): Promise<CameraPhotosSummaryResult>;
  getCameraPhotoThumbnail?(handle: number): Promise<{ uri: string | null }>;
  importCameraHandles?(
    handles: number[]
  ): Promise<{ photos: ImportedOtgPhoto[]; error?: string }>;
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

export async function getCameraPhotosSummary(
  maxItems = 120
): Promise<CameraPhotosSummaryResult> {
  if (
    Platform.OS !== 'android' ||
    !NativeUsbOtg ||
    typeof NativeUsbOtg.getCameraPhotosSummary !== 'function'
  ) {
    return { totalCount: 0, photos: [] };
  }
  try {
    const res = await NativeUsbOtg.getCameraPhotosSummary(maxItems);
    return {
      totalCount: res?.totalCount ?? 0,
      photos: Array.isArray(res?.photos) ? res.photos : [],
      error: res?.error,
    };
  } catch (err) {
    return {
      totalCount: 0,
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
