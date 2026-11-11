import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  DeviceEventEmitter,
  Platform,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  USB_OTG_CHANGED_EVENT,
  fetchUsbLiveViewFrame,
  isNativeUsbOtgAvailable,
  scanAndConnectUsbCamera,
  startUsbLiveView,
  stopUsbLiveView,
  triggerUsbAutoFocus,
  type UsbCameraStatus,
} from '../lib/usbOtg';

export function useUsbCamera(options?: {
  onStatusMessage?: (msg: string) => void;
}) {
  const onStatusMessageRef = useRef(options?.onStatusMessage);
  onStatusMessageRef.current = options?.onStatusMessage;

  const [isOtgLiveEnabled, setIsOtgLiveEnabled] = useState<boolean>(true);
  const [usbCameraStatus, setUsbCameraStatus] = useState<UsbCameraStatus>({
    connected: false,
    usbAttached: false,
    status: 'NO_USB_DEVICE',
    deviceName: null,
    totalPhotosOnCard: 0,
  });
  const [otgDirectoryUri, setOtgDirectoryUri] = useState<string | null>(null);
  const [isLiveViewActive, setIsLiveViewActive] = useState<boolean>(false);
  const [liveViewFrameUri, setLiveViewFrameUri] = useState<string | null>(null);
  const [isFocusingOtg, setIsFocusingOtg] = useState<boolean>(false);
  const [isCapturingOtg, setIsCapturingOtg] = useState<boolean>(false);

  const isCapturingOtgRef = useRef<boolean>(false);
  const isAppActiveRef = useRef<boolean>(AppState.currentState === 'active');
  const isLiveViewUserToggledOffRef = useRef<boolean>(false);
  const autoStartedLiveViewDeviceRef = useRef<string | null>(null);

  const setCapturingOtgState = useCallback((next: boolean) => {
    isCapturingOtgRef.current = next;
    setIsCapturingOtg(next);
  }, []);

  const refreshUsbStatus = useCallback(async (manualRequest = false) => {
    if (!isNativeUsbOtgAvailable) return null;
    const status = await scanAndConnectUsbCamera(manualRequest);
    setUsbCameraStatus(status);
    return status;
  }, []);

  // Listen to native Android USB attach / detach / permission broadcasts and app foreground resume
  useEffect(() => {
    void refreshUsbStatus(false);

    if (Platform.OS !== 'android') return;

    const usbSub = DeviceEventEmitter.addListener(USB_OTG_CHANGED_EVENT, () => {
      void refreshUsbStatus(false);
    });

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      isAppActiveRef.current = nextState === 'active';
      if (nextState === 'active') {
        void refreshUsbStatus(false);
      }
    });

    return () => {
      usbSub.remove();
      appStateSub.remove();
    };
  }, [refreshUsbStatus]);

  // Automatically mirror Canon Live View into app when camera connects with LV active
  useEffect(() => {
    if (!usbCameraStatus.connected || !usbCameraStatus.supportsLiveView) {
      setIsLiveViewActive(false);
      setLiveViewFrameUri(null);
      isLiveViewUserToggledOffRef.current = false;
      autoStartedLiveViewDeviceRef.current = null;
      return;
    }

    const deviceKey = usbCameraStatus.deviceName || 'canon-eos';
    if (
      usbCameraStatus.liveViewActive &&
      !isLiveViewActive &&
      !isLiveViewUserToggledOffRef.current &&
      autoStartedLiveViewDeviceRef.current !== deviceKey
    ) {
      autoStartedLiveViewDeviceRef.current = deviceKey;
      void (async () => {
        const res = await startUsbLiveView();
        if (res.active) {
          setIsLiveViewActive(true);
        }
      })();
    }
  }, [
    isLiveViewActive,
    usbCameraStatus.connected,
    usbCameraStatus.deviceName,
    usbCameraStatus.liveViewActive,
    usbCameraStatus.supportsLiveView,
  ]);

  // Sequential Live View frame loop (automatically yields during remote shutter capture / background)
  useEffect(() => {
    if (
      !usbCameraStatus.connected ||
      !usbCameraStatus.supportsLiveView ||
      !isLiveViewActive
    ) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pullNextFrame = async () => {
      if (cancelled) return;
      if (!isAppActiveRef.current || isCapturingOtgRef.current) {
        timer = setTimeout(() => {
          void pullNextFrame();
        }, 200);
        return;
      }

      const frame = await fetchUsbLiveViewFrame();
      if (cancelled) return;

      if (frame) {
        if (frame.uri) {
          setLiveViewFrameUri(frame.uri);
        }
        if (frame.active === false) {
          setIsLiveViewActive(false);
          setLiveViewFrameUri(null);
          setUsbCameraStatus((prev) => ({ ...prev, liveViewActive: false }));
          return;
        }
      }

      timer = setTimeout(() => {
        void pullNextFrame();
      }, 75);
    };

    void pullNextFrame();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    isLiveViewActive,
    usbCameraStatus.connected,
    usbCameraStatus.supportsLiveView,
  ]);

  const handleConnectUsbOtgCamera = useCallback(async () => {
    const status = await scanAndConnectUsbCamera(true);
    setUsbCameraStatus(status);

    if (status.connected) {
      onStatusMessageRef.current?.(
        `Đã kết nối OTG: ${status.deviceName ?? 'Máy ảnh'} (${status.totalPhotosOnCard} ảnh trên thẻ). Bấm chụp để tự động đẩy lên QR!`
      );
    } else if (
      status.status === 'REQUESTING_PERMISSION' ||
      status.status === 'PERMISSION_DENIED'
    ) {
      onStatusMessageRef.current?.(
        `Đang xin quyền USB cho ${status.deviceName ?? 'máy ảnh'} — hãy bấm "Cho phép" (OK) trên hộp thoại Android!`
      );
    } else if (status.status === 'HUB_ONLY') {
      Alert.alert(
        'Đã nhận Hub Type-C, chưa thấy máy ảnh',
        `Android đã nhận ${status.deviceName ?? 'Hub Type-C'} nhưng chưa thấy máy ảnh qua cáp Mini-USB.\n\nHãy kiểm tra:\n1. Máy ảnh đã bật nguồn chưa.\n2. Tắt Wi-Fi trên máy ảnh (Canon sẽ khóa cổng USB khi bật Wi-Fi).\n3. Cáp Mini-USB phải là cáp truyền dữ liệu (không phải cáp chỉ sạc).`
      );
    } else if (status.status === 'MASS_STORAGE') {
      onStatusMessageRef.current?.(
        `Phát hiện bộ nhớ USB (${status.deviceName ?? 'Thẻ nhớ'}) — hãy chọn thư mục ảnh OTG để đồng bộ.`
      );
    } else if (
      status.status === 'MTP_OPEN_FAILED' ||
      status.status === 'OPEN_FAILED' ||
      status.status === 'ERROR'
    ) {
      Alert.alert(
        'Lỗi giao tiếp USB OTG',
        status.error ||
          'Không mở được phiên PTP/MTP với máy ảnh. Hãy tắt Wi-Fi máy ảnh, đóng app Ảnh mặc định của máy rồi cắm lại cáp.'
      );
    } else if (status.status === 'NO_USB_DEVICE') {
      Alert.alert(
        'Chưa phát hiện thiết bị USB OTG',
        'Hãy cắm Hub Type-C / cáp OTG vào điện thoại và bật tùy chọn "Kết nối OTG" trong Cài đặt hệ thống Android (nếu máy có mục này).'
      );
    }
  }, []);

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
      setOtgDirectoryUri(perm.directoryUri);
      onStatusMessageRef.current?.(
        `Đang theo dõi Live thư mục OTG (${jpegFiles.length} ảnh sẵn có). Chụp ảnh mới để tự động đẩy lên QR!`
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Không thể mở thư mục OTG';
      Alert.alert('Lỗi chọn thư mục OTG', msg);
    }
  }, []);

  const handleToggleLiveView = useCallback(async () => {
    if (!usbCameraStatus.connected || !usbCameraStatus.supportsLiveView) return;

    if (isLiveViewActive) {
      isLiveViewUserToggledOffRef.current = true;
      setIsLiveViewActive(false);
      setLiveViewFrameUri(null);
      await stopUsbLiveView();
      setUsbCameraStatus((prev) => ({ ...prev, liveViewActive: false }));
      return;
    }

    isLiveViewUserToggledOffRef.current = false;
    const res = await startUsbLiveView();
    if (res.active) {
      setIsLiveViewActive(true);
      setUsbCameraStatus((prev) => ({ ...prev, liveViewActive: true }));
      onStatusMessageRef.current?.('Đã bật Live View qua USB OTG!');
    } else {
      Alert.alert(
        'Không bật được Live View',
        res.error ||
          'Hãy kiểm tra nút Live View / chế độ chụp tĩnh trên máy ảnh Canon.'
      );
    }
  }, [
    isLiveViewActive,
    usbCameraStatus.connected,
    usbCameraStatus.supportsLiveView,
  ]);

  const handleAutoFocusOtg = useCallback(async () => {
    if (
      !usbCameraStatus.connected ||
      !usbCameraStatus.supportsAutoFocus ||
      isFocusingOtg ||
      isCapturingOtgRef.current
    ) {
      return;
    }
    setIsFocusingOtg(true);
    try {
      const res = await triggerUsbAutoFocus();
      if (res.ok) {
        onStatusMessageRef.current?.('Đã lấy nét AF trên máy ảnh!');
      } else {
        onStatusMessageRef.current?.(
          res.error || 'Chưa lấy nét được (kiểm tra ống kính AF/MF)'
        );
      }
    } finally {
      setIsFocusingOtg(false);
    }
  }, [
    isFocusingOtg,
    usbCameraStatus.connected,
    usbCameraStatus.supportsAutoFocus,
  ]);

  return {
    usbCameraStatus,
    setUsbCameraStatus,
    isOtgLiveEnabled,
    setIsOtgLiveEnabled,
    otgDirectoryUri,
    isLiveViewActive,
    liveViewFrameUri,
    isFocusingOtg,
    isCapturingOtg,
    isCapturingOtgRef,
    setCapturingOtgState,
    handleConnectUsbOtgCamera,
    handleSelectOtgFolder,
    handleToggleLiveView,
    handleAutoFocusOtg,
  };
}
