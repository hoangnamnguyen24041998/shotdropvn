import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { SettingsSlidersIcon } from './Icons';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';
import type { ActiveSession, UsbCameraStatus } from '../types';

interface AppHeaderProps {
  appVersion: string;
  activeSession: ActiveSession | null;
  usbCameraStatus: UsbCameraStatus;
  onOpenSettings: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  appVersion,
  activeSession,
  usbCameraStatus,
  onOpenSettings,
}) => {
  const isLive = Boolean(activeSession || usbCameraStatus.connected);

  return (
    <View style={styles.header}>
      <Pressable onPress={onOpenSettings} style={styles.brandRow}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.brandLogo}
        />
        <View style={styles.brandTextCol}>
          <View style={styles.brandTitleRow}>
            <Text style={styles.brandTitle}>ShotDrop VN</Text>
            <View style={styles.versionBadge}>
              <Text style={styles.versionBadgeText}>v{appVersion}</Text>
            </View>
          </View>
        </View>
      </Pressable>

      <View style={styles.headerActionsRow}>
        {/* Render status badge ONLY when active session or OTG camera is connected; NO STANDBY view */}
        {isLive && (
          <View style={[styles.statusBadge, styles.statusBadgeLive]}>
            <View style={[styles.statusDot, styles.dotLive]} />
            <Text
              style={[styles.statusBadgeText, styles.statusBadgeTextLive]}
            >
              {usbCameraStatus.connected ? 'OTG LIVE' : 'LIVE QR'}
            </Text>
          </View>
        )}

        {/* Quick Settings Button to configure Web URL & Supabase Key */}
        <Pressable
          onPress={onOpenSettings}
          hitSlop={8}
          accessibilityLabel="Cấu hình URL Web và Supabase Key"
          style={({ pressed }) => [
            styles.headerSettingsBtn,
            pressed && styles.subtlePressed,
          ]}
        >
          <SettingsSlidersIcon size={18} color={colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
};
