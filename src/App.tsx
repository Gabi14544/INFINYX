import { useEffect } from 'react';
import AuthCard from './features/auth/components/AuthCard';
import VaultDashboard from './features/vault/components/VaultDashboard';
import { useAuthStore } from './features/auth/stores/useAuthStore';

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

  // Si no hay usuario, no hay sesión o la clave no está en RAM (F5 / recarga),
  // se renderiza única y exclusivamente el componente principal de autenticación.
  if (!user || !session || !vaultKey) {
    return <AuthCard />;
  }

  return <VaultDashboard />;
}
