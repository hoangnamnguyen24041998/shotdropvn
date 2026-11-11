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
  recentPhotos,
  uploading,
  popupPan,
  popupScaleAnim,
  panHandlers,
  onClose,
  onToggleSelectPhoto,
  onSelectAll,
  onClearSelection,
  onUploadSelected,
  onDeleteSelected,
}) => {
  if (!visible) return null;

  const selectedPhotos = recentPhotos.filter((item) =>
    selectedPhotoIds.includes(item.id)
  );

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
                    Đã chọn {selectedPhotos.length} ảnh
                  </Text>
                  <Text style={styles.centerModalSubtitle} numberOfLines={1}>
                    Tách sang mã QR mới hoặc xoá khỏi phiên
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

            {/* Horizontal Scrollable Selected Photo Strip */}
            <View style={styles.centerStripSection}>
              <View style={styles.centerStripHeaderRow}>
                <Text style={styles.centerStripLabel}>
                  Danh sách ảnh đã chọn ({selectedPhotos.length}) • Chạm để bỏ chọn:
                </Text>
              </View>

              <FlatList
                data={selectedPhotos}
                keyExtractor={(item) => `modal-${item.id}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.centerStripList}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => onToggleSelectPhoto(item.id)}
                    style={[
                      styles.centerStripThumbWrap,
                      styles.centerStripThumbSelected,
                    ]}
                  >
                    <Image
                      source={{ uri: item.uri }}
                      style={styles.centerStripThumbImg}
                    />
                    <View
                      style={[
                        styles.centerStripCheckBadge,
                        styles.centerStripCheckBadgeActive,
                      ]}
                    >
                      <CheckIcon size={10} color={colors.textInverse} />
                    </View>
                  </Pressable>
                )}
              />
            </View>

            {/* Quick Filter Chips */}
            <View style={styles.expandedQuickSelectRow}>
              {selectedPhotos.length < recentPhotos.length && (
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
