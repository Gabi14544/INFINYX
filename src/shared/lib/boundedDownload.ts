/** Limit while streaming, before allocating the complete ciphertext in memory. */
export async function readBoundedResponse(
  response: Response,
  maximum: number,
): Promise<ArrayBuffer> {
  if (!response.ok || !response.body)
    throw new Error("No se pudo descargar el archivo cifrado.");
  if (Number(response.headers.get("content-length")) > maximum)
    throw new Error("Archivo cifrado demasiado grande.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum)
        throw new Error("Archivo cifrado demasiado grande.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}
