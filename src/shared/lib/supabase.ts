import { createClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan las variables de entorno de Supabase en .env.local');
}

/**
 * Cliente Supabase tipado contra el esquema `public` (ver `shared/types/database.ts`).
 *
 * Nota Zero-Knowledge: `persistSession` mantiene en `localStorage` únicamente
 * los tokens de Supabase Auth. La `CryptoKey` de la bóveda NUNCA se persiste
 * aquí ni en ningún otro almacenamiento: vive exclusivamente en memoria
 * dentro de `useAuthStore` y se destruye al cerrar sesión o recargar.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
