import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { styles } from '../styles/appStyles';

interface SelectionFloatingBarProps {
  selectedCount: number;
  onExpand: () => void;
}

export const SelectionFloatingBar: React.FC<SelectionFloatingBarProps> = ({
  selectedCount,
  onExpand,
}) => {
  if (selectedCount === 0) return null;

  return (
    <View style={styles.minimizedSelectionBarWrap}>
      <Pressable
        onPress={onExpand}
        style={({ pressed }) => [
          styles.minimizedSelectionPill,
          pressed && styles.primaryPressed,
        ]}
      >
        <View style={styles.minimizedCountBadge}>
          <Text style={styles.minimizedCountText}>{selectedCount}</Text>
        </View>
        <Text style={styles.minimizedPillTitle} numberOfLines={1}>
          {`Đã chọn ${selectedCount} ảnh • Chạm để mở hộp thoại`}
        </Text>
        <View style={styles.minimizedOpenActionTag}>
          <Text style={styles.minimizedOpenActionText}>Mở</Text>
        </View>
      </Pressable>
    </View>
  );
};
