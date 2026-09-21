/**
 * useAuthStore.ts
 * ---------------------------------------------------------------------------
 * Store global de autenticación y custodia EN MEMORIA de la clave de bóveda.
 *
 * Modelo de seguridad (Zero-Knowledge estricto)
 * ---------------------------------------------
 * 1. La passphrase del usuario se usa para dos cosas independientes:
 *      a) autenticarse contra Supabase Auth (el servidor sólo ve su bcrypt);
 *      b) derivar localmente, vía PBKDF2-SHA256, la `CryptoKey` AES-GCM-256
 *         que cifra y descifra los documentos.
 *    El servidor NUNCA recibe la clave derivada ni texto plano.
 *
 * 2. `vaultKey` se mantiene EXCLUSIVAMENTE en RAM:
 *    - el store NO usa el middleware `persist` de Zustand;
 *    - la `CryptoKey` es `extractable: false` (ver `vaultCrypto.deriveKey`),
 *      por lo que ni siquiera podría serializarse a `localStorage`;
 *    - al recargar la página o cerrar sesión, la clave desaparece y el
 *      usuario debe volver a desbloquear la bóveda con su passphrase
 *      (`unlockVaultWithPassword`).
 *
 * 3. `recoveryPhrase` es material sensible de un solo uso: se genera en el
 *    registro para que el usuario la anote, vive en RAM y debe limpiarse con
 *    `clearRecoveryPhrase()` en cuanto la UI termine de mostrarla. No se
 *    persiste en base de datos (el esquema no tiene columna para ella, y por
 *    diseño Zero-Knowledge no debe tenerla).
 * ---------------------------------------------------------------------------
 */

import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { deriveKey, generateRecoveryPhrase } from '../../../core/crypto/vaultCrypto';
import { supabase } from '../../../shared/lib/supabase';

// ---------------------------------------------------------------------------
// Derivación del salt PBKDF2
// ---------------------------------------------------------------------------

/**
 * Etiqueta de dominio del salt. Versionada para permitir migraciones futuras
 * del esquema de derivación sin colisionar con claves ya existentes.
 */
const VAULT_SALT_DOMAIN = 'tech-value:vault:kdf:v1';

/**
 * Deriva de forma determinista el salt PBKDF2 de la bóveda a partir del UUID
 * inmutable del usuario: `SHA-256("tech-value:vault:kdf:v1:" + userId)`.
 *
 * ¿Por qué determinista y no aleatorio?
 * El esquema actual de `profiles` (id, email, created_at) no dispone de
 * columna donde persistir un salt aleatorio por bóveda, y el salt debe ser
 * reproducible en cada inicio de sesión y en cualquier dispositivo para poder
 * volver a derivar la misma `CryptoKey`.
 *
 * Propiedades que se conservan: el salt es único por usuario (evita
 * diccionarios/rainbow tables compartidos entre cuentas) y público (los salts
 * no son secretos por definición). Se pierde la aleatoriedad por bóveda.
 *
 * MEJORA RECOMENDADA: añadir `profiles.vault_salt text not null` y almacenar
 * ahí 32 bytes de `crypto.getRandomValues` generados en el registro; después
 * bastaría con sustituir el cuerpo de esta función por su lectura.
 */
export async function deriveVaultSalt(userId: string): Promise<Uint8Array<ArrayBuffer>> {
  if (userId.length === 0) {
    throw new Error('deriveVaultSalt: el identificador de usuario no puede estar vacío.');
  }

  const material = new TextEncoder().encode(`${VAULT_SALT_DOMAIN}:${userId}`);
  const digest = await window.crypto.subtle.digest('SHA-256', material);

  return new Uint8Array(digest);
}

/**
 * Deriva la clave de bóveda de un usuario concreto combinando su salt
 * determinista con la passphrase proporcionada.
 */
async function deriveVaultKey(userId: string, password: string): Promise<CryptoKey> {
  const salt = await deriveVaultSalt(userId);
  return deriveKey(password, salt);
}

// ---------------------------------------------------------------------------
// Normalización de errores
// ---------------------------------------------------------------------------

