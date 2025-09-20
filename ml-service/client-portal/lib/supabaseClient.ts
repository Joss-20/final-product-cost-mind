import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/** Create (once) and return the browser Supabase client. Call from the client only. */
export function getSupabase(): SupabaseClient {
  if (typeof window === 'undefined') {
    // Avoid server/build-time usage — page uses it inside useEffect in the browser.
    throw new Error('getSupabase() must be called in the browser');
  }
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
    _client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return _client;
}
