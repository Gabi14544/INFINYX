import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";
import {
  deriveAuthPassword,
  deriveKey,
  hexToBuffer,
} from "../../../core/crypto/vaultCrypto";
import { clearSensitiveState } from "../../../shared/lib/sensitiveState";
import { supabase } from "../../../shared/lib/supabase";

interface AuthState {
  user: User | null;
  session: Session | null;
  vaultKey: CryptoKey | null;
  isAwaitingOtp: boolean;
  otpEmail: string | null;
  tempRegistrationPassword: string | null;
  registrationExpiresAt: number | null;
  authSuccessMessage: string | null;
  isLoading: boolean;
  error: string | null;
}
interface AuthActions {
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  verifySignUpOtp: (token: string) => Promise<boolean>;
  resendSignUpOtp: () => Promise<boolean>;
  cancelOtpFlow: () => void;
  signOut: () => Promise<void>;
  initSession: () => () => void;
  clearAuthSuccessMessage: () => void;
  clearError: () => void;
  lockVaultInMemory: (reason?: string) => void;
}
export type AuthStore = AuthState & AuthActions;
const initial: AuthState = {
  user: null,
  session: null,
  vaultKey: null,
  isAwaitingOtp: false,
  otpEmail: null,
  tempRegistrationPassword: null,
  registrationExpiresAt: null,
  authSuccessMessage: null,
  isLoading: false,
  error: null,
};
let operation = 0;
let subscription: { unsubscribe: () => void } | null = null;
let registrationTimer: ReturnType<typeof setTimeout> | undefined;
function clearRegistrationTimer() {
  clearTimeout(registrationTimer);
  registrationTimer = undefined;
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "No se pudo completar la autenticación.";
}
async function deriveVaultKey(
  userId: string,
  password: string,
): Promise<CryptoKey> {
  const { data, error } = await supabase
    .from("profiles")
    .select("vault_salt")
    .eq("id", userId)
    .single();
  if (error || !data)
    throw new Error(
      "No se pudo cargar la configuración de cifrado. Comprueba las migraciones del backend.",
    );
  return deriveKey(password, new Uint8Array(hexToBuffer(data.vault_salt)));
}
export const useAuthStore = create<AuthStore>()((set, get) => ({
  ...initial,
  signUp: async (email, password) => {
    const current = ++operation;
    clearSensitiveState();
    clearRegistrationTimer();
    set({ ...initial, isLoading: true });
    try {
      if (password.length < 15 || password.length > 1024)
        throw new Error("Usa una contraseña de entre 15 y 1024 caracteres.");
      const authPassword = await deriveAuthPassword(email, password);
      if (current !== operation) return;
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: authPassword,
      });
      if (current !== operation) return;
      if (error) throw error;
      if (!data.user) throw new Error("No se pudo crear la cuenta.");
      if (!data.session) {
        set({
          isAwaitingOtp: true,
          otpEmail: email.trim().toLowerCase(),
          tempRegistrationPassword: password,
          registrationExpiresAt: Date.now() + 600_000,
          isLoading: false,
        });
        registrationTimer = setTimeout(
          () =>
            set({
              tempRegistrationPassword: null,
              registrationExpiresAt: null,
            }),
          600_000,
        );
        return;
      }
      const vaultKey = await deriveVaultKey(data.user.id, password);
      if (current === operation)
        set({ ...initial, user: data.user, session: data.session, vaultKey });
    } catch (cause) {
      if (current === operation)
        set({ ...initial, error: errorMessage(cause) });
    }
  },
  signIn: async (email, password) => {
    const current = ++operation;
    clearSensitiveState();
    clearRegistrationTimer();
    set({ ...initial, isLoading: true });
    try {
      if (!password || password.length > 1024)
        throw new Error("Contraseña inválida.");
      const authPassword = await deriveAuthPassword(email, password);
      if (current !== operation) return;
      // Never retry with the original passphrase, including on transient Auth failures.
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: authPassword,
      });
      if (current !== operation) return;
      if (error) throw error;
      if (!data.user || !data.session)
        throw new Error("No se recibió una sesión válida.");
      const vaultKey = await deriveVaultKey(data.user.id, password);
      if (current === operation)
        set({ ...initial, user: data.user, session: data.session, vaultKey });
    } catch (cause) {
      if (current === operation)
        set({ ...initial, error: errorMessage(cause) });
    }
  },
  verifySignUpOtp: async (token) => {
    const { otpEmail, tempRegistrationPassword, registrationExpiresAt } = get();
    if (!otpEmail || !/^\d{6,8}$/.test(token.trim())) {
      set({ error: "Introduce el código de confirmación recibido por email." });
      return false;
    }
    const current = ++operation;
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: otpEmail,
        token: token.trim(),
        type: "signup",
      });
      if (current !== operation) return false;
      if (error || !data.user || !data.session)
        throw new Error("Código inválido o expirado.");
      const vaultKey =
        tempRegistrationPassword &&
        registrationExpiresAt &&
        registrationExpiresAt > Date.now()
          ? await deriveVaultKey(data.user.id, tempRegistrationPassword)
          : null;
      if (current !== operation) return false;
      clearRegistrationTimer();
      set({
        ...initial,
        user: data.user,
        session: data.session,
        vaultKey,
        authSuccessMessage: vaultKey
          ? null
          : "Cuenta confirmada. Introduce tu contraseña para abrir la bóveda.",
      });
      return true;
    } catch (cause) {
      if (current === operation)
        set({ isLoading: false, error: errorMessage(cause) });
      return false;
    }
  },
  resendSignUpOtp: async () => {
    const email = get().otpEmail;
    if (!email) return false;
    const current = operation;
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      return current === operation;
    } catch (cause) {
      if (current === operation) set({ error: errorMessage(cause) });
      return false;
    }
  },
  cancelOtpFlow: () => {
    ++operation;
    clearRegistrationTimer();
    set({ ...initial });
  },
  signOut: async () => {
    const current = ++operation;
    clearSensitiveState();
    clearRegistrationTimer();
    set({ ...initial, isLoading: true });
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      if (current === operation) set({ ...initial });
    } catch {
      if (current === operation)
        set({
          ...initial,
          error:
            "La bóveda se bloqueó, pero no se pudo revocar la sesión remota. Reintenta el cierre de sesión.",
        });
    }
  },
  initSession: () => {
    subscription?.unsubscribe();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const previous = get().user?.id;
      if (
        event === "SIGNED_OUT" ||
        (previous && previous !== session?.user.id)
      ) {
        ++operation;
        clearSensitiveState();
        clearRegistrationTimer();
        set({ ...initial, session, user: session?.user ?? null });
        return;
      }
      // INITIAL_SESSION, refresh and OTP login preserve only the SAME user's in-memory key.
      set({ session, user: session?.user ?? null });
    });
    const current = data.subscription;
    subscription = current;
    return () => {
      current.unsubscribe();
      if (subscription === current) subscription = null;
    };
  },
  clearAuthSuccessMessage: () => set({ authSuccessMessage: null }),
  clearError: () => set({ error: null }),
  lockVaultInMemory: (reason) => {
    ++operation;
    clearSensitiveState();
    clearRegistrationTimer();
    set({
      vaultKey: null,
      tempRegistrationPassword: null,
      registrationExpiresAt: null,
      isLoading: false,
      error: null,
      authSuccessMessage:
        reason ??
        "La bóveda se bloqueó por inactividad. Introduce tu contraseña para continuar.",
    });
  },
}));
