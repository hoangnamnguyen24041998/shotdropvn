import React from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { CloseIcon } from './Icons';
import { styles } from '../styles/appStyles';
import { colors } from '../theme/tokens';
import {
  PRODUCTION_WEB_URL,
  SUPABASE_PROJECT_URL,
} from '../lib/supabase';

interface UrlConfigModalProps {
  visible: boolean;
  draftWebOrigin: string;
  draftAnonKey: string;
  supabaseReady: boolean;
  onChangeDraftWebOrigin: (url: string) => void;
  onChangeDraftAnonKey: (key: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export const UrlConfigModal: React.FC<UrlConfigModalProps> = ({
  visible,
  draftWebOrigin,
  draftAnonKey,
  supabaseReady,
  onChangeDraftWebOrigin,
  onChangeDraftAnonKey,
  onSave,
  onClose,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} style={styles.urlModalOverlay}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={styles.urlModalCard}
        >
          <View style={styles.urlModalHeader}>
            <Text style={styles.urlModalTitle}>Cấu hình URL Web Public</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.quickClearCircleBtn}
            >
              <CloseIcon size={13} color={colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={styles.urlModalDesc}>
            Mã QR và đồng bộ ảnh sẽ sử dụng trực tiếp địa chỉ HTTPS bên dưới
            (hoạt động trên mọi mạng 4G/5G/Wi-Fi, không phụ thuộc IP localhost):
          </Text>

          <TextInput
            value={draftWebOrigin}
            onChangeText={onChangeDraftWebOrigin}
            placeholder="https://..."
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.urlModalInput}
          />

          <View style={styles.urlModalPresetRow}>
            <Pressable
              onPress={() => onChangeDraftWebOrigin(PRODUCTION_WEB_URL)}
              style={styles.expandedChipBtn}
            >
              <Text style={styles.expandedChipBtnText}>
                Production Web (web-six-alpha-35.vercel.app)
              </Text>
            </Pressable>
          </View>

          {/* Supabase Storage Anon Key */}
          <View style={styles.supabaseKeyHeaderRow}>
            <Text style={styles.urlModalTitle}>Supabase Storage</Text>
            <View
              style={[
                styles.supabaseStatusPill,
                supabaseReady
                  ? styles.supabaseStatusPillOk
                  : styles.supabaseStatusPillMissing,
              ]}
            >
              <Text
                style={[
                  styles.supabaseStatusPillText,
                  supabaseReady
                    ? styles.supabaseStatusTextOk
                    : styles.supabaseStatusTextMissing,
                ]}
              >
                {supabaseReady ? 'Đã kết nối' : 'Thiếu Anon Key'}
              </Text>
            </View>
          </View>
          <Text style={styles.urlModalDesc} numberOfLines={1}>
            {SUPABASE_PROJECT_URL.replace(/^https?:\/\//, '')}
          </Text>
          <TextInput
            value={draftAnonKey}
            onChangeText={onChangeDraftAnonKey}
            placeholder="Dán anon public key (eyJ...) hoặc sb_publishable_..."
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={false}
            multiline
            numberOfLines={3}
            style={[styles.urlModalInput, styles.supabaseKeyInput]}
          />

          <View style={styles.urlModalActionsRow}>
            <Pressable
              onPress={onClose}
              style={[styles.otgSecondaryBtn, { flex: 1 }]}
            >
              <Text style={styles.otgSecondaryBtnText}>Huỷ</Text>
            </Pressable>

            <Pressable
              onPress={onSave}
              style={[styles.otgPrimaryBtn, { flex: 1.4 }]}
            >
              <Text style={styles.otgPrimaryBtnText}>Lưu URL Web</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
