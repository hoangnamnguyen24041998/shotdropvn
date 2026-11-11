import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  BoltIcon,
  DownloadTrayIcon,
  UsbCableIcon,
} from './Icons';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';
import type { UsbCameraStatus } from '../types';

interface OtgTetherConsoleProps {
  usbCameraStatus: UsbCameraStatus;
  isOtgLiveEnabled: boolean;
  otgDirectoryUri: string | null;
  uploading: boolean;
  statusMessage: string;
  isSyncingCamera: boolean;
  onToggleOtgLive: () => void;
  onConnectOtg: () => void;
  onSelectOtgFolder: () => void;
  onSyncCameraPhotos: () => void;
}

export const OtgTetherConsole: React.FC<OtgTetherConsoleProps> = ({
  usbCameraStatus,
  isOtgLiveEnabled,
  otgDirectoryUri,
  uploading,
  statusMessage,
  isSyncingCamera,
  onToggleOtgLive,
  onConnectOtg,
  onSelectOtgFolder,
  onSyncCameraPhotos,
}) => {
  // Only render OTG console when a physical USB device / Hub / camera / SAF OTG folder is present
  const hasUsbActivity =
    usbCameraStatus.connected ||
    Boolean(usbCameraStatus.usbAttached) ||
    Boolean(otgDirectoryUri) ||
    (usbCameraStatus.status !== 'NO_USB_DEVICE' &&
      usbCameraStatus.status !== 'UNSUPPORTED_PLATFORM');

  if (!hasUsbActivity) {
    return null;
  }

  // Pending / Hub-only / Mass-storage / Error state while physical USB OTG hardware is plugged in
  if (!usbCameraStatus.connected) {
    let headline = `Phát hiện USB OTG • ${usbCameraStatus.deviceName ?? 'Thiết bị'}`;
    let subtext =
      usbCameraStatus.error ||
      'Nhấn nút bên dưới để cấp quyền và kết nối máy ảnh qua cáp USB OTG.';

    if (
      usbCameraStatus.status === 'REQUESTING_PERMISSION' ||
      usbCameraStatus.status === 'PERMISSION_DENIED'
    ) {
      headline = `Chờ cấp quyền USB • ${usbCameraStatus.deviceName ?? 'Máy ảnh'}`;
      subtext =
        'Hãy bấm "Cho phép" (OK) trên hộp thoại hệ thống Android, hoặc nhấn Cấp quyền & Kết nối OTG bên dưới.';
    } else if (usbCameraStatus.status === 'HUB_ONLY') {
      headline = `Đã nhận Hub Type-C • Chưa thấy máy ảnh`;
      subtext =
        `Android đã nhận ${usbCameraStatus.deviceName ?? 'Hub Type-C'}, nhưng chưa thấy máy ảnh qua cáp Mini-USB.\n` +
        '1. Bật nguồn máy ảnh.\n' +
        '2. Tắt Wi-Fi trong menu máy ảnh (Canon khóa cổng USB khi bật Wi-Fi).\n' +
        '3. Đảm bảo cáp Mini-USB truyền được dữ liệu (không phải cáp chỉ sạc).';
    } else if (usbCameraStatus.status === 'MASS_STORAGE' || otgDirectoryUri) {
      headline = otgDirectoryUri
        ? 'Đang theo dõi thư mục thẻ nhớ OTG (SAF)'
        : `Phát hiện bộ nhớ USB • ${usbCameraStatus.deviceName ?? 'Thẻ nhớ'}`;
      subtext = otgDirectoryUri
        ? 'Ảnh JPEG mới xuất hiện trong thư mục OTG đã chọn sẽ tự động upload lên QR.'
        : 'Nếu máy ảnh ở chế độ Mass Storage hoặc cắm đầu đọc thẻ qua Hub, hãy chọn thư mục DCIM trên thẻ để đồng bộ tự động.';
    }

    return (
      <View style={[styles.tetherConsole, styles.tetherConsoleWarning]}>
        <View style={styles.otgHeaderRow}>
          <View style={styles.otgTitleCol}>
            <View style={styles.otgStatusHeadlineRow}>
              <View style={[styles.statusDot, styles.dotWarning]} />
              <Text style={styles.otgHeadline} numberOfLines={1}>
                {headline}
              </Text>
            </View>
            <Text style={styles.otgSubtext}>{subtext}</Text>
            {Boolean(usbCameraStatus.diagnosticInfo) && (
              <Text style={styles.otgDiagnosticText} numberOfLines={2}>
                {`USB: ${usbCameraStatus.diagnosticInfo}`}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.otgActionButtonsRow}>
          <Pressable
            onPress={onConnectOtg}
            disabled={uploading}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.otgPrimaryBtn,
              { backgroundColor: colors.accent },
              pressed && styles.primaryPressed,
            ]}
          >
            <UsbCableIcon size={16} color={colors.textInverse} />
            <Text style={styles.otgPrimaryBtnText}>
              {usbCameraStatus.status === 'REQUESTING_PERMISSION' ||
              usbCameraStatus.status === 'PERMISSION_DENIED'
                ? 'Cấp quyền & Kết nối OTG'
                : 'Quét lại OTG'}
            </Text>
          </Pressable>

          <Pressable
            onPress={otgDirectoryUri ? onSyncCameraPhotos : onSelectOtgFolder}
            disabled={uploading || isSyncingCamera}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.otgSecondaryBtn,
              pressed && styles.subtlePressed,
            ]}
          >
            <DownloadTrayIcon size={16} color={colors.textPrimary} />
            <Text style={styles.otgSecondaryBtnText}>
              {otgDirectoryUri ? 'Sync ảnh thẻ OTG' : 'Chọn thư mục OTG'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.tetherConsole, styles.tetherConsoleConnected]}>
      <View style={styles.otgHeaderRow}>
        <View style={styles.otgTitleCol}>
          <View style={styles.otgStatusHeadlineRow}>
            <View style={[styles.statusDot, styles.dotLive]} />
            <Text style={styles.otgHeadline} numberOfLines={1}>
              {`Đã kết nối OTG • ${usbCameraStatus.deviceName ?? 'Máy ảnh'}`}
            </Text>
          </View>

          <Text style={styles.otgSubtext} numberOfLines={2}>
            {`Thẻ nhớ có ${usbCameraStatus.totalPhotosOnCard} ảnh JPEG. Ảnh chụp mới sẽ tự động đẩy lên cùng phiên QR.`}
          </Text>
        </View>

        <Pressable
          onPress={onToggleOtgLive}
          hitSlop={8}
          accessibilityRole="switch"
          accessibilityState={{ checked: isOtgLiveEnabled }}
          accessibilityLabel="Tự động đồng bộ ảnh qua cáp OTG"
          style={[
            styles.otgToggleBtn,
            isOtgLiveEnabled
              ? styles.otgToggleBtnOn
              : styles.otgToggleBtnOff,
          ]}
        >
          <BoltIcon
            size={13}
            color={
              isOtgLiveEnabled ? colors.textInverse : colors.textSecondary
            }
          />
          <Text
            style={[
              styles.otgToggleBtnText,
              isOtgLiveEnabled && styles.otgToggleBtnTextOn,
            ]}
          >
            {isOtgLiveEnabled ? 'AUTO ON' : 'TẮT'}
          </Text>
        </Pressable>
      </View>

      {/* Single primary Sync button: compares card photos vs uploaded session photos and uploads missing ones */}
      <View style={styles.otgActionButtonsRow}>
        <Pressable
          onPress={onSyncCameraPhotos}
          disabled={isSyncingCamera || uploading}
          accessibilityRole="button"
          accessibilityLabel="Sync ảnh mới nhất từ máy ảnh"
          style={({ pressed }) => [
            styles.otgPrimaryBtn,
            pressed && styles.primaryPressed,
            (isSyncingCamera || uploading) && styles.otgBtnDisabled,
          ]}
        >
          <DownloadTrayIcon size={16} color={colors.textInverse} />
          <Text style={styles.otgPrimaryBtnText}>
            {isSyncingCamera
              ? 'Đang đối chiếu & đồng bộ...'
              : 'Sync ảnh mới nhất từ máy ảnh'}
          </Text>
        </Pressable>
      </View>

      {/* Fixed-height single-line Status Footer to avoid layout jump during shooting */}
      <View style={styles.consoleStatusFooter}>
        <Text style={styles.statusLineText} numberOfLines={1}>
          {statusMessage}
        </Text>
      </View>
    </View>
  );
};
