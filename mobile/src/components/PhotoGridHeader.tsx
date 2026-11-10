import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { CheckIcon } from './Icons';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';

interface PhotoGridHeaderProps {
  totalCount: number;
  uploadedCount: number;
  selectedCount: number;
  onSelectAllUploaded: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export const PhotoGridHeader: React.FC<PhotoGridHeaderProps> = ({
  totalCount,
  uploadedCount,
  selectedCount,
  onSelectAllUploaded,
  onSelectAll,
  onClearSelection,
}) => {
  return (
    <View style={styles.gridHeaderRow}>
      <View style={styles.gridTitleGroup}>
        <Text style={styles.gridHeaderTitle}>Ảnh trong phiên</Text>
        <View style={styles.gridCountPill}>
          <Text style={styles.gridCountPillText}>{totalCount}</Text>
        </View>
      </View>

      <View style={styles.gridHeaderActions}>
        {uploadedCount > 0 && (
          <Pressable
            onPress={onSelectAllUploaded}
            hitSlop={6}
            style={({ pressed }) => [
              styles.filterChip,
              pressed && styles.subtlePressed,
            ]}
          >
            <CheckIcon size={12} color={colors.liveDark} />
            <Text style={styles.filterChipText}>
              Đã đẩy ({uploadedCount})
            </Text>
          </Pressable>
        )}

        {totalCount > 0 && selectedCount < totalCount && (
          <Pressable
            onPress={onSelectAll}
            hitSlop={6}
            style={({ pressed }) => [
              styles.filterChip,
              pressed && styles.subtlePressed,
            ]}
          >
            <Text style={styles.filterChipText}>Chọn tất cả</Text>
          </Pressable>
        )}

        {selectedCount > 0 && (
          <Pressable
            onPress={onClearSelection}
            hitSlop={8}
            style={styles.clearSelectionBtn}
          >
            <Text style={styles.clearSelectionText}>Bỏ chọn</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};
