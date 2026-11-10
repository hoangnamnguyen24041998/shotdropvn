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
        Đang chờ ảnh mới từ cáp USB OTG hoặc thư viện
      </Text>
      <Text style={styles.emptySub}>
        Cắm cáp USB OTG từ máy ảnh vào điện thoại và bấm chụp để ảnh tự động đẩy
        lên Web, hoặc nhấn nút chọn ảnh phía trên.
      </Text>
    </View>
  );
};
