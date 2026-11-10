# ShotDropVN Mobile App (`mobile/`) — Agent Instructions

This is an Expo SDK 58 / React Native 0.88 mobile application written in **100% strict TypeScript**.

## 1. Strict TypeScript Policy (Mandatory)

- **All source files MUST use `.ts` or `.tsx`** (`index.ts`, `App.tsx`, `src/lib/supabase.ts`, etc.).
- **NEVER create `.js` or `.jsx` files** in this project. If a prompt mentions `App.js` or `src/lib/supabase.js`, always apply the changes to `App.tsx` and `src/lib/supabase.ts`.
- Always run `npx tsc --noEmit` to verify zero TypeScript errors after making edits.

## 2. Expo SDK 58 API Rules — Do Not Trust Old Training Data

Expo SDK 58 ships breaking changes in `expo-media-library` and `expo-file-system`:
- Calling `getAssetsAsync` or `getAssetInfoAsync` from `'expo-media-library'` **throws at runtime**. Either import from `'expo-media-library/legacy'` or use the new `Query` / `Asset` classes from `'expo-media-library'`.
- On Android 13+ / Expo Go, calling `MediaLibrary.requestPermissionsAsync()` or `getPermissionsAsync()` without arguments requests `AUDIO` permission and **throws at runtime**. Always pass `(false, ['photo'])` (`requestPermissionsAsync(false, ['photo'])` and `getPermissionsAsync(false, ['photo'])`).
- Calling `readAsStringAsync` from `'expo-file-system'` **throws at runtime**. Either import from `'expo-file-system/legacy'` or use the new `File` class (`new File(uri).arrayBuffer()`) from `'expo-file-system'`.

## 3. Commands

```bash
npx expo start              # start the dev server
npx tsc --noEmit            # typecheck (MUST pass with 0 errors)
```

## 4. Architecture & Workflow

- **Entry point**: `index.ts` -> `App.tsx`
- **Supabase client**: `src/lib/supabase.ts` (uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`)
- **Theme tokens**: `src/theme/tokens.ts` (Clean Daylight Minimal)
- **Photographer workflow**:
  1. Photos transfer via Wi-Fi from Canon 6D (Canon Camera Connect) into the phone's gallery.
  2. App loads the 20 most recent photos on mount and listens for new photos via `AppState` and `MediaLibrary` listeners.
  3. Supports both **Live Continuous Auto-Sync** (auto-uploading newly arrived photos to `activeSession`) and **Manual Selection & Sync** from the recent photos grid.
