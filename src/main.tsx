import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { readPublicConfig } from "./shared/lib/config";
import { useThemeStore } from "./shared/stores/useThemeStore";

useThemeStore.getState().initTheme();
const root = createRoot(document.getElementById("root")!);
async function start() {
  try {
    readPublicConfig(import.meta.env);
    const { default: App } = await import("./App");
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (error) {
    root.render(
      <main className="mx-auto max-w-xl p-8" role="alert">
        <h1 className="text-xl font-semibold">
          INFINYX necesita configuración
        </h1>
        <p className="mt-3">
          {error instanceof Error
            ? error.message
            : "No se pudo iniciar la aplicación."}
        </p>
      </main>,
    );
  }
}
void start();
