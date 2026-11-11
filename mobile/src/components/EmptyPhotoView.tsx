import React from 'react';
import { Text, View } from 'react-native';
import { CameraApertureIcon } from './Icons';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';

export const EmptyPhotoView: React.FC = () => {
  return (
    <View style={styles.emptyBox}>
      <View style={styles.emptyIconCircle}>
        <CameraApertureIcon size={24} color={colors.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>
        Chưa có ảnh nào được upload
      </Text>
      <Text style={styles.emptySub}>
        Nhấn nút chọn ảnh / upload phía trên để đẩy ảnh lên mã QR.
      </Text>
    </View>
  );
};
