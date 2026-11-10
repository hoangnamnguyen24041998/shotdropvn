import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  isNativeUsbOtgAvailable,
  scanAndConnectUsbCamera,
  type UsbCameraStatus,
} from '../lib/usbOtg';

export function useUsbCamera(options?: {
  onStatusMessage?: (msg: string) => void;
}) {
  const [isOtgLiveEnabled, setIsOtgLiveEnabled] = useState<boolean>(true);
  const [usbCameraStatus, setUsbCameraStatus] = useState<UsbCameraStatus>({
    connected: false,
    status: 'NO_USB_DEVICE',
    deviceName: null,
    totalPhotosOnCard: 0,
  });
  const [otgDirectoryUri, setOtgDirectoryUri] = useState<string | null>(null);

  // Initialize USB OTG check on mount
  useEffect(() => {
    async function checkInitialOtg() {
      if (isNativeUsbOtgAvailable) {
        const status = await scanAndConnectUsbCamera();
        setUsbCameraStatus(status);
      }
    }
    void checkInitialOtg();
  }, []);

  const handleConnectUsbOtgCamera = useCallback(async () => {
    const status = await scanAndConnectUsbCamera();
    setUsbCameraStatus(status);

    if (status.connected) {
      options?.onStatusMessage?.(
        `Đã kết nối OTG: ${status.deviceName ?? 'Máy ảnh'} (${status.totalPhotosOnCard} ảnh trên thẻ). Bấm chụp để tự động đẩy lên QR!`
      );
    } else if (status.status === 'REQUESTING_PERMISSION') {
      options?.onStatusMessage?.(
        `Đang xin quyền USB cho ${status.deviceName ?? 'máy ảnh'} — hãy bấm "Cho phép" (OK) trên hộp thoại Android!`
      );
    } else if (status.status === 'NO_USB_DEVICE') {
      Alert.alert(
        'Chưa phát hiện cáp USB OTG',
        'Hãy cắm cáp USB OTG từ máy ảnh (Canon 6D / Sony / Nikon...) vào điện thoại và bật nguồn máy ảnh.'
      );
    }
  }, [options]);

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
      options?.onStatusMessage?.(
        `Đang theo dõi Live thư mục OTG (${jpegFiles.length} ảnh sẵn có). Chụp ảnh mới để tự động đẩy lên QR!`
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Không thể mở thư mục OTG';
      Alert.alert('Lỗi chọn thư mục OTG', msg);
    }
  }, [options]);

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
