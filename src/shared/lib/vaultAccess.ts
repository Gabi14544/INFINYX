import { supabase } from "./supabase";

export async function vaultAccess<T>(
  action: string,
  password?: string,
  extra: Record<string, string | string[]> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("vault-access", {
    body: { action, password, ...extra },
  });
  if (error) {
    let message =
      "No se pudo autorizar la operación. Comprueba el backend y tu contraseña de descarga.";
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
