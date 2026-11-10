import { createClient } from '@supabase/supabase-js';

export const DEFAULT_SUPABASE_URL = 'https://larjhgvrctokpwfhrlpc.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY =
  'sb_publishable_Xdor_OSHSSVTzoauwrzdyg_eEMr4QeN';

const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const envAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

const supabaseUrl =
  envUrl && !envUrl.includes('placeholder')
    ? envUrl
    : DEFAULT_SUPABASE_URL;

const supabaseAnonKey =
  envAnonKey &&
  !envAnonKey.includes('PASTE_YOUR_ANON_KEY') &&
  !envAnonKey.includes('placeholder')
    ? envAnonKey
    : DEFAULT_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
