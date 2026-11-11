import './src/lib/suppressWarnings';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  PanResponder,
  Text,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

// Modular Custom Hooks
import { useToast } from './src/hooks/useToast';
import { useActiveSession } from './src/hooks/useActiveSession';
import { useUsbCamera } from './src/hooks/useUsbCamera';
import { usePhotoSync } from './src/hooks/usePhotoSync';

// Modular UI Components
import { AppHeader } from './src/components/AppHeader';
import { QrStudioDeck } from './src/components/QrStudioDeck';
import { OtgTetherConsole } from './src/components/OtgTetherConsole';
import { PhotoTile } from './src/components/PhotoTile';
import { EmptyPhotoView } from './src/components/EmptyPhotoView';
import { SelectionFloatingBar } from './src/components/SelectionFloatingBar';
import { SelectionMenuModal } from './src/components/SelectionMenuModal';
import { DeletingSpinnerModal } from './src/components/DeletingSpinnerModal';
import { ToastBanner } from './src/components/ToastBanner';

// Styles
import { styles } from './src/styles/appStyles';

export const APP_VERSION = '1.2.6';
export const APP_BUILD = 9;

export default function App() {
  const { toast, showToast } = useToast();

  const [isSelectionMenuExpanded, setIsSelectionMenuExpanded] =
    useState<boolean>(false);

  // USB Camera Hook
  const {
    usbCameraStatus,
    setUsbCameraStatus,
    isOtgLiveEnabled,
    setIsOtgLiveEnabled,
    otgDirectoryUri,
    handleConnectUsbOtgCamera,
  } = useUsbCamera({
    onStatusMessage: (msg) => showToast('info', msg),
  });

  // Photo Synchronization Hook forward declarations
  const clearSessionPhotosRef = useRef<() => void>(() => {});

  // Active Session Hook
  const {
    activeSession,
    activeSessionRef,
    webOrigin,
    webOriginRef,
    isUrlModalVisible,
    setIsUrlModalVisible,
    draftWebOrigin,
    setDraftWebOrigin,
    supabaseReady,
    draftAnonKey,
    setDraftAnonKey,
    handleSaveWebOrigin,
    ensureActiveSession,
    handleEndSession,
  } = useActiveSession({
    onShowToast: showToast,
    onSessionEnded: () => {
      clearSessionPhotosRef.current();
    },
  });

  // Photo Sync Hook
  const {
    recentPhotos,
    selectedPhotoIds,
    uploadedPhotoIds,
    longPressedPhotoId,
    setLongPressedPhotoId,
    uploading,
    isDeletingPhotos,
    deletingCount,
    statusMessage,
    sessionPhotosCount,
    uploadPhotosBatch,
    executeDeletePhotos,
    handlePickFromCanonConnect,
    handlePullLatestFromOtgCard,
    toggleSelectPhoto,
    handleLongPressPhoto,
    handleSelectAll,
    handleSelectAllUploaded,
    clearSelection,
    clearSessionPhotos,
    isPhotoUploaded,
  } = usePhotoSync({
    activeSessionRef,
    webOriginRef,
    ensureActiveSession,
    onShowToast: showToast,
    onRequestConfigureSupabase: () => {
      setDraftWebOrigin(webOriginRef.current);
      setIsUrlModalVisible(true);
    },
    isOtgLiveEnabled,
    otgDirectoryUri,
    setUsbCameraStatus,
  });

  useEffect(() => {
    clearSessionPhotosRef.current = clearSessionPhotos;
  }, [clearSessionPhotos]);

  // Pulse animation for live sync indicator
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (activeSession || usbCameraStatus.connected) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.35,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [activeSession, pulseAnim, usbCameraStatus.connected]);

  // Floating Selection Popup / Modal animations
  const popupPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const popupOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const popupScaleAnim = useRef(new Animated.Value(0.92)).current;
  const isExpandedRef = useRef<boolean>(isSelectionMenuExpanded);

  useEffect(() => {
    isExpandedRef.current = isSelectionMenuExpanded;
  }, [isSelectionMenuExpanded]);

  const snapPopupTo = useCallback(
    (toX: number, toY: number) => {
      popupOffsetRef.current = { x: toX, y: toY };
      Animated.spring(popupPan, {
        toValue: { x: toX, y: toY },
        useNativeDriver: true,
        damping: 20,
        stiffness: 220,
        mass: 0.8,
      }).start();
    },
    [popupPan]
  );

  useEffect(() => {
    if (selectedPhotoIds.length > 0) {
      Animated.spring(popupScaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 18,
        stiffness: 240,
      }).start();
    } else {
      popupScaleAnim.setValue(0.92);
      popupOffsetRef.current = { x: 0, y: 0 };
      popupPan.setValue({ x: 0, y: 0 });
      setIsSelectionMenuExpanded(false);
    }
  }, [popupPan, popupScaleAnim, selectedPhotoIds.length]);

  const popupPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
      onPanResponderMove: (_, gesture) => {
        const nextX = Math.max(
          -28,
          Math.min(28, popupOffsetRef.current.x + gesture.dx * 0.45)
        );
        const nextY = Math.max(
          -340,
          Math.min(70, popupOffsetRef.current.y + gesture.dy)
        );
        popupPan.setValue({ x: nextX, y: nextY });
      },
      onPanResponderRelease: (_, gesture) => {
        const totalY = popupOffsetRef.current.y + gesture.dy;
        if (gesture.dy < -36 && !isExpandedRef.current) {
          setIsSelectionMenuExpanded(true);
          snapPopupTo(0, -12);
          return;
        }
        if (gesture.dy > 38 && isExpandedRef.current) {
          setIsSelectionMenuExpanded(false);
          snapPopupTo(0, 0);
          return;
        }
        const clampedY = Math.max(-280, Math.min(12, totalY));
        snapPopupTo(0, clampedY);
      },
    })
  ).current;

  const handleToggleSelectPhoto = (id: string) => {
    toggleSelectPhoto(id);
    if (!selectedPhotoIds.includes(id) && selectedPhotoIds.length === 0) {
      setIsSelectionMenuExpanded(true);
    }
  };

  const handleUploadSelected = async (forceNewSession = false) => {
    const selectedItems = recentPhotos.filter((a) =>
      selectedPhotoIds.includes(a.id)
    );
    if (selectedItems.length === 0) {
      await handlePickFromCanonConnect();
      return;
    }
    setIsSelectionMenuExpanded(false);
    await uploadPhotosBatch(selectedItems, { forceNewSession });
  };

  const handleDeleteSelected = () => {
    if (selectedPhotoIds.length === 0) return;
    setIsSelectionMenuExpanded(false);
    void executeDeletePhotos(selectedPhotoIds);
  };

  return (
    <View style={styles.safeArea}>
      <ExpoStatusBar style="dark" />

      {/* App Header (No STANDBY view, no sub description, no URL config button) */}
      <AppHeader
        appVersion={APP_VERSION}
        activeSession={activeSession}
        usbCameraStatus={usbCameraStatus}
      />

      <FlatList
        data={recentPhotos}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[
          styles.listContent,
          selectedPhotoIds.length > 0 && styles.listContentWithBottomBar,
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            {/* 1. Live QR Studio Deck */}
            <QrStudioDeck
              activeSession={activeSession}
              webOrigin={webOrigin}
              pulseAnim={pulseAnim}
              uploading={uploading}
              statusMessage={statusMessage}
              onPickPhotos={handlePickFromCanonConnect}
              onEndSession={handleEndSession}
            />

            {/* 2. USB OTG Tether Console (ONLY rendered when USB OTG is physically connected) */}
            <OtgTetherConsole
              usbCameraStatus={usbCameraStatus}
              isOtgLiveEnabled={isOtgLiveEnabled}
              uploading={uploading}
              statusMessage={statusMessage}
              onToggleOtgLive={() => setIsOtgLiveEnabled((prev) => !prev)}
              onConnectOtg={handleConnectUsbOtgCamera}
              onPullLatestPhotos={handlePullLatestFromOtgCard}
            />
          </View>
        }
        renderItem={({ item }) => (
          <PhotoTile
            item={item}
            isSelected={selectedPhotoIds.includes(item.id)}
            isUploaded={isPhotoUploaded(item)}
            isLongPressed={longPressedPhotoId === item.id}
            uploading={uploading}
            isDeletingPhotos={isDeletingPhotos}
            onPress={() => {
              if (longPressedPhotoId === item.id) {
                setLongPressedPhotoId(null);
                return;
              }
              handleToggleSelectPhoto(item.id);
            }}
            onLongPress={() => handleLongPressPhoto(item.id)}
            onCloseOverlay={() => setLongPressedPhotoId(null)}
            onUploadSingle={(singleItem) => {
              void uploadPhotosBatch([singleItem]);
            }}
            onDeleteSingle={(id) => {
              void executeDeletePhotos([id]);
            }}
          />
        )}
        ListEmptyComponent={<EmptyPhotoView />}
        ListFooterComponent={
          <View style={styles.versionFooterWrap}>
            <Text style={styles.versionFooterText}>
              ShotDropVN Studio • Version {APP_VERSION} (Build {APP_BUILD})
            </Text>
          </View>
        }
      />

      {/* Floating Pill Bar when selection modal is minimized */}
      <SelectionFloatingBar
        selectedCount={selectedPhotoIds.length}
        onExpand={() => {
          snapPopupTo(0, 0);
          setIsSelectionMenuExpanded(true);
        }}
      />

      {/* Centered Selection Menu Modal */}
      <SelectionMenuModal
        visible={selectedPhotoIds.length > 0 && isSelectionMenuExpanded}
        selectedPhotoIds={selectedPhotoIds}
        uploadedPhotoIds={uploadedPhotoIds}
        recentPhotos={recentPhotos}
        activeSession={activeSession}
        uploading={uploading}
        popupPan={popupPan}
        popupScaleAnim={popupScaleAnim}
        panHandlers={popupPanResponder.panHandlers}
        onClose={() => setIsSelectionMenuExpanded(false)}
        onToggleSelectPhoto={toggleSelectPhoto}
        onSelectAll={handleSelectAll}
        onSelectAllUploaded={handleSelectAllUploaded}
        onClearSelection={clearSelection}
        onUploadSelected={handleUploadSelected}
        onDeleteSelected={handleDeleteSelected}
      />

      {/* Deleting Spinner Modal */}
      <DeletingSpinnerModal
        visible={isDeletingPhotos}
        count={deletingCount}
      />

      {/* Floating Toast Banner */}
      <ToastBanner toast={toast} />
    </View>
  );
}
