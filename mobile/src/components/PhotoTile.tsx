import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import {
  CheckIcon,
  CloseIcon,
  TrashIcon,
  UploadArrowIcon,
} from './Icons';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';
import type { LocalPhotoItem } from '../types';

interface PhotoTileProps {
  item: LocalPhotoItem;
  isSelected: boolean;
  isUploaded: boolean;
  isLongPressed: boolean;
  uploading: boolean;
  isDeletingPhotos: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onCloseOverlay: () => void;
  onUploadSingle: (item: LocalPhotoItem) => void;
  onDeleteSingle: (id: string) => void;
}

export const PhotoTile: React.FC<PhotoTileProps> = ({
  item,
  isSelected,
  isUploaded,
  isLongPressed,
  uploading,
  isDeletingPhotos,
  onPress,
  onLongPress,
  onCloseOverlay,
  onUploadSingle,
  onDeleteSingle,
}) => {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={240}
      accessibilityRole="imagebutton"
      accessibilityState={{ selected: isSelected }}
      style={[styles.photoTile, isSelected && styles.photoTileSelected]}
    >
      <Image source={{ uri: item.uri }} style={styles.photoImage} />

      {isUploaded && !isLongPressed && (
        <View style={styles.uploadedBadge}>
          <CheckIcon size={10} color={colors.textInverse} />
          <Text style={styles.uploadedBadgeText}>Đã lên Web</Text>
        </View>
      )}

      {!isLongPressed && (
        <View
          style={[
            styles.checkCircle,
            isSelected && styles.checkCircleSelected,
          ]}
        >
          {isSelected && <CheckIcon size={13} color={colors.textInverse} />}
        </View>
      )}

      {/* Long-Press Quick Action Overlay */}
      {isLongPressed && (
        <View style={styles.longPressOverlay}>
          <Pressable
            onPress={onCloseOverlay}
            style={styles.overlayCloseBtn}
            hitSlop={10}
            accessibilityLabel="Đóng menu thao tác nhanh"
          >
            <CloseIcon size={12} color={colors.textInverse} />
          </Pressable>

          <View style={styles.longPressButtonsRow}>
            <Pressable
              onPress={() => onDeleteSingle(item.id)}
              disabled={uploading || isDeletingPhotos}
              accessibilityLabel="Xoá ảnh này"
              style={({ pressed }) => [
                styles.iconCircleBtn,
                styles.iconCircleDelete,
                pressed && styles.primaryPressed,
              ]}
            >
              <TrashIcon size={17} color={colors.textInverse} />
              <Text style={styles.iconCircleLabel}>Xoá</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Pressable>
  );
};
