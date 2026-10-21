import { useEffect } from 'react';
import AuthCard from './features/auth/components/AuthCard';
import VaultDashboard from './features/vault/components/VaultDashboard';
import { useAuthStore } from './features/auth/stores/useAuthStore';
import { useDownloadAuthStore } from './features/vault/stores/useDownloadAuthStore';
import { useVaultStore } from './features/vault/stores/useVaultStore';

/** Tiempo máximo de inactividad antes de purgar la clave en memoria (10 minutos). */
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * App.tsx
 * ---------------------------------------------------------------------------
 * Flujo unificado con UN SOLO INICIO DE SESIÓN:
 * - Si no hay usuario, no hay sesión activa o la clave criptográfica de
 *   bóveda no reside en memoria RAM (vaultKey === null, p. ej. tras recargar F5),
 *   se renderiza única y exclusivamente la pantalla principal de
 *   autenticación (AuthCard) con sus dos pestañas ("Iniciar Sesión" y "Crear Cuenta").
 * - Al autenticar y derivar la clave en AuthCard, se accede directamente al
 *   Dashboard sin pantallas secundarias de desbloqueo.
 * ---------------------------------------------------------------------------
 */
export default function App() {
  const initSession = useAuthStore((s) => s.initSession);
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const vaultKey = useAuthStore((s) => s.vaultKey);

  useEffect(() => {
    const cleanup = initSession();
    return cleanup;
  }, [initSession]);

  useEffect(() => {
    if (!vaultKey) return;

    let timerId: ReturnType<typeof setTimeout>;

    const handleTimeout = () => {
      useDownloadAuthStore.getState().clearDownloadSessionPassword();
      useVaultStore.getState().reset();
      useAuthStore.getState().lockVaultInMemory();
    };

    const resetTimer = () => {
      clearTimeout(timerId);
      timerId = setTimeout(handleTimeout, INACTIVITY_TIMEOUT_MS);
    };

    resetTimer();

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    for (const evt of events) {
      window.addEventListener(evt, resetTimer, { passive: true });
    }

    return () => {
      clearTimeout(timerId);
      for (const evt of events) {
        window.removeEventListener(evt, resetTimer);
      }
    };
  }, [vaultKey]);

  // Si no hay usuario, no hay sesión o la clave no está en RAM (F5 / recarga),
  // se renderiza única y exclusivamente el componente principal de autenticación.
  if (!user || !session || !vaultKey) {
    return <AuthCard />;
  }

  return <VaultDashboard />;
}
