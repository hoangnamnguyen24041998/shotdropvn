import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CameraApertureIcon,
  CheckIcon,
  CloseIcon,
  FolderOpenIcon,
  UploadArrowIcon,
} from './Icons';
import {
  getAndroidSystemBottomInset,
  getCameraPhotoThumbnail,
  type CameraCardPhotoItem,
} from '../lib/usbOtg';
import { colors, radii, spacing } from '../theme/tokens';
import type { ActiveSession } from '../types';

interface CameraOtgPickerModalProps {
  visible: boolean;
  cameraName: string | null;
  activeSession: ActiveSession | null;
  photos: CameraCardPhotoItem[];
  totalCount: number;
  unsyncedCount: number;
  loading: boolean;
  syncing: boolean;
  onClose: () => void;
  onUploadHandles: (handles: number[]) => void;
  onSyncUnsynced: (limit: number) => void;
  onSwitchToPhoneGallery: () => void;
}

export const CameraOtgPickerModal: React.FC<CameraOtgPickerModalProps> = ({
  visible,
  cameraName,
  activeSession,
  photos,
  totalCount,
  unsyncedCount,
  loading,
  syncing,
  onClose,
  onUploadHandles,
  onSyncUnsynced,
  onSwitchToPhoneGallery,
}) => {
  const [selectedHandles, setSelectedHandles] = useState<number[]>([]);
  const [thumbMap, setThumbMap] = useState<Record<number, string>>({});
  const [androidBottomInset, setAndroidBottomInset] = useState<number>(
    Platform.OS === 'android' ? 48 : 0
  );
  const abortThumbLoadRef = useRef<boolean>(false);

  // Measure Android system navigation bar bottom inset so footer clears hardware/gesture bar
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    const measure = () => {
      void getAndroidSystemBottomInset().then((inset) => {
        if (active) setAndroidBottomInset(inset);
      });
    };
    if (visible) measure();
    const sub = Dimensions.addEventListener('change', measure);
    return () => {
      active = false;
      sub.remove();
    };
  }, [visible]);

  // Reset selection whenever modal opens/closes or photo list refreshes
  useEffect(() => {
    if (!visible) {
      abortThumbLoadRef.current = true;
      setSelectedHandles([]);
      return;
    }
    abortThumbLoadRef.current = false;
    const initialMap: Record<number, string> = {};
    for (const p of photos) {
      if (p.thumbUri) {
        initialMap[p.handle] = p.thumbUri;
      }
    }
    setThumbMap(initialMap);
  }, [photos, visible]);

  // Sequential background thumbnail loader so PTP USB bus stays snappy
  useEffect(() => {
    if (!visible || loading || syncing || photos.length === 0) return;

    let cancelled = false;
    const missing = photos
      .filter((p) => !p.thumbUri && !thumbMap[p.handle])
      .slice(0, 60);

    if (missing.length === 0) return;

    const loadSeq = async () => {
      for (const item of missing) {
        if (cancelled || abortThumbLoadRef.current) break;
        const uri = await getCameraPhotoThumbnail(item.handle);
        if (cancelled || abortThumbLoadRef.current) break;
        if (uri) {
          setThumbMap((prev) => ({ ...prev, [item.handle]: uri }));
        }
      }
    };

    void loadSeq();
    return () => {
      cancelled = true;
    };
  }, [loading, photos, syncing, visible]);

  const toggleHandle = (handle: number) => {
    setSelectedHandles((prev) =>
      prev.includes(handle)
        ? prev.filter((h) => h !== handle)
        : [...prev, handle]
    );
  };

  if (!visible) return null;

  const quickSyncCount = unsyncedCount > 15 ? 15 : unsyncedCount;

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          {/* Header */}
          <View style={modalStyles.header}>
            <View style={modalStyles.titleCol}>
              <Text style={modalStyles.title} numberOfLines={1}>
                {`Ảnh trên ${cameraName ?? 'Máy ảnh OTG'}`}
              </Text>
              <Text style={modalStyles.subtitle} numberOfLines={1}>
                {`${totalCount} ảnh JPEG • ${unsyncedCount} chưa đồng bộ`}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel="Đóng chọn ảnh máy ảnh"
              style={modalStyles.closeBtn}
            >
              <CloseIcon size={16} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Source Switcher + Auto Sync Bar (Req 3, 4 & 5) */}
          <View style={modalStyles.quickBar}>
            {unsyncedCount > 0 && (
              <Pressable
                onPress={() => {
                  abortThumbLoadRef.current = true;
                  onSyncUnsynced(quickSyncCount);
                }}
                disabled={syncing || loading}
                style={({ pressed }) => [
                  modalStyles.quickSyncBtn,
                  pressed && modalStyles.pressed,
                ]}
              >
                <UploadArrowIcon size={14} color={colors.textInverse} />
                <Text style={modalStyles.quickSyncText}>
                  {`Auto Sync ${quickSyncCount} chưa đẩy`}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => {
                abortThumbLoadRef.current = true;
                onClose();
                onSwitchToPhoneGallery();
              }}
              disabled={syncing}
              style={({ pressed }) => [
                modalStyles.phoneGalleryBtn,
                pressed && modalStyles.pressed,
              ]}
            >
              <FolderOpenIcon size={14} color={colors.textPrimary} />
              <Text style={modalStyles.phoneGalleryText}>
                Thư viện điện thoại
              </Text>
            </Pressable>
          </View>

          {/* Grid Body */}
          {loading ? (
            <View style={modalStyles.centerBox}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={modalStyles.loadingText}>
                Đang đọc danh sách ảnh từ thẻ nhớ máy ảnh...
              </Text>
            </View>
          ) : photos.length === 0 ? (
            <View style={modalStyles.centerBox}>
              <CameraApertureIcon size={32} color={colors.textMuted} />
              <Text style={modalStyles.loadingText}>
                Không tìm thấy ảnh JPEG trên thẻ nhớ máy ảnh.
              </Text>
            </View>
          ) : (
            <FlatList
              data={photos}
              keyExtractor={(item) => `cam-${item.handle}`}
              numColumns={3}
              initialNumToRender={15}
              maxToRenderPerBatch={9}
              windowSize={5}
              columnWrapperStyle={modalStyles.gridRow}
              contentContainerStyle={modalStyles.gridContent}
              renderItem={({ item }) => {
                const isSelected = selectedHandles.includes(item.handle);
                const thumbUri = thumbMap[item.handle] ?? item.thumbUri;
                return (
                  <Pressable
                    onPress={() => toggleHandle(item.handle)}
                    style={[
                      modalStyles.tile,
                      isSelected && modalStyles.tileSelected,
                    ]}
                  >
                    {thumbUri ? (
                      <Image
                        source={{ uri: thumbUri }}
                        style={modalStyles.tileImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={modalStyles.tilePlaceholder}>
                        <CameraApertureIcon
                          size={18}
                          color={colors.textMuted}
                        />
                        <Text
                          style={modalStyles.tileFileName}
                          numberOfLines={1}
                        >
                          {item.filename}
                        </Text>
                      </View>
                    )}

                    {item.alreadyUploaded && (
                      <View style={modalStyles.uploadedBadge}>
                        <Text style={modalStyles.uploadedBadgeText}>
                          Đã lên QR
                        </Text>
                      </View>
                    )}

                    <View
                      style={[
                        modalStyles.checkCircle,
                        isSelected && modalStyles.checkCircleSelected,
                      ]}
                    >
                      {isSelected && (
                        <CheckIcon size={11} color={colors.textInverse} />
                      )}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}

          {/* Footer CTA (padded cleanly above Android system navigation bar) */}
          <View
            style={[
              modalStyles.footer,
              {
                paddingBottom:
                  Platform.OS === 'android'
                    ? Math.max(28, androidBottomInset + 14)
                    : spacing.xl,
              },
            ]}
          >
            <Pressable
              onPress={() => {
                abortThumbLoadRef.current = true;
                onUploadHandles(selectedHandles);
              }}
              disabled={selectedHandles.length === 0 || syncing || loading}
              style={({ pressed }) => [
                modalStyles.uploadBtn,
                (selectedHandles.length === 0 || syncing || loading) &&
                  modalStyles.uploadBtnDisabled,
                pressed && modalStyles.pressed,
              ]}
            >
              {syncing ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <UploadArrowIcon size={16} color={colors.textInverse} />
              )}
              <Text style={modalStyles.uploadBtnText}>
                {syncing
                  ? 'Đang chép & đẩy ảnh lên QR...'
                  : selectedHandles.length === 0
                    ? 'Chạm vào ảnh để chọn đẩy lên QR'
                    : activeSession
                      ? `Upload ${selectedHandles.length} ảnh → QR #${activeSession.qr_code_hash}`
                      : `Tạo QR mới & Upload ${selectedHandles.length} ảnh`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 17, 16, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '86%',
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  titleCol: {
    flex: 1,
    gap: 2,
    paddingRight: spacing.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.canvas,
  },
  quickSyncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.live,
  },
  quickSyncText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textInverse,
  },
  phoneGalleryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phoneGalleryText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
  },
  gridContent: {
    padding: spacing.md,
    gap: 8,
  },
  gridRow: {
    gap: 8,
  },
  tile: {
    flex: 1 / 3,
    aspectRatio: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.subtle,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  tileSelected: {
    borderColor: colors.live,
  },
  tileImg: {
    width: '100%',
    height: '100%',
  },
  tilePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    gap: 4,
  },
  tileFileName: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  uploadedBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    backgroundColor: 'rgba(22, 163, 74, 0.88)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  uploadedBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  checkCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(17, 17, 16, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleSelected: {
    backgroundColor: colors.live,
    borderColor: colors.live,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  uploadBtn: {
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
  },
  uploadBtnDisabled: {
    opacity: 0.5,
  },
  uploadBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.textInverse,
  },
  pressed: {
    opacity: 0.85,
  },
});
