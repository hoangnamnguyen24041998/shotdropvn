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
  isNativeUsbOtgAvailable,
  scanAndConnectUsbCamera,
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
      if (nextState === 'active') {
        void refreshUsbStatus(false);
      }
    });

    return () => {
      usbSub.remove();
      appStateSub.remove();
    };
  }, [refreshUsbStatus]);

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

  return {
    usbCameraStatus,
    setUsbCameraStatus,
    isOtgLiveEnabled,
    setIsOtgLiveEnabled,
    otgDirectoryUri,
    handleConnectUsbOtgCamera,
    handleSelectOtgFolder,
  };
}
