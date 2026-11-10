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
  uploading: boolean;
  statusMessage: string;
  onToggleOtgLive: () => void;
  onConnectOtg: () => void;
  onPullLatestPhotos: (count: number) => void;
}

export const OtgTetherConsole: React.FC<OtgTetherConsoleProps> = ({
  usbCameraStatus,
  isOtgLiveEnabled,
  uploading,
  statusMessage,
  onToggleOtgLive,
  onConnectOtg,
  onPullLatestPhotos,
}) => {
  // Requirement: Only show OTG Tether UI when USB OTG is physically connected
  if (!usbCameraStatus.connected) {
    return null;
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

          <Text style={styles.otgSubtext}>
            {`Đang có ${usbCameraStatus.totalPhotosOnCard} ảnh JPEG trên thẻ nhớ. Bấm chụp để tự động đẩy thẳng lên QR Web.`}
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

      {/* Secondary OTG Hardware Controls */}
      <View style={styles.otgActionButtonsRow}>
        <Pressable
          onPress={onConnectOtg}
          disabled={uploading}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.otgSecondaryBtn,
            pressed && styles.subtlePressed,
          ]}
        >
          <UsbCableIcon size={16} color={colors.textPrimary} />
          <Text style={styles.otgSecondaryBtnText}>Kiểm tra OTG</Text>
        </Pressable>

        <Pressable
          onPress={() => onPullLatestPhotos(5)}
          disabled={uploading}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.otgPrimaryBtn,
            pressed && styles.primaryPressed,
          ]}
        >
          <DownloadTrayIcon size={16} color={colors.textInverse} />
          <Text style={styles.otgPrimaryBtnText}>Lấy 5 ảnh vừa chụp</Text>
        </Pressable>
      </View>

      {/* Live Status Bar inside Console */}
      <View style={styles.consoleStatusFooter}>
        <Text style={styles.statusLineText} numberOfLines={2}>
          {statusMessage}
        </Text>
        <Text style={styles.hintLineText}>
          Chạm để chọn nhiều ảnh hoặc nhấn giữ vào ảnh để hiện nút Upload tiếp /
          Xoá nhanh.
        </Text>
      </View>
    </View>
  );
};
