import { supabase } from "./supabase";

export async function vaultAccess<T>(
  action: string,
  password?: string,
  extra: Record<string, string | string[]> = {},
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const statusError =
    "No se pudo consultar si existe una contraseña de descarga y eliminación. El servicio de autorización no está disponible desde esta dirección. Revisa la conexión o utiliza la dirección principal del sitio y reintenta.";
  const result = await (async () => {
    try {
      const request = supabase.functions.invoke("vault-access", {
        body: { action, password, ...extra },
        signal: controller.signal,
      });
      // Bound only the read-only status query; a slow mutation may still commit.
      if (action !== "status") return await request;
      return await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(statusError));
            controller.abort();
          }, 12_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  })();
  const { data, error } = result;
  if (error) {
    let message =
      action === "status"
        ? statusError
        : "No se pudo conectar con el servicio de autorización. Comprueba tu conexión y la dirección del sitio.";
    if ("context" in error && error.context instanceof Response) {
      try {
        const body: unknown = await error.context.json();
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
        )
          message = body.error;
      } catch {
        /* generic message */
      }
    }
    throw new Error(message);
  }
  if (
    !data ||
    typeof data !== "object" ||
    (action === "status"
      ? typeof data.configured !== "boolean"
      : action === "download"
        ? typeof data.url !== "string"
        : data.ok !== true)
  ) {
    throw new Error("Respuesta de autorización inválida.");
  }
  if (
    action === "delete-batch" &&
    (!Array.isArray(data.deletedIds) ||
      !Array.isArray(data.failedIds) ||
      [...data.deletedIds, ...data.failedIds].some(
        (id) => typeof id !== "string",
      ))
  ) {
    throw new Error("Respuesta de borrado inválida.");
  }
  return data as T;
}
