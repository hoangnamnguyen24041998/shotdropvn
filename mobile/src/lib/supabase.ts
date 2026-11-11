import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const DEFAULT_SUPABASE_PROJECT_URL =
  'https://larjhgvrctokpwfhrlpc.supabase.co';

export const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_Xdor_OSHSSVTzoauwrzdyg_eEMr4QeN';

export const DEFAULT_SUPABASE_LEGACY_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcmpoZ3ZyY3Rva3B3ZmhybHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyNDU1OTAsImV4cCI6MjEwOTgyMTU5MH0.P5847kcjIwA_rUzVm_HqrbbjzFZ1Q5oKrHOFIMCzU1Q';

export const SUPABASE_PROJECT_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_PROJECT_URL;

const envAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

export function isValidAnonKey(key?: string): boolean {
  const k = (key ?? '').trim();
  return (
    Boolean(k) &&
    k.length > 20 &&
    !k.includes('PASTE_YOUR_ANON_KEY') &&
    !k.includes('placeholder')
  );
}

let runtimeAnonKey = isValidAnonKey(envAnonKey)
  ? envAnonKey
  : DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured =
  Boolean(SUPABASE_PROJECT_URL) &&
  !SUPABASE_PROJECT_URL.includes('your-project-id') &&
  isValidAnonKey(runtimeAnonKey);

let activeClient: SupabaseClient = createClient(
  SUPABASE_PROJECT_URL,
  runtimeAnonKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export function setRuntimeSupabaseAnonKey(newKey: string): void {
  const cleaned = newKey.trim();
  if (isValidAnonKey(cleaned)) {
    runtimeAnonKey = cleaned;
    activeClient = createClient(SUPABASE_PROJECT_URL, cleaned, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
}

export function getRuntimeSupabaseAnonKey(): string {
  return runtimeAnonKey;
}

export function isSupabaseReady(): boolean {
  return (
    Boolean(SUPABASE_PROJECT_URL) &&
    !SUPABASE_PROJECT_URL.includes('your-project-id') &&
    isValidAnonKey(runtimeAnonKey)
  );
}

export function getSupabaseClient(): SupabaseClient {
  return activeClient;
}

export const supabase = activeClient;

export const STORAGE_BUCKET = 'shotdrop_photos';

export const PRODUCTION_WEB_URL = 'https://web-six-alpha-35.vercel.app';

export function isUsablePublicWebOrigin(url?: string | null): boolean {
  const normalized = (url ?? '').trim().replace(/\/$/, '');
  if (
    !normalized.startsWith('http://') &&
    !normalized.startsWith('https://')
  ) {
    return false;
  }

  return (
    !normalized.includes('localhost') &&
    !normalized.includes('192.168.') &&
    !normalized.includes('127.0.0.1') &&
    !normalized.includes('.trycloudflare.com') &&
    !normalized.includes('shotdropvn-web.onrender.com') &&
    !normalized.includes('shotdropvn.onrender.com')
  );
}

function resolveDefaultWebOrigin(): string {
  const envUrl = process.env.EXPO_PUBLIC_WEB_URL?.trim();
  if (envUrl && isUsablePublicWebOrigin(envUrl)) {
    return envUrl.replace(/\/$/, '');
  }
  return PRODUCTION_WEB_URL;
}

export const GUEST_WEB_ORIGIN = resolveDefaultWebOrigin();

export function buildGuestUrl(
  qrCodeHash: string,
  customOrigin?: string
): string {
  const candidate = customOrigin?.trim();
  const origin = (
    candidate && isUsablePublicWebOrigin(candidate)
      ? candidate
      : GUEST_WEB_ORIGIN
  ).replace(/\/$/, '');
  return `${origin}/s/${qrCodeHash}`;
}