/**
 * Convierte cualquier valor capturado en un mensaje legible.
 *
 * Necesario porque `AuthError` y `PostgrestError` de Supabase no siempre son
 * instancias de `Error`, pero sí exponen una propiedad `message`.
 */
function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  if (typeof cause === 'string' && cause.length > 0) {
    return cause;
  }
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const { message } = cause;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Contrato del store
// ---------------------------------------------------------------------------

export interface AuthState {
  /** Usuario autenticado de Supabase Auth, o `null` si no hay sesión. */
  user: User | null;
  /** Sesión activa de Supabase (access/refresh token), o `null`. */
  session: Session | null;
  /**
   * Clave AES-GCM-256 de la bóveda, derivada por PBKDF2.
   * ESTRICTAMENTE EN RAM: nunca se persiste en localStorage/sessionStorage,
   * cookies ni IndexedDB.
   */
  vaultKey: CryptoKey | null;
  /** Frase mnemónica de 12 palabras generada en el registro (sólo en RAM). */
  recoveryPhrase: string | null;
  /**
   * Email con confirmación pendiente tras `signUp` sin sesión.
   * Mientras esté definido la UI debe mostrar el aviso de verificación
   * y NO redirigir al dashboard (`user`/`session` quedan en `null`).
   */
  pendingConfirmationEmail: string | null;
  /** Indica si se espera la verificación del código OTP de 6 dígitos. */
  isAwaitingOtp: boolean;
  /** Correo pendiente de verificación OTP. */
  otpEmail: string | null;
  /**
   * Contraseña en memoria RAM retenida temporalmente mientras se espera el código
   * OTP para derivar en local la `vaultKey` (Zero-Knowledge) tras la verificación.
   */
  tempRegistrationPassword: string | null;
  /**
   * Mensaje informativo de éxito en autenticación (p. ej. confirmación de cuenta
   * tras OTP cuando no se dispone de la contraseña en RAM para derivar la vaultKey).
   */
  authSuccessMessage: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface AuthActions {
  /**
   * Registra al usuario en Supabase Auth, deriva su `CryptoKey` inicial y
   * genera la frase de recuperación cuando hay sesión inmediata.
   *
   * NO escribe en `profiles`: esa fila la crea el trigger PostgreSQL
   * `on_auth_user_created` (SECURITY DEFINER) sobre `auth.users`.
   *
   * Si el proyecto exige confirmación por email, `signUp` no devuelve
   * sesión; en ese caso se activa el flujo OTP guardando temporalmente
   * las credenciales en RAM para verificar el código de 6 dígitos.
   */
  signUp: (email: string, password: string) => Promise<void>;
  /**
   * Verifica el código OTP de registro de 6 dígitos contra Supabase Auth.
   * Si es exitoso, deriva localmente la vaultKey con PBKDF2, limpia la contraseña
   * temporal de RAM y da acceso al Dashboard.
   */
  verifySignUpOtp: (token: string) => Promise<boolean>;
  /**
   * Reenvía el código OTP de registro al correo en espera.
   */
  resendSignUpOtp: () => Promise<boolean>;
  /**
   * Cancela el flujo de verificación OTP y limpia las credenciales temporales en RAM.
   */
  cancelOtpFlow: () => void;
  /** Inicia sesión y carga la `CryptoKey` derivada en memoria. */
  signIn: (email: string, password: string) => Promise<void>;
  /** Cierra la sesión en Supabase y destruye de inmediato la clave en RAM. */
  signOut: () => Promise<void>;
  /**
   * Re-deriva la clave en memoria cuando ya existe sesión válida (por ejemplo
   * tras recargar la página) pero la `vaultKey` se ha perdido.
   *
   * La passphrase se verifica previamente contra Supabase Auth: PBKDF2 nunca
   * falla ante una contraseña incorrecta, simplemente produciría una clave
   * errónea capaz de corromper silenciosamente futuras subidas.
   */
  unlockVaultWithPassword: (password: string) => Promise<void>;
  /**
   * Hidrata la sesión inicial y se suscribe a `onAuthStateChange`.
   * @returns Función de limpieza que cancela la suscripción.
   */
  initSession: () => () => void;
  /** Borra la frase de recuperación de la memoria tras mostrarla al usuario. */
  clearRecoveryPhrase: () => void;
  /** Borra el aviso de confirmación pendiente (p. ej. al cambiar de pestaña). */
  clearPendingConfirmation: () => void;
  /** Limpia el mensaje informativo de éxito de autenticación. */
  clearAuthSuccessMessage: () => void;
  /** Limpia el último error registrado. */
  clearError: () => void;
}

export type AuthStore = AuthState & AuthActions;

const INITIAL_STATE: AuthState = {
  user: null,
  session: null,
  vaultKey: null,
  recoveryPhrase: null,
  pendingConfirmationEmail: null,
  isAwaitingOtp: false,
  otpEmail: null,
  tempRegistrationPassword: null,
  authSuccessMessage: null,
  isLoading: false,
  error: null,
};

/**
 * Variable en memoria a nivel de módulo para retener temporalmente la contraseña de registro
 * y evitar race conditions cuando Supabase Auth dispara onAuthStateChange antes de que
 * verifySignUpOtp complete la derivación de la vaultKey.
 */
let cachedRegistrationPassword: string | null = null;

/**
 * Suscripción activa a `onAuthStateChange`, a nivel de módulo, para que
 * llamadas repetidas a `initSession` (React StrictMode, HMR) no acumulen
 * listeners duplicados.
 */
let authSubscription: { unsubscribe: () => void } | null = null;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAuthStore = create<AuthStore>()((set, get) => ({
  ...INITIAL_STATE,

  signUp: async (email, password) => {
    set({ isLoading: true, error: null, pendingConfirmationEmail: null, authSuccessMessage: null });

    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        throw error;
      }

      const user = data.user;
      if (!user) {
        throw new Error('Supabase no devolvió el usuario tras el registro.');
      }

      // Si el registro es exitoso y no devuelve sesión activa (requiere confirmación):
      // guarda otpEmail = email, tempRegistrationPassword = password, e isAwaitingOtp = true.
      // Además, respalda la contraseña a nivel de módulo en cachedRegistrationPassword.
      // NO redirigir, NO limpiar la contraseña todavía.
      if (!data.session) {
        cachedRegistrationPassword = password;
        set({
          user: null,
          session: null,
          vaultKey: null,
          recoveryPhrase: null,
          pendingConfirmationEmail: null,
          isAwaitingOtp: true,
          otpEmail: user.email ?? email,
          tempRegistrationPassword: password,
          authSuccessMessage: null,
          isLoading: false,
          error: null,
        });
        return;
      }

      // 1) Clave de bóveda: derivación local, jamás sale del navegador.
      const vaultKey = await deriveVaultKey(user.id, password);
      cachedRegistrationPassword = null;

      // 2) Frase de recuperación: se entrega al usuario, no se persiste.
      const recoveryPhrase = generateRecoveryPhrase();

      // 3) Sin escritura manual en `profiles`: la crea el trigger
      // `on_auth_user_created` (SECURITY DEFINER) sobre `auth.users`.

      set({
        user,
        session: data.session,
        vaultKey,
        recoveryPhrase,
        pendingConfirmationEmail: null,
        isAwaitingOtp: false,
        otpEmail: null,
        tempRegistrationPassword: null,
        authSuccessMessage: null,
        isLoading: false,
        error: null,
      });
    } catch (cause) {
      cachedRegistrationPassword = null;
      set({
        ...INITIAL_STATE,
        error: toErrorMessage(cause, 'No se pudo completar el registro.'),
      });
    }
  },

  verifySignUpOtp: async (token: string) => {
    const email = get().otpEmail ?? get().user?.email;
    if (!email) {
      set({ error: 'No hay un correo pendiente de verificación.' });
      return false;
    }

    set({ isLoading: true, error: null, authSuccessMessage: null });

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: token.trim(),
        type: 'signup',
      });

