/** Optional non-deploying transport: runs the product handler locally against real Auth/DB/Storage. */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
export async function localGateway(config) {
  if (process.env.INFINYX_TEST_LOCAL_GATEWAY !== "1") return null;
  const ts = require("typescript");
  const source = await readFile(
    new URL(
      "../../supabase/functions/vault-access/handler.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
    },
  });
  const { createHandler } = await import(
    "data:text/javascript;base64," + Buffer.from(outputText).toString("base64")
  );
  console.log(
    "TEST_TRANSPORT=LOCAL_HANDLER_REAL_SUPABASE (no Edge deployment)",
  );
  return createHandler({
    url: config.url,
    anonKey: config.anon,
    serviceKey: config.service,
    allowedOrigins: [
      "http://127.0.0.1:5173",
      new URL(process.env.INFINYX_TEST_APP_URL ?? "http://127.0.0.1:5182")
        .origin,
    ],
  });
}
