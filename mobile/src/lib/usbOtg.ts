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
