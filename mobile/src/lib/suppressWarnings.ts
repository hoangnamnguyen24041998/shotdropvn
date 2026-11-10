import { LogBox } from 'react-native';

const IGNORED_WARNINGS = [
  "Due to changes in Android's permission requirements, Expo Go can no longer provide full access to the media library",
  'SafeAreaView has been deprecated',
];

const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const firstArg = typeof args[0] === 'string' ? args[0] : '';
  if (IGNORED_WARNINGS.some((msg) => firstArg.includes(msg))) {
    return;
  }
  originalWarn(...args);
};

LogBox.ignoreLogs(IGNORED_WARNINGS);
