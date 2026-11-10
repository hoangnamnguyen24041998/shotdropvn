import React from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';

interface DeletingSpinnerModalProps {
  visible: boolean;
  count: number;
}

export const DeletingSpinnerModal: React.FC<DeletingSpinnerModalProps> = ({
  visible,
  count,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.deletingModalOverlay}>
        <View style={styles.deletingModalCard}>
          <ActivityIndicator size="large" color={colors.live} />
          <Text style={styles.deletingModalTitle}>
            {`Đang xoá ${count > 1 ? `${count} ảnh...` : 'ảnh...'}`}
          </Text>
          <Text style={styles.deletingModalSubtitle}>
            Đang đồng bộ dữ liệu với hệ thống
          </Text>
        </View>
      </View>
    </Modal>
  );
};
