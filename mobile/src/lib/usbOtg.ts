import { NativeModules, Platform } from 'react-native';

export interface UsbCameraStatus {
  connected: boolean;
  status:
    | 'CONNECTED'
    | 'REQUESTING_PERMISSION'
    | 'NO_USB_DEVICE'
    | 'NO_USB_SERVICE'
    | 'OPEN_FAILED'
    | 'MTP_OPEN_FAILED'
    | 'UNSUPPORTED_PLATFORM'
    | 'ERROR';
  deviceName: string | null;
  totalPhotosOnCard: number;
  error?: string;
}

export interface ImportedOtgPhoto {
  id: string;
  uri: string;
  filename: string;
  creationTime: number;
}

interface ShotDropUsbOtgNativeModule {
  scanAndConnectCamera(): Promise<UsbCameraStatus>;
  pollNewPhotosFromCamera(fetchRecentCount: number): Promise<ImportedOtgPhoto[]>;
}

const NativeUsbOtg = NativeModules.ShotDropUsbOtg as
  | ShotDropUsbOtgNativeModule
  | undefined;

export const isNativeUsbOtgAvailable =
  Platform.OS === 'android' && Boolean(NativeUsbOtg);

export async function scanAndConnectUsbCamera(): Promise<UsbCameraStatus> {
  if (Platform.OS !== 'android' || !NativeUsbOtg) {
    return {
      connected: false,
      status: 'UNSUPPORTED_PLATFORM',
      deviceName: null,
      totalPhotosOnCard: 0,
    };
  }

  try {
    return await NativeUsbOtg.scanAndConnectCamera();
  } catch (err) {
    return {
      connected: false,
      status: 'ERROR',
      deviceName: null,
      totalPhotosOnCard: 0,
      error: err instanceof Error ? err.message : 'Lỗi kết nối USB OTG',
    };
  }
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
