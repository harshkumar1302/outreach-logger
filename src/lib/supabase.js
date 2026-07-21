import { createBrowserClient } from '@supabase/ssr';

const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

const isPlaceholder = (url.includes('your-project') || url.includes('gthxlmplroonyipoxllw') || key.includes('replace_me') || key.includes('LZIc35WX'));
export const supabaseConfigured = Boolean(url && key && !isPlaceholder);
export const supabase = supabaseConfigured ? createBrowserClient(url, key) : null;

