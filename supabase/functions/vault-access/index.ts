import { createHandler } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigins = (Deno.env.get("VAULT_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
if (!url || !anonKey || !serviceKey || !allowedOrigins.length)
  throw new Error("Vault gateway configuration is missing.");
Deno.serve(createHandler({ url, anonKey, serviceKey, allowedOrigins }));