      if (error) {
        set({
          isLoading: false,
          error: 'Código inválido o expirado.',
        });
        return false;
      }

      const user = data.user;
      const session = data.session;
      if (!user || !session) {
        set({
          isLoading: false,
          error: 'Código inválido o expirado.',
        });
        return false;
      }

      // Obtén la contraseña a usar:
      const passwordToUse = cachedRegistrationPassword || get().tempRegistrationPassword;

      if (passwordToUse) {
        // 1. Deriva la vaultKey mediante deriveVaultKeyFromPassword(passwordToUse)
        const deriveVaultKeyFromPassword = (pwd: string) => deriveVaultKey(user.id, pwd);
        const vaultKey = await deriveVaultKeyFromPassword(passwordToUse);

        // 2. Limpia cachedRegistrationPassword = null y tempRegistrationPassword = null
        cachedRegistrationPassword = null;

        // 3. Actualiza el estado con user, session, vaultKey, e isAwaitingOtp = false
        // 4. Deja al usuario dentro del Dashboard directamente
        set({
          user,
          session,
          vaultKey,
          tempRegistrationPassword: null,
          otpEmail: null,
          isAwaitingOtp: false,
          pendingConfirmationEmail: null,
          authSuccessMessage: null,
          isLoading: false,
          error: null,
        });

        return true;
      }

