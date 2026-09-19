import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  MailCheck,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';

type Tab = 'login' | 'register';

export default function AuthCard() {
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState(() => useAuthStore.getState().user?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  // Estado local para el flujo OTP
  const [otpCode, setOtpCode] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const {
    signIn,
    signUp,
    verifySignUpOtp,
    resendSignUpOtp,
    cancelOtpFlow,
    isAwaitingOtp,
    otpEmail,
    isLoading,
    error,
    recoveryPhrase,
    pendingConfirmationEmail,
    clearRecoveryPhrase,
    clearPendingConfirmation,
    clearError,
  } = useAuthStore();

  useEffect(() => {
    if (isAwaitingOtp) {
      otpInputRef.current?.focus();
    }
  }, [isAwaitingOtp]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    if (tab === 'login') {
      await signIn(email.trim(), password);
    } else {
      setCopied(false);
      await signUp(email.trim(), password);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 6) return;
    clearError();
    await verifySignUpOtp(otpCode);
  };

  const handleOtpChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setOtpCode(val);
    if (error) clearError();
  };

  const handleOtpPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    const val = pasted.replace(/\D/g, '').slice(0, 6);
    if (val) {
      setOtpCode(val);
      if (error) clearError();
    }
  };

  const handleResendOtp = async () => {
    if (isResending || isLoading) return;
    setIsResending(true);
    setResendSuccess(false);
    clearError();
    const success = await resendSignUpOtp();
    setIsResending(false);
    if (success) {
      setResendSuccess(true);
      window.setTimeout(() => setResendSuccess(false), 5000);
    }
  };

  const handleCancelOtp = () => {
    cancelOtpFlow();
    setOtpCode('');
    setResendSuccess(false);
    clearError();
  };

  const handleCopyPhrase = async () => {
    if (!recoveryPhrase) return;
    try {
      await navigator.clipboard.writeText(recoveryPhrase);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Portapapeles no disponible: el usuario puede copiar manualmente.
    }
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setCopied(false);
    clearPendingConfirmation();
    clearError();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-md">
        {/* Marca corporativa */}
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30">
            <ShieldCheck className="h-6 w-6 text-emerald-400" />
          </span>
          <div className="text-left">
            <p className="text-lg font-semibold tracking-tight text-white">
              Tech-Value Vault
            </p>
            <p className="text-xs uppercase tracking-widest text-zinc-500">
              Zero-Knowledge · AES-GCM-256
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-slate-900 shadow-2xl shadow-black/50">
          {isAwaitingOtp ? (
            /* Vista de Verificación de Seguridad (OTP) */
            <form onSubmit={handleVerifyOtp} className="space-y-5 p-6 sm:p-8">
              <div>
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Verificación de Seguridad
                </div>
                <h2 className="text-xl font-semibold text-white">
                  Introduce el código de 6 dígitos
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Enviamos un código a{' '}
                  <strong className="text-zinc-200">{otpEmail}</strong>
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              {resendSuccess && !error && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-200"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="break-words">
                    Se ha enviado un nuevo código de 6 dígitos a tu correo.
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="auth-otp"
                  className="block text-center text-xs font-medium uppercase tracking-wider text-zinc-400"
                >
                  Código de 6 dígitos
                </label>
                <input
                  ref={otpInputRef}
                  id="auth-otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  onChange={handleOtpChange}
                  onPaste={handleOtpPaste}
                  disabled={isLoading || isResending}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3.5 text-center font-mono text-3xl font-bold tracking-[0.4em] text-emerald-400 placeholder:text-zinc-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || isResending || otpCode.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verificando…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    Verificar y entrar a la bóveda
                  </>
                )}
              </button>

              <div className="flex flex-col items-center gap-2.5 pt-1 text-center">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={isLoading || isResending}
                  className="inline-flex items-center gap-1.5 text-xs text-emerald-400 transition hover:text-emerald-300 disabled:opacity-50"
                >
                  {isResending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Reenviando…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" />
                      ¿No recibiste el código? Reenviar
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleCancelOtp}
                  disabled={isLoading || isResending}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition hover:text-zinc-200 disabled:opacity-50"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Volver / Cambiar correo
                </button>
              </div>

              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-zinc-500">
                <Lock className="h-3 w-3" />
                Cifrado de extremo a extremo · PBKDF2-SHA256 · Servidor ciego
              </p>
            </form>
          ) : (
            <>
              {/* Pestañas */}
              <div
                role="tablist"
                aria-label="Modo de autenticación"
                className="grid grid-cols-2 border-b border-zinc-800 bg-zinc-950/60 p-1.5"
              >
                {(
                  [
                    { id: 'login', label: 'Iniciar Sesión' },
                    { id: 'register', label: 'Crear Cuenta' },
                  ] as { id: Tab; label: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    type="button"
                    onClick={() => switchTab(t.id)}
                    className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                      tab === t.id
                        ? 'bg-slate-800 text-white shadow ring-1 ring-zinc-700'
                        : 'text-zinc-400 hover:bg-slate-800/50 hover:text-zinc-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-6 sm:p-8">
            <div>
              <h2 className="text-xl font-semibold text-white">
                {tab === 'login' ? 'Acceso a la bóveda' : 'Nueva bóveda cifrada'}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {tab === 'login'
                  ? 'Tu clave se deriva en local. El servidor nunca la ve.'
                  : 'Generamos tu clave AES-GCM-256 en este dispositivo.'}
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            )}

            {pendingConfirmationEmail && !error && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-200"
              >
                <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">
                  Cuenta creada. Te hemos enviado un correo de confirmación a{' '}
                  <strong>{pendingConfirmationEmail}</strong>. Debes
                  confirmarlo antes de entrar: revisa tu bandeja y luego
                  inicia sesión. Aún no has accedido al dashboard.
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="auth-email"
                className="text-sm font-medium text-zinc-300"
              >
                Email corporativo
              </label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                placeholder="socio@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="auth-password"
                className="text-sm font-medium text-zinc-300"
              >
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
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
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tab === 'login' ? 'Verificando…' : 'Generando bóveda…'}
                </>
              ) : (
                <>
                  {tab === 'login' ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  {tab === 'login' ? 'Desbloquear bóveda' : 'Crear bóveda segura'}
                </>
              )}
            </button>

            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-zinc-500">
              <Lock className="h-3 w-3" />
              Cifrado de extremo a extremo · PBKDF2-SHA256 · Servidor ciego
            </p>
          </form>
        </>
      )}
    </div>

        <p className="mt-4 text-center text-xs text-zinc-600">
          Infraestructura auditada · Ningún empleado puede leer tus documentos
        </p>
      </div>

      {/* Frase de recuperación: material sensible de un solo uso en RAM */}
      {recoveryPhrase && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Frase de recuperación"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-lg rounded-2xl border border-amber-500/30 bg-slate-900 p-6 shadow-2xl sm:p-8">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 ring-1 ring-amber-500/30">
                <KeyRound className="h-5 w-5 text-amber-400" />
              </span>
              <h3 className="text-lg font-semibold text-white">
                Tu frase de recuperación
              </h3>
            </div>

            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <strong>Guarda esta clave, el servidor no puede recuperarla.</strong>{' '}
                Sin estas 12 palabras perderás el acceso definitivo a tus documentos.
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-950 p-4">
              <p className="font-mono text-sm leading-7 text-emerald-300">
                {recoveryPhrase}
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={handleCopyPhrase}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" />
                    Copiada
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copiar frase
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={clearRecoveryPhrase}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
              >
                <ShieldCheck className="h-4 w-4" />
                Ya la guardé, entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
