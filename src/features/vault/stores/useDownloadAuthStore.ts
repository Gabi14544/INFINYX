import { create } from "zustand";
import { registerSensitiveCleanup } from "../../../shared/lib/sensitiveState";

export interface DownloadAuthState {
  /**
   * Contraseña de descarga en claro, sólo en RAM.
   * `null` = sesión de descarga no autorizada (hay que abrir el modal).
   */
  downloadSessionPassword: string | null;
}

export interface DownloadAuthActions {
  setDownloadSessionPassword: (password: string) => void;
  reset: () => void;
}

export type DownloadAuthStore = DownloadAuthState & DownloadAuthActions;

const INITIAL_STATE: DownloadAuthState = {
  downloadSessionPassword: null,
};

export const useDownloadAuthStore = create<DownloadAuthStore>()((set) => ({
  ...INITIAL_STATE,

  setDownloadSessionPassword: (password) => {
    set({ downloadSessionPassword: password });
  },

  reset: () => {
    set({ ...INITIAL_STATE });
  },
}));

registerSensitiveCleanup(() => useDownloadAuthStore.getState().reset());