      // Si por algún motivo extremo no existe la contraseña (ej. el usuario recargó la página F5 en medio del OTP):
      // 1. NO arrojes error en la pestaña de Crear Cuenta.
      // 2. Deja isAwaitingOtp = false, limpia el error, y cambia el estado o indica a la UI
      //    que muestre la pestaña "Iniciar Sesión" con el email precargado y un mensaje:
      //    "Cuenta confirmada correctamente. Introduce tu contraseña para entrar a la bóveda."
      cachedRegistrationPassword = null;
      set({
        user,
        session,
        vaultKey: null,
        tempRegistrationPassword: null,
        otpEmail: user.email ?? email,
        isAwaitingOtp: false,
        pendingConfirmationEmail: null,
        authSuccessMessage: 'Cuenta confirmada correctamente. Introduce tu contraseña para entrar a la bóveda.',
        isLoading: false,
        error: null,
      });

      return true;
    } catch (cause) {
      set({
        isLoading: false,
        error: toErrorMessage(cause, 'Código inválido o expirado.'),
      });
      return false;
    }
  },

  resendSignUpOtp: async () => {
    const email = get().otpEmail;
    if (!email) {
      set({ error: 'No hay un correo registrado para reenviar el código.' });
      return false;
    }

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });

      if (error) {
        throw error;
      }

      set({ error: null });
      return true;
    } catch (cause) {
      set({
        error: toErrorMessage(cause, 'No se pudo reenviar el código de verificación.'),
      });
      return false;
    }
  },

  cancelOtpFlow: () => {
    cachedRegistrationPassword = null;
    set({
      otpEmail: null,
      tempRegistrationPassword: null,
      isAwaitingOtp: false,
      authSuccessMessage: null,
      error: null,
    });
  },

  signIn: async (email, password) => {
    cachedRegistrationPassword = null;
    set({ isLoading: true, error: null, pendingConfirmationEmail: null, authSuccessMessage: null });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }

      const { user, session } = data;
      if (!user || !session) {
        throw new Error('Supabase no devolvió una sesión válida.');
      }

      const vaultKey = await deriveVaultKey(user.id, password);

      set({
        user,
        session,
        vaultKey,
        recoveryPhrase: null,
        pendingConfirmationEmail: null,
        authSuccessMessage: null,
        isLoading: false,
        error: null,
      });
    } catch (cause) {
      set({
        ...INITIAL_STATE,
        error: toErrorMessage(cause, 'Credenciales inválidas o servicio no disponible.'),
      });
    }
  },

  signOut: async () => {
    // La clave se destruye ANTES de la llamada de red para minimizar la
    // ventana en la que sigue viva en memoria.
    cachedRegistrationPassword = null;
    set({ vaultKey: null, recoveryPhrase: null, isLoading: true, error: null, authSuccessMessage: null });

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }

      set({ ...INITIAL_STATE });
    } catch (cause) {
      set({
        ...INITIAL_STATE,
        error: toErrorMessage(cause, 'No se pudo cerrar la sesión correctamente.'),
      });
    }
  },

  unlockVaultWithPassword: async (password) => {
    set({ isLoading: true, error: null });

    try {
      const { user, session } = get();
      const activeUser = user ?? session?.user ?? null;

      if (!activeUser) {
        throw new Error('No hay una sesión activa que permita desbloquear la bóveda.');
      }

      const email = activeUser.email;
      if (!email) {
        throw new Error('La cuenta no tiene email asociado: imposible verificar la passphrase.');
      }

      // Verificación de la passphrase antes de derivar, para no cargar en RAM
      // una clave incorrecta que cifraría documentos de forma irrecuperable.
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error('Passphrase incorrecta: no se pudo desbloquear la bóveda.');
      }

      const verifiedUser = data.user ?? activeUser;
      const vaultKey = await deriveVaultKey(verifiedUser.id, password);

      set({
        user: verifiedUser,
        session: data.session ?? session,
        vaultKey,
        isLoading: false,
        error: null,
      });
    } catch (cause) {
      set({
        vaultKey: null,
        isLoading: false,
        error: toErrorMessage(cause, 'No se pudo desbloquear la bóveda.'),
      });
    }
  },

  initSession: () => {
    // Evita suscripciones duplicadas si `initSession` se invoca más de una vez.
    authSubscription?.unsubscribe();
    authSubscription = null;

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          set({
            error: toErrorMessage(error, 'No se pudo recuperar la sesión.'),
          });
          return;
        }

        set({
          session: data.session,
          user: data.session?.user ?? null,
        });
      })
      .catch((cause: unknown) => {
        set({
          error: toErrorMessage(cause, 'No se pudo recuperar la sesión.'),
        });
      });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Sesión revocada (expiración, logout en otra pestaña, borrado de
        // cuenta): la clave en RAM deja de ser válida y se destruye.
        // No limpiamos cachedRegistrationPassword de forma prematura si isAwaitingOtp es true.
        if (!get().isAwaitingOtp) {
          cachedRegistrationPassword = null;
        }
        set({ ...INITIAL_STATE });
        return;
      }

      // INITIAL_SESSION | SIGNED_IN | TOKEN_REFRESHED | USER_UPDATED |
      // PASSWORD_RECOVERY: se sincroniza la sesión preservando la `vaultKey`
      // ya derivada en esta pestaña. Si aparece sesión válida, la
      // confirmación pendiente queda resuelta.
      const isAwaiting = get().isAwaitingOtp;

      // Mientras isAwaitingOtp sea true, aseguramos que onAuthStateChange no limpie
      // cachedRegistrationPassword ni tempRegistrationPassword de forma prematura,
      // ni altere isAwaitingOtp hasta que verifySignUpOtp finalice la derivación.
      set({
        session,
        user: session?.user ?? null,
        pendingConfirmationEmail: session ? null : get().pendingConfirmationEmail,
        isAwaitingOtp: isAwaiting ? true : (session ? false : get().isAwaitingOtp),
        otpEmail: isAwaiting ? get().otpEmail : (session ? null : get().otpEmail),
        tempRegistrationPassword: isAwaiting
          ? get().tempRegistrationPassword
          : (session ? null : get().tempRegistrationPassword),
      });
    });

    const subscription = data.subscription;
    authSubscription = subscription;

    return () => {
      subscription.unsubscribe();
      // Sólo se limpia la referencia global si sigue apuntando a ESTA
      // suscripción; de lo contrario un `initSession` posterior ya la
      // reemplazó y no debe perder su registro.
      if (authSubscription === subscription) {
        authSubscription = null;
      }
    };
  },

  clearRecoveryPhrase: () => {
    set({ recoveryPhrase: null });
  },

  clearPendingConfirmation: () => {
    set({ pendingConfirmationEmail: null });
  },

  clearAuthSuccessMessage: () => {
    set({ authSuccessMessage: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));

// ---------------------------------------------------------------------------
// Selectores (evitan re-renders innecesarios en los componentes)
// ---------------------------------------------------------------------------

/** `true` si existe sesión de Supabase válida. */
export const selectIsAuthenticated = (state: AuthStore): boolean => state.session !== null;

/** `true` si hay sesión pero la clave no está en RAM (bóveda bloqueada). */
export const selectIsVaultLocked = (state: AuthStore): boolean =>
  state.session !== null && state.vaultKey === null;
