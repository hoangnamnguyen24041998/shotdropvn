import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Share,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  CameraApertureIcon,
  CloseIcon,
  QrViewfinderIcon,
  ShareArrowIcon,
} from './Icons';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';
import { buildGuestUrl } from '../lib/supabase';
import type { ActiveSession } from '../types';

interface QrStudioDeckProps {
  activeSession: ActiveSession | null;
  sessionPhotosCount: number;
  webOrigin: string;
  pulseAnim: Animated.Value;
  uploading: boolean;
  statusMessage: string;
  onPickPhotos: () => void;
  onEndSession: () => void;
}

export const QrStudioDeck: React.FC<QrStudioDeckProps> = ({
  activeSession,
  sessionPhotosCount,
  webOrigin,
  pulseAnim,
  uploading,
  statusMessage,
  onPickPhotos,
  onEndSession,
}) => {
  const guestUrl = activeSession
    ? buildGuestUrl(activeSession.qr_code_hash, webOrigin)
    : '';

  const handleShareQrLink = async () => {
    if (!activeSession) return;
    try {
      await Share.share({
        title: activeSession.event_name,
        message: `Nhận ảnh sự kiện tại: ${guestUrl}`,
        url: guestUrl,
      });
    } catch {
      // Ignore share cancel
    }
  };

  return (
    <View style={styles.sessionCard}>
      {activeSession ? (
        <View style={styles.activeSessionBox}>
          <View style={styles.sessionTopRow}>
            <View style={styles.sessionIdentityCol}>
              <View style={styles.sessionTitleRow}>
                <Text style={styles.sessionHashText}>
                  #{activeSession.qr_code_hash}
                </Text>
                <View style={styles.liveTagPill}>
                  <View style={styles.dotLiveSmall} />
                  <Text style={styles.liveTagText}>ĐANG PHÁT</Text>
                </View>
              </View>
              <Text style={styles.sessionEventName} numberOfLines={1}>
                {activeSession.event_name}
              </Text>
            </View>

            <View style={styles.counterBox}>
              <Text style={styles.counterValue}>{sessionPhotosCount}</Text>
              <Text style={styles.counterLabel}>ảnh trên Web</Text>
            </View>
          </View>

          {/* Precision QR Viewfinder Frame */}
          <View style={styles.qrOuterStage}>
            <View style={[styles.qrCorner, styles.qrCornerTL]} />
            <View style={[styles.qrCorner, styles.qrCornerTR]} />
            <View style={[styles.qrCorner, styles.qrCornerBL]} />
            <View style={[styles.qrCorner, styles.qrCornerBR]} />

            <View style={styles.qrFrame}>
              <QRCode
                value={guestUrl}
                size={190}
                color={colors.textPrimary}
                backgroundColor={colors.surface}
              />
            </View>
          </View>

          <Pressable
            onPress={handleShareQrLink}
            style={({ pressed }) => [
              styles.guestUrlPill,
              pressed && styles.subtlePressed,
            ]}
          >
            <Text style={styles.guestUrlText} numberOfLines={1}>
              {guestUrl}
            </Text>
          </Pressable>

          {/* Pulsing Live Sync Banner */}
          <Animated.View
            style={[styles.pulsingBanner, { opacity: pulseAnim }]}
          >
            <View style={styles.dotLive} />
            <Text style={styles.pulsingBannerText}>
              Đồng bộ Live đang bật • Chụp thêm để tự động đẩy vào QR này
            </Text>
          </Animated.View>

          <View style={styles.sessionActionRow}>
            <Pressable
              onPress={handleShareQrLink}
              accessibilityRole="button"
              accessibilityLabel="Chia sẻ đường dẫn nhận ảnh"
              style={({ pressed }) => [
                styles.shareLinkBtn,
                pressed && styles.subtlePressed,
              ]}
            >
              <ShareArrowIcon size={17} color={colors.textPrimary} />
              <Text style={styles.shareLinkBtnText}>Chia sẻ Link</Text>
            </Pressable>

            <Pressable
              onPress={onEndSession}
              accessibilityRole="button"
              accessibilityLabel="Kết thúc phiên chụp hiện tại"
              style={({ pressed }) => [
                styles.endSessionBtn,
                pressed && styles.primaryPressed,
              ]}
            >
              <CloseIcon size={15} color={colors.textInverse} />
              <Text style={styles.endSessionBtnText}>Kết thúc phiên</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.standbyBox}>
          <View style={styles.standbyIconBadge}>
            <QrViewfinderIcon size={26} color={colors.textPrimary} />
          </View>
          <Text style={styles.standbyHeadline}>
            Chụp ảnh qua cáp OTG hoặc chọn ảnh để mở mã QR Live
          </Text>
          <Text style={styles.standbySub}>
            Khi cắm cáp USB OTG và chụp ảnh (hoặc chọn ảnh từ thư viện), mã QR
            Live sẽ tự động hiển thị tại đây để khách quét nhận ảnh ngay.
          </Text>

          {/* Direct Pick Button so user can immediately launch session without OTG */}
          <Pressable
            onPress={onPickPhotos}
            disabled={uploading}
            style={({ pressed }) => [
              styles.canonConnectHeroBtn,
              { width: '100%', marginTop: 12 },
              uploading && styles.btnDisabled,
              pressed && styles.primaryPressed,
            ]}
          >
            {uploading ? (
              <View style={styles.uploadingRow}>
                <ActivityIndicator size="small" color={colors.textInverse} />
                <Text
                  style={styles.canonConnectHeroBtnText}
                  numberOfLines={1}
                >
                  {statusMessage}
                </Text>
              </View>
            ) : (
              <View style={styles.canonBtnInner}>
                <View style={styles.canonBtnTitleRow}>
                  <CameraApertureIcon size={19} color={colors.textInverse} />
                  <Text style={styles.canonConnectHeroBtnText}>
                    Chọn ảnh từ thư viện / Canon Connect
                  </Text>
                </View>
                <Text style={styles.canonConnectHeroBtnSub}>
                  Chọn ảnh trên máy → Tạo ngay mã QR Live
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
};
