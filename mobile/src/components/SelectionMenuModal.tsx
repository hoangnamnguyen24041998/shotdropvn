import React from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponderGestureState,
  Pressable,
  Text,
  View,
} from 'react-native';
import {
  CheckIcon,
  CloseIcon,
  SparklesIcon,
  TrashIcon,
  UploadArrowIcon,
} from './Icons';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';
import type { ActiveSession, LocalPhotoItem } from '../types';

interface SelectionMenuModalProps {
  visible: boolean;
  selectedPhotoIds: string[];
  uploadedPhotoIds: string[];
  recentPhotos: LocalPhotoItem[];
  activeSession: ActiveSession | null;
  uploading: boolean;
  popupPan: Animated.ValueXY;
  popupScaleAnim: Animated.Value;
  panHandlers: object;
  onClose: () => void;
  onToggleSelectPhoto: (id: string) => void;
  onSelectAll: () => void;
  onSelectAllUploaded: () => void;
  onClearSelection: () => void;
  onUploadSelected: (forceNewSession: boolean) => void;
  onDeleteSelected: () => void;
}

export const SelectionMenuModal: React.FC<SelectionMenuModalProps> = ({
  visible,
  selectedPhotoIds,
  uploadedPhotoIds,
  recentPhotos,
  activeSession,
  uploading,
  popupPan,
  popupScaleAnim,
  panHandlers,
  onClose,
  onToggleSelectPhoto,
  onSelectAll,
  onSelectAllUploaded,
  onClearSelection,
  onUploadSelected,
  onDeleteSelected,
}) => {
  if (!visible) return null;

  const selectedUploadedCount = selectedPhotoIds.filter((id) =>
    uploadedPhotoIds.includes(id)
  ).length;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} style={styles.centerSelectionBackdrop}>
        <Animated.View
          style={[
            styles.centerSelectionCard,
            {
              transform: [
                { translateX: popupPan.x },
                { translateY: popupPan.y },
                { scale: popupScaleAnim },
              ],
            },
          ]}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={styles.centerSelectionCardInner}
          >
            {/* Draggable Top Handle */}
            <View {...panHandlers} style={styles.sheetGrabberZone}>
              <View style={styles.sheetGrabber} />
            </View>

            {/* Modal Header */}
            <View {...panHandlers} style={styles.centerModalHeader}>
              <View style={styles.selectionSummaryRow}>
                <View style={styles.centerModalCountCircle}>
                  <Text style={styles.centerModalCountText}>
                    {selectedPhotoIds.length}
                  </Text>
                </View>

                <View style={styles.selectionTitleCol}>
                  <Text style={styles.centerModalTitle}>
                    Đã chọn {selectedPhotoIds.length} ảnh
                  </Text>
                  <Text style={styles.centerModalSubtitle} numberOfLines={1}>
                    {selectedUploadedCount > 0
                      ? `Có ${selectedUploadedCount} ảnh đã lên Web`
                      : 'Sẵn sàng đẩy lên mã QR hoặc xoá'}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={onClose}
                hitSlop={8}
                accessibilityLabel="Đóng hộp thoại"
                style={({ pressed }) => [
                  styles.quickClearCircleBtn,
                  pressed && styles.subtlePressed,
                ]}
              >
                <CloseIcon size={14} color={colors.textSecondary} />
              </Pressable>
            </View>

            {/* Horizontal Scrollable Photo Strip */}
            <View style={styles.centerStripSection}>
              <View style={styles.centerStripHeaderRow}>
                <Text style={styles.centerStripLabel}>
                  Chạm vào ảnh bên dưới để chọn / bỏ chọn nhanh:
                </Text>
              </View>

              <FlatList
                data={recentPhotos}
                keyExtractor={(item) => `modal-${item.id}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.centerStripList}
                renderItem={({ item }) => {
                  const isItemSelected = selectedPhotoIds.includes(item.id);
                  const isItemUploaded = uploadedPhotoIds.includes(item.id);

                  return (
                    <Pressable
                      onPress={() => onToggleSelectPhoto(item.id)}
                      style={[
                        styles.centerStripThumbWrap,
                        isItemSelected && styles.centerStripThumbSelected,
                      ]}
                    >
                      <Image
                        source={{ uri: item.uri }}
                        style={styles.centerStripThumbImg}
                      />
                      {isItemUploaded && (
                        <View style={styles.centerStripLiveDot} />
                      )}
                      <View
                        style={[
                          styles.centerStripCheckBadge,
                          isItemSelected &&
                            styles.centerStripCheckBadgeActive,
                        ]}
                      >
                        {isItemSelected && (
                          <CheckIcon size={10} color={colors.textInverse} />
                        )}
                      </View>
                    </Pressable>
                  );
                }}
              />
            </View>

            {/* Quick Filter Chips */}
            <View style={styles.expandedQuickSelectRow}>
              <Pressable
                onPress={onSelectAll}
                style={({ pressed }) => [
                  styles.expandedChipBtn,
                  pressed && styles.subtlePressed,
                ]}
              >
                <CheckIcon size={12} color={colors.textPrimary} />
                <Text style={styles.expandedChipBtnText}>
                  Chọn tất cả ({recentPhotos.length})
                </Text>
              </Pressable>

              {uploadedPhotoIds.length > 0 && (
                <Pressable
                  onPress={onSelectAllUploaded}
                  style={({ pressed }) => [
                    styles.expandedChipBtn,
                    pressed && styles.subtlePressed,
                  ]}
                >
                  <CheckIcon size={12} color={colors.liveDark} />
                  <Text style={styles.expandedChipBtnText}>
                    Đã đẩy ({uploadedPhotoIds.length})
                  </Text>
                </Pressable>
              )}

              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.expandedChipBtn,
                  pressed && styles.subtlePressed,
                ]}
              >
                <Text style={styles.expandedChipBtnText}>
                  Chọn thêm trên lưới
                </Text>
              </Pressable>

              <Pressable
                onPress={onClearSelection}
                style={[styles.expandedChipBtn, styles.expandedChipClear]}
              >
                <CloseIcon size={12} color={colors.error} />
                <Text style={styles.expandedChipClearText}>Bỏ chọn hết</Text>
              </Pressable>
            </View>

            {/* Primary Actions Stack */}
            <View style={styles.centerModalActionsStack}>
              <Pressable
                onPress={() => onUploadSelected(false)}
                disabled={uploading}
                style={({ pressed }) => [
                  styles.centerPrimaryUploadBtn,
                  uploading && styles.btnDisabled,
                  pressed && styles.primaryPressed,
                ]}
              >
                <View style={styles.menuUploadIconBadge}>
                  <UploadArrowIcon size={18} color={colors.textInverse} />
                </View>
                <View style={styles.menuUploadTextCol}>
                  <Text style={styles.centerPrimaryUploadTitle}>
                    {activeSession
                      ? `Upload tiếp ${selectedPhotoIds.length} ảnh vào QR hiện tại`
                      : `Tạo mã QR & Upload ${selectedPhotoIds.length} ảnh`}
                  </Text>
                  <Text style={styles.centerPrimaryUploadSub}>
                    {activeSession
                      ? `Đẩy thẳng lên phiên #${activeSession.qr_code_hash}`
                      : 'Khởi tạo ngay mã QR Live mới trên Web'}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => onUploadSelected(true)}
                disabled={uploading}
                style={({ pressed }) => [
                  styles.expandedMenuOptionBtn,
                  pressed && styles.subtlePressed,
                ]}
              >
                <View style={styles.expandedOptionIconBox}>
                  <SparklesIcon size={18} color={colors.liveDark} />
                </View>
                <View style={styles.expandedOptionTextCol}>
                  <Text style={styles.expandedOptionTitle}>
                    Tạo mã QR mới & Upload riêng {selectedPhotoIds.length} ảnh
                  </Text>
                  <Text style={styles.expandedOptionDesc}>
                    Tách sang một album QR độc lập hoàn toàn
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={onDeleteSelected}
                disabled={uploading}
                style={({ pressed }) => [
                  styles.centerDeleteBtn,
                  uploading && styles.btnDisabled,
                  pressed && styles.primaryPressed,
                ]}
              >
                <TrashIcon size={16} color={colors.error} />
                <Text style={styles.menuDeleteBtnText}>
                  Xoá {selectedPhotoIds.length} ảnh đã chọn khỏi danh sách
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
};
