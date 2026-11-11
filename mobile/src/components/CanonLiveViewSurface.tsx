import React from 'react';
import {
  Platform,
  UIManager,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
  requireNativeComponent,
} from 'react-native';

const VIEW_NAME = 'ShotDropCanonLiveView';

const isNativeViewAvailable =
  Platform.OS === 'android' && Boolean(UIManager.getViewManagerConfig?.(VIEW_NAME));

const NativeCanonLiveView = isNativeViewAvailable
  ? requireNativeComponent<ViewProps>(VIEW_NAME)
  : null;

interface CanonLiveViewSurfaceProps {
  style?: StyleProp<ViewStyle>;
}

export const CanonLiveViewSurface: React.FC<CanonLiveViewSurfaceProps> = ({
  style,
}) => {
  if (NativeCanonLiveView) {
    return <NativeCanonLiveView style={style} />;
  }
  return <View style={style} />;
};
