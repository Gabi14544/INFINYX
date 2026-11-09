/** Authenticated gateway. Service credentials never reach the browser. */
export interface GatewayConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
  allowedOrigins: string[];
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITERATIONS = 600_000;
export async function verifier(
  password: string,
  salt: string,
): Promise<string> {
  const bytes = Uint8Array.from(salt.match(/../g)!, (b) => parseInt(b, 16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const result = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bytes, iterations: ITERATIONS },
    key,
    256,
  );
  return Array.from(new Uint8Array(result), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createHandler(
  config: GatewayConfig,
  request: typeof fetch = fetch,
) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (origin && config.allowedOrigins.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] =
        "authorization, apikey, content-type, x-client-info";
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    try {
      if (origin && !config.allowedOrigins.includes(origin))
        throw new HttpError(403, "Origen no autorizado.");
      if (req.method === "OPTIONS")
        return new Response(null, { status: 204, headers });
      if (req.method !== "POST")
        throw new HttpError(405, "Método no permitido.");
      const authorization = req.headers.get("authorization");
      if (!authorization?.startsWith("Bearer "))
        throw new HttpError(401, "Sesión requerida.");
      const auth = await request(`${config.url}/auth/v1/user`, {
        headers: { authorization, apikey: config.anonKey },
      });
      if (!auth.ok) throw new HttpError(401, "Sesión inválida o expirada.");
      const user: unknown = await auth.json();
      if (
        !user ||
        typeof user !== "object" ||
        !("id" in user) ||
        typeof user.id !== "string" ||
        !UUID.test(user.id)
      )
        throw new HttpError(401, "Sesión inválida.");
      const userId = user.id;
      // Bound the streamed request as well as Content-Length; do not trust client headers.
      const reader = req.body?.getReader();
      if (!reader) throw new HttpError(400, "Solicitud vacía.");
      let size = 0;
      let text = "";
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          throw new HttpError(413, "Solicitud demasiado grande.");
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error();
        body = parsed as Record<string, unknown>;
      } catch {
        throw new HttpError(400, "Solicitud inválida.");
      }
      const action = body.action;
      if (
        ![
          "status",
          "setup",
          "verify",
          "download",
          "delete",
          "delete-batch",
        ].includes(String(action))
      )
        throw new HttpError(400, "Acción inválida.");
      async function api<T>(
        path: string,
        method = "GET",
        payload?: unknown,
        prefer?: string,
      ): Promise<T> {
        const response = await request(`${config.url}${path}`, {
          method,
          headers: {
            apikey: config.serviceKey,
            authorization: `Bearer ${config.serviceKey}`,
            "Content-Type": "application/json",
            ...(prefer ? { Prefer: prefer } : {}),
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        if (!response.ok)
          throw new HttpError(
            503,
            "El backend no pudo completar la operación. Puedes reintentar.",
          );
        const result = await response.text();
        return (result ? JSON.parse(result) : null) as T;
      }
      const allowed = await api<boolean>(
        "/rest/v1/rpc/reserve_vault_attempt",
        "POST",
        { p_user_id: userId },
      );
      if (allowed !== true)
        throw new HttpError(429, "Demasiados intentos. Espera un minuto.");
      const credentials = await api<Array<{ salt: string; verifier: string }>>(
        `/rest/v1/vault_credentials?user_id=eq.${userId}&select=salt,verifier`,
      );
      const stored = credentials[0];
      if (action === "status") return reply({ configured: !!stored });
      const password = body.password;
      if (
        typeof password !== "string" ||
        password.length < 1 ||
        password.length > 1024
      )
        throw new HttpError(400, "Contraseña inválida.");
      if (action === "setup") {
        if (stored)
          throw new HttpError(
            409,
            "La contraseña de autorización ya está configurada.",
          );
        if (password.length < 15)
          throw new HttpError(400, "Usa al menos 15 caracteres.");
        const salt = Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        const hash = await verifier(password, salt);
        // INSERT only: a concurrent setup cannot overwrite the winner.
        await api("/rest/v1/vault_credentials", "POST", {
          user_id: userId,
          salt,
          verifier: hash,
        });
        return reply({ ok: true });
      }
      if (
        !stored ||
        !equal(await verifier(password, stored.salt), stored.verifier)
      )
        throw new HttpError(403, "Contraseña de autorización incorrecta.");
      if (action === "verify") return reply({ ok: true });
      if (action === "download") {
        if (typeof body.versionId !== "string" || !UUID.test(body.versionId))
          throw new HttpError(400, "Versión inválida.");
        const versions = await api<
          Array<{ document_id: string; storage_path: string }>
        >(
          `/rest/v1/document_versions?id=eq.${body.versionId}&select=document_id,storage_path`,
        );
        const version = versions[0];
        if (!version) throw new HttpError(404, "Documento no disponible.");
        const documents = await api<Array<{ id: string }>>(
          `/rest/v1/documents?id=eq.${version.document_id}&user_id=eq.${userId}&deleting=eq.false&select=id`,
        );
        if (
          !documents.length ||
          !version.storage_path.startsWith(`${userId}/${version.document_id}/`)
        )
          throw new HttpError(404, "Documento no disponible.");
        const result = await api<{ signedURL: string }>(
          `/storage/v1/object/sign/vault_files/${version.storage_path}`,
          "POST",
          { expiresIn: 30 },
        );
        // Record permission granted, not an unverifiable claim that client decryption occurred.
        await api("/rest/v1/audit_logs", "POST", {
          user_id: userId,
          document_id: version.document_id,
          action: "DOWNLOAD_AUTHORIZED",
          details: { version_id: body.versionId },
        });
        const url = new URL(
          result.signedURL.startsWith("/object/")
            ? `/storage/v1${result.signedURL}`
            : result.signedURL,
          config.url,
        );
        if (
          url.origin !== new URL(config.url).origin ||
          !url.pathname.startsWith("/storage/v1/object/sign/")
        )
          throw new HttpError(503, "URL de descarga inválida.");
        return reply({ url: url.href });
      }
      const ids: unknown =
        action === "delete-batch" ? body.documentIds : [body.documentId];
      if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 50 ||
        ids.some((id) => typeof id !== "string" || !UUID.test(id)) ||
        new Set(ids).size !== ids.length
      ) {
        throw new HttpError(400, "Lista de documentos inválida (máximo 50).");
      }
      const documentIds = ids as string[];
      // Validate ownership of the ENTIRE request before changing anything.
      const documents = await api<Array<{ id: string }>>(
        documentIds.length === 1
          ? `/rest/v1/documents?id=eq.${documentIds[0]}&user_id=eq.${userId}&select=id`
          : `/rest/v1/documents?id=in.(${documentIds.join(",")})&user_id=eq.${userId}&select=id`,
      );
      if (
        documents.length !== documentIds.length ||
        documents.some((doc) => !documentIds.includes(doc.id))
      )
        throw new HttpError(404, "Documento no disponible.");
      const deleteOne = async (documentId: string): Promise<void> => {
        await api("/rest/v1/rpc/begin_vault_delete", "POST", {
          p_user_id: userId,
          p_document_id: documentId,
        });
        const versions = await api<Array<{ storage_path: string }>>(
          `/rest/v1/document_versions?document_id=eq.${documentId}&select=storage_path`,
        );
        const paths = versions.map((v) => v.storage_path);
        if (paths.some((path) => !path.startsWith(`${userId}/${documentId}/`)))
          throw new HttpError(503, "Rutas de almacenamiento inválidas.");
        if (paths.length)
          await api("/storage/v1/object/vault_files", "DELETE", {
            prefixes: paths,
          });
        // A failed Storage deletion never removes metadata or records successful deletion.
        await api("/rest/v1/rpc/finish_vault_delete", "POST", {
          p_user_id: userId,
          p_document_id: documentId,
        });
      };
      if (action === "delete") {
        await deleteOne(documentIds[0]!);
        return reply({ ok: true });
      }
      const deletedIds: string[] = [];
      const failedIds: string[] = [];
      for (const id of documentIds) {
        try {
          await deleteOne(id);
          deletedIds.push(id);
        } catch {
          failedIds.push(id);
        }
      }
      return reply({ ok: true, deletedIds, failedIds });
    } catch (error) {
      if (error instanceof HttpError)
        return reply({ error: error.message }, error.status);
      return reply({ error: "No se pudo completar la operación." }, 503);
    }
  };
}
