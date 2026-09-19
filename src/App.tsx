import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import AuthCard from './features/auth/components/AuthCard';
import VaultDashboard from './features/vault/components/VaultDashboard';
import { useAuthStore } from './features/auth/stores/useAuthStore';

function UnlockVaultDialog() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const unlockVaultWithPassword = useAuthStore((s) => s.unlockVaultWithPassword);
  const signOut = useAuthStore((s) => s.signOut);
  const clearError = useAuthStore((s) => s.clearError);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    await unlockVaultWithPassword(password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-slate-900 p-6 shadow-2xl shadow-black/50 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30">
            <Lock className="h-6 w-6 text-amber-400" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-white">
              Bóveda bloqueada
            </h2>
            <p
              className="max-w-[260px] truncate text-xs text-zinc-500"
              title={user?.email ?? ''}
            >
              {user?.email ?? 'Sesión restaurada'}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-zinc-400">
          La clave vive sólo en la RAM y se perdió al recargar. Introduce tu
          contraseña para re-derivarla localmente con PBKDF2-SHA256.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="unlock-password"
              className="text-sm font-medium text-zinc-300"
            >
              Contraseña de la bóveda
            </label>
            <div className="relative">
              <input
                id="unlock-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="Tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoFocus
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 pr-11 text-sm text-white placeholder:text-zinc-600 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={isLoading}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || password.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Derivando clave…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Desbloquear bóveda
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => void signOut()}
            disabled={isLoading}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-50"
          >
            Usar otra cuenta
          </button>
        </form>
      </div>
    </div>
  );
}

function BootSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
        Restaurando sesión segura…
      </div>
    </div>
  );
}

export default function App() {
  const initSession = useAuthStore((s) => s.initSession);
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const vaultKey = useAuthStore((s) => s.vaultKey);
  const authLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    const cleanup = initSession();
    return cleanup;
  }, [initSession]);

  // Durante la hidratación inicial se muestra un splash para evitar
  // parpadeos entre AuthCard y el dashboard.
  if (authLoading && !user && !session) {
    return <BootSplash />;
  }

  // Sin usuario o sin sesión (p. ej. registro con confirmación por email
  // pendiente) se permanece en AuthCard: nunca se redirige al dashboard
  // antes de tiempo.
  if (!user || !session) {
    return <AuthCard />;
  }

  if (!vaultKey) {
    return <UnlockVaultDialog />;
  }

  return <VaultDashboard />;
}
