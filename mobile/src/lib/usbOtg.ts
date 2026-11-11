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
    | 'UNSUPPORTED_PLATFORM'
    | 'ERROR';
  deviceName: string | null;
  totalPhotosOnCard: number;
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

interface ShotDropUsbOtgNativeModule {
  scanAndConnectCamera(): Promise<UsbCameraStatus>;
  pollNewPhotosFromCamera(fetchRecentCount: number): Promise<ImportedOtgPhoto[]>;
  syncUsbCamera?(
    manualRequest: boolean,
    fetchRecentCount: number
  ): Promise<SyncUsbCameraResult>;
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
