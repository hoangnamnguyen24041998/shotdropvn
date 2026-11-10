import React from 'react';
import { Text, View } from 'react-native';
import { CheckIcon, CloseIcon, SparklesIcon } from './Icons';
import { styles } from '../styles/appStyles';
import type { ToastMessage } from '../types';

interface ToastBannerProps {
  toast: ToastMessage | null;
}

export const ToastBanner: React.FC<ToastBannerProps> = ({ toast }) => {
  if (!toast) return null;

  return (
    <View
      style={[
        styles.toastContainer,
        toast.type === 'success' && styles.toastSuccess,
        toast.type === 'error' && styles.toastError,
        toast.type === 'info' && styles.toastInfo,
      ]}
    >
      <View style={styles.toastIconBox}>
        {toast.type === 'success' ? (
          <CheckIcon size={15} color="#FFFFFF" />
        ) : toast.type === 'error' ? (
          <CloseIcon size={15} color="#FFFFFF" />
        ) : (
          <SparklesIcon size={15} color="#FFFFFF" />
        )}
      </View>
      <Text style={styles.toastMessageText} numberOfLines={2}>
        {toast.message}
      </Text>
    </View>
  );
};
