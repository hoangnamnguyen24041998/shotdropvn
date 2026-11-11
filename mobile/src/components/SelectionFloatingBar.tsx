import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { CheckIcon, CloseIcon } from './Icons';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';

interface SelectionFloatingBarProps {
  visible: boolean;
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onExpand: () => void;
}

export const SelectionFloatingBar: React.FC<SelectionFloatingBarProps> = ({
  visible,
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onExpand,
}) => {
  if (!visible || selectedCount === 0) return null;

  const isAllSelected = totalCount > 0 && selectedCount >= totalCount;

  return (
    <View style={styles.minimizedSelectionBarWrap}>
      <View style={styles.minimizedSelectionPill}>
        {/* Top Row: Count summary + Bỏ chọn (X) */}
        <View style={styles.minimizedTopRow}>
          <View style={styles.minimizedInfoGroup}>
            <View style={styles.minimizedCountBadge}>
              <Text style={styles.minimizedCountText}>{selectedCount}</Text>
            </View>
            <Text style={styles.minimizedPillTitle} numberOfLines={1}>
              {`Đã chọn ${selectedCount} ảnh`}
            </Text>
          </View>

          <Pressable
            onPress={onClearSelection}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Bỏ chọn ${selectedCount} ảnh`}
            style={({ pressed }) => [
              styles.minimizedClearBtn,
              pressed && styles.primaryPressed,
            ]}
          >
            <CloseIcon size={11} color="#FCA5A5" />
            <Text style={styles.minimizedClearText}>
              {`Bỏ chọn (${selectedCount})`}
            </Text>
          </Pressable>
        </View>

        {/* Bottom Row: Chọn tất cả + Mở */}
        <View style={styles.minimizedActionsRow}>
          <Pressable
            onPress={isAllSelected ? undefined : onSelectAll}
            disabled={isAllSelected}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={
              isAllSelected
                ? `Đã chọn tất cả ${totalCount} ảnh`
                : `Chọn tất cả ${totalCount} ảnh`
            }
            style={({ pressed }) => [
              styles.minimizedSelectAllBtn,
              isAllSelected && styles.minimizedSelectAllActiveBtn,
              pressed && !isAllSelected && styles.primaryPressed,
            ]}
          >
            <CheckIcon
              size={12}
              color={isAllSelected ? '#86EFAC' : colors.textInverse}
            />
            <Text
              style={[
                styles.minimizedSelectAllText,
                isAllSelected && styles.minimizedSelectAllActiveText,
              ]}
              numberOfLines={1}
            >
              {isAllSelected
                ? `Đã chọn tất cả (${totalCount})`
                : `Chọn tất cả (${totalCount})`}
            </Text>
          </Pressable>

          <Pressable
            onPress={onExpand}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Mở danh sách ${selectedCount} ảnh đã chọn`}
            style={({ pressed }) => [
              styles.minimizedOpenActionTag,
              pressed && styles.primaryPressed,
            ]}
          >
            <Text style={styles.minimizedOpenActionText} numberOfLines={1}>
              Mở
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};
