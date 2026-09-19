/**
 * useDownloadAuthStore.ts
 * ---------------------------------------------------------------------------
 * Custodia VOLÁTIL (sólo RAM) de la "Contraseña de Descarga".
 *
 * Invariantes de seguridad
 * ------------------------
 * - Este store NO usa el middleware `persist` de Zustand: no toca
 *   `localStorage`, `sessionStorage`, cookies ni IndexedDB.
 * - `downloadSessionPassword` vive únicamente en la memoria JS de esta
 *   pestaña: al recargar la página el módulo se re-evalúa y vuelve a `null`
 *   automáticamente; al cerrar sesión el dashboard la destruye con `clear()`.
 * - La contraseña en claro es una compuerta de autorización para descargas;
 *   el descifrado sigue usando la `vaultKey` AES-GCM de `useAuthStore`.
 * ---------------------------------------------------------------------------
 */

import { create } from 'zustand';

export interface DownloadAuthState {
  /**
   * Contraseña de descarga en claro, sólo en RAM.
   * `null` = sesión de descarga no autorizada (hay que abrir el modal).
   */
  downloadSessionPassword: string | null;
}

export interface DownloadAuthActions {
  /** Guarda la contraseña validada en memoria (tras crearla o verificarla). */
  setDownloadSessionPassword: (password: string) => void;
  /** Destruye la contraseña en RAM (p. ej. al cerrar sesión). */
  clearDownloadSessionPassword: () => void;
  /** `true` si ya hay una contraseña de descarga autorizada en esta pestaña. */
  hasDownloadSessionPassword: () => boolean;
  /** Vacía el store (alias de limpieza total). */
  reset: () => void;
}

export type DownloadAuthStore = DownloadAuthState & DownloadAuthActions;

const INITIAL_STATE: DownloadAuthState = {
  downloadSessionPassword: null,
};

export const useDownloadAuthStore = create<DownloadAuthStore>()((set, get) => ({
  ...INITIAL_STATE,

  setDownloadSessionPassword: (password) => {
    set({ downloadSessionPassword: password });
  },

  clearDownloadSessionPassword: () => {
    set({ downloadSessionPassword: null });
  },

  hasDownloadSessionPassword: () => get().downloadSessionPassword !== null,

  reset: () => {
    set({ ...INITIAL_STATE });
  },
}));

/** Selector: contraseña en RAM (re-render sólo cuando cambia). */
export const selectDownloadSessionPassword = (s: DownloadAuthStore): string | null =>
  s.downloadSessionPassword;
