export function readPublicConfig(env: Record<string, string | undefined>) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error(
      "Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para iniciar INFINYX.",
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
  )
    throw new Error("Supabase debe usar HTTPS.");
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  )
    throw new Error("URL de Supabase inválida.");
  let role: unknown;
  try {
    role = JSON.parse(
      atob(key.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ).role;
  } catch {
    /* Publishable keys are not JWTs. */
  }
  if (key.startsWith("sb_secret_") || role === "service_role")
    throw new Error(
      "La clave de servidor no se puede usar en el navegador. Usa la clave pública de Supabase.",
    );
  return { url: parsed.origin, key };
}
