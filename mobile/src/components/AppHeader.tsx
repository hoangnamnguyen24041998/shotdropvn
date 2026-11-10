import React from 'react';
import { Image, Text, View } from 'react-native';
import { styles } from '../styles/appStyles';
import type { ActiveSession, UsbCameraStatus } from '../types';

interface AppHeaderProps {
  appVersion: string;
  activeSession: ActiveSession | null;
  usbCameraStatus: UsbCameraStatus;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  appVersion,
  usbCameraStatus,
}) => {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
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
      </View>

      <View style={styles.headerActionsRow}>
        {/* Only show hardware OTG LIVE badge when physical USB cable is connected; NO 'LIVE QR' text */}
        {usbCameraStatus.connected && (
          <View style={[styles.statusBadge, styles.statusBadgeLive]}>
            <View style={[styles.statusDot, styles.dotLive]} />
            <Text style={[styles.statusBadgeText, styles.statusBadgeTextLive]}>
              OTG LIVE
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};
