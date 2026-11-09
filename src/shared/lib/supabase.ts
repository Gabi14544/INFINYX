import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";
import { readPublicConfig } from "./config";
const config = readPublicConfig(import.meta.env);
// Session tokens persist; document keys and authorization passwords never do.
export const supabase = createClient<Database>(config.url, config.key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
