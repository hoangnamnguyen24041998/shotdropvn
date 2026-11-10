import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_PROJECT_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
  'https://larjhgvrctokpwfhrlpc.supabase.co';

const envAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

let runtimeAnonKey = envAnonKey;

export function isValidAnonKey(key?: string): boolean {
  const k = (key ?? runtimeAnonKey).trim();
  return (
    Boolean(k) &&
    k.length > 20 &&
    !k.includes('PASTE_YOUR_ANON_KEY') &&
    !k.includes('placeholder')
  );
}

export const isSupabaseConfigured =
  Boolean(SUPABASE_PROJECT_URL) &&
  !SUPABASE_PROJECT_URL.includes('your-project-id') &&
  isValidAnonKey(envAnonKey);

let activeClient: SupabaseClient = createClient(
  SUPABASE_PROJECT_URL,
  isValidAnonKey(runtimeAnonKey) ? runtimeAnonKey : 'placeholder-anon-key',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export function setRuntimeSupabaseAnonKey(newKey: string): void {
  const cleaned = newKey.trim();
  runtimeAnonKey = cleaned;
  if (isValidAnonKey(cleaned)) {
    activeClient = createClient(SUPABASE_PROJECT_URL, cleaned, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
}

export function getRuntimeSupabaseAnonKey(): string {
  return isValidAnonKey(runtimeAnonKey) ? runtimeAnonKey : '';
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

export const RENDER_WEB_URL = 'https://shotdropvn-web.onrender.com';

export const PUBLIC_CLOUDFLARE_WEB_URL =
  'https://supreme-cape-representations-automation.trycloudflare.com';

function resolveDefaultWebOrigin(): string {
  const envUrl = process.env.EXPO_PUBLIC_WEB_URL?.trim();
  if (
    envUrl &&
    !envUrl.includes('localhost') &&
    !envUrl.includes('192.168.') &&
    !envUrl.includes('127.0.0.1')
  ) {
    return envUrl.replace(/\/$/, '');
  }
  return PUBLIC_CLOUDFLARE_WEB_URL;
}

export const GUEST_WEB_ORIGIN = resolveDefaultWebOrigin();

export function buildGuestUrl(
  qrCodeHash: string,
  customOrigin?: string
): string {
  const origin = (customOrigin || GUEST_WEB_ORIGIN).replace(/\/$/, '');
  return `${origin}/s/${qrCodeHash}`;
}
