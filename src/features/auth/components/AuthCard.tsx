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
import HexaMugenLogo from '../../../shared/components/HexaMugenLogo';
import ThemeToggle from '../../../shared/components/ThemeToggle';
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
    user,
    signIn,
    signUp,
    verifySignUpOtp,
    resendSignUpOtp,
    cancelOtpFlow,
    isAwaitingOtp,
    otpEmail,
    isLoading,
    error,
    authSuccessMessage,
    clearAuthSuccessMessage,
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

  useEffect(() => {
    if (authSuccessMessage) {
      queueMicrotask(() => {
        setTab('login');
        const targetEmail = user?.email || otpEmail;
        if (targetEmail) {
          setEmail(targetEmail);
        }
      });
    }
  }, [authSuccessMessage, user?.email, otpEmail]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    clearAuthSuccessMessage();
    if (tab === 'login') {
      await signIn(email.trim(), password);
    } else {
      setCopied(false);
      await signUp(email.trim(), password);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (otpCode.length < 6) return;
    clearError();
    await verifySignUpOtp(otpCode);
  };

  const handleOtpChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 8);
    setOtpCode(val);
    if (error) clearError();
  };

  const handleOtpPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    const val = pasted.replace(/\D/g, '').slice(0, 8);
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
    clearAuthSuccessMessage();
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
    clearAuthSuccessMessage();
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4 py-10 text-[#0F172A] transition-colors dark:bg-[#07090E] dark:text-[#F8FAFC]">
      {/* Selector flotante de modo claro / modo oscuro */}
      <div className="fixed right-4 top-4 z-20 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        {/* Cabecera de marca institucional INFINYX */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-16 items-center justify-center rounded-xl border border-sky-500/30 bg-white shadow-md transition-colors dark:border-[#38BDF8]/30 dark:bg-[#0D111A] dark:shadow-[0_0_20px_rgba(56,189,248,0.15)]">
            <HexaMugenLogo className="h-10 w-14" />
          </div>
          <h1 className="mt-3 text-xl font-bold tracking-wider text-[#0F172A] dark:text-[#F8FAFC]">
            INFINYX
          </h1>
          <p className="mt-1 text-xs font-medium uppercase tracking-widest text-[#0284C7] dark:text-[#38BDF8]">
            Bóveda de Seguridad
          </p>
        </div>

        {/* Tarjeta principal */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-sky-500/10 transition-colors dark:border-[#1E293B] dark:bg-[#0D111A]/95 dark:shadow-[0_20px_60px_rgba(0,0,0,0.75)] dark:ring-[#38BDF8]/10">
          {isAwaitingOtp ? (
            /* Vista de Verificación OTP de 6 dígitos */
            <form onSubmit={handleVerifyOtp} className="space-y-5 p-6 sm:p-8">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider text-sky-700 dark:border-[#38BDF8]/30 dark:bg-[#38BDF8]/10 dark:text-[#BAE6FD]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
                  Autenticación Multifactor
                </span>
                <h2 className="mt-2 text-xl font-semibold text-[#0F172A] dark:text-[#F8FAFC]">
                  Verificación OTP de 6 dígitos
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-[#94A3B8]">
                  Introduce el código temporal enviado a{' '}
                  <strong className="text-[#0F172A] dark:text-[#F8FAFC]">{otpEmail}</strong>
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              {resendSuccess && !error && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-50 px-3.5 py-3 text-sm text-sky-800 dark:bg-[#0284C7]/15 dark:text-[#BAE6FD]"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0284C7] dark:text-[#38BDF8]" />
                  <span className="break-words">
                    Se ha enviado un nuevo código de verificación a tu correo institucional.
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="auth-otp"
                  className="block text-center text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#94A3B8]"
                >
                  Código de verificación
                </label>
                <input
                  ref={otpInputRef}
                  id="auth-otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="000000"
                  value={otpCode}
                  onChange={handleOtpChange}
                  onPaste={handleOtpPaste}
                  disabled={isLoading || isResending}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-center font-mono text-3xl font-bold tracking-[0.4em] text-[#0284C7] placeholder:text-slate-300 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60 dark:border-[#1E293B] dark:bg-[#07090E] dark:text-[#BAE6FD] dark:placeholder:text-slate-600 dark:focus:border-[#38BDF8] dark:focus:ring-[#38BDF8]/20"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || isResending || otpCode.length < 6}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#38BDF8]/50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#07090E]"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-white dark:text-[#07090E]" />
                    Verificando…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4 text-white dark:text-[#07090E]" />
                    Verificar y entrar a la bóveda
                  </>
                )}
              </button>

              <div className="flex flex-col items-center gap-2.5 pt-1 text-center">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={isLoading || isResending}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0284C7] transition hover:text-sky-700 disabled:opacity-50 dark:text-[#38BDF8] dark:hover:text-[#BAE6FD]"
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
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-slate-900 disabled:opacity-50 dark:text-[#94A3B8] dark:hover:text-[#F8FAFC]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Volver / Cambiar correo
                </button>
              </div>

              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500 dark:text-[#94A3B8]">
                <Lock className="h-3.5 w-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
                Cifrado de extremo a extremo
              </p>
            </form>
          ) : (
            <>
              {/* Selector de pestañas Iniciar Sesión / Crear Cuenta */}
              <div
                role="tablist"
                aria-label="Modo de autenticación"
                className="grid grid-cols-2 border-b border-slate-200 bg-slate-100/80 p-1.5 dark:border-[#1E293B] dark:bg-[#07090E]/80"
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
                    className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                      tab === t.id
                        ? 'bg-white text-sky-800 shadow ring-1 ring-sky-500/30 dark:bg-[#111827] dark:text-[#BAE6FD] dark:ring-[#38BDF8]/40'
                        : 'text-slate-500 hover:text-slate-900 dark:text-[#94A3B8] dark:hover:text-[#F8FAFC]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 p-6 sm:p-8">
                <div>
                  <h2 className="text-xl font-semibold text-[#0F172A] dark:text-[#F8FAFC]">
                    {tab === 'login' ? 'Acceso a la bóveda' : 'Nueva bóveda cifrada'}
                  </h2>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                    <span className="break-words">{error}</span>
                  </div>
                )}

                {authSuccessMessage && !error && (
                  <div
                    role="status"
                    className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-50 px-3.5 py-3 text-sm text-sky-800 dark:bg-[#0284C7]/15 dark:text-[#BAE6FD]"
                  >
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0284C7] dark:text-[#38BDF8]" />
                    <span className="break-words">{authSuccessMessage}</span>
                  </div>
                )}

                {pendingConfirmationEmail && !error && !authSuccessMessage && (
                  <div
                    role="status"
                    className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-50 px-3.5 py-3 text-sm text-sky-800 dark:bg-[#0284C7]/15 dark:text-[#BAE6FD]"
                  >
                    <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0284C7] dark:text-[#38BDF8]" />
                    <span className="break-words">
                      Cuenta creada. Te hemos enviado un correo de confirmación a{' '}
                      <strong className="text-slate-900 dark:text-white">{pendingConfirmationEmail}</strong>. Debes confirmarlo antes de entrar:
                      revisa tu bandeja y luego inicia sesión.
                    </span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-email"
                    className="text-sm font-medium text-slate-700 dark:text-[#F8FAFC]"
                  >
                    Email corporativo
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="socio@bancaprivada.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60 dark:border-[#1E293B] dark:bg-[#07090E] dark:text-[#F8FAFC] dark:placeholder:text-slate-600 dark:focus:border-[#38BDF8] dark:focus:ring-[#38BDF8]/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-password"
                    className="text-sm font-medium text-slate-700 dark:text-[#F8FAFC]"
                  >
                    Contraseña maestra
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
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60 dark:border-[#1E293B] dark:bg-[#07090E] dark:text-[#F8FAFC] dark:placeholder:text-slate-600 dark:focus:border-[#38BDF8] dark:focus:ring-[#38BDF8]/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={isLoading}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50 dark:text-[#94A3B8] dark:hover:bg-[#111827] dark:hover:text-[#BAE6FD]"
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
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#38BDF8]/50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#07090E]"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white dark:text-[#07090E]" />
                      {tab === 'login' ? 'Verificando…' : 'Generando bóveda…'}
                    </>
                  ) : (
                    <>
                      {tab === 'login' ? (
                        <Lock className="h-4 w-4 text-white dark:text-[#07090E]" />
                      ) : (
                        <KeyRound className="h-4 w-4 text-white dark:text-[#07090E]" />
                      )}
                      {tab === 'login' ? 'Desbloquear bóveda' : 'Crear bóveda segura'}
                    </>
                  )}
                </button>

                <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500 dark:text-[#94A3B8]">
                  <Lock className="h-3.5 w-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
                  Cifrado de extremo a extremo
                </p>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Modal de Frase de Recuperación: material sensible de un solo uso en RAM */}
      {recoveryPhrase && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Frase de recuperación"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs dark:bg-black/80"
        >
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl transition-colors sm:p-8 dark:border-[#38BDF8]/30 dark:bg-[#0D111A]">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-[#0284C7] dark:border-[#38BDF8]/30 dark:bg-[#38BDF8]/10 dark:text-[#38BDF8]">
                <KeyRound className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-xl font-semibold text-[#0F172A] dark:text-[#F8FAFC]">
                  Tu frase de recuperación
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                  Generada en cliente · Custodia Zero-Knowledge
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-50 px-3.5 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
              <p>
                <strong>Guarda esta clave con extrema seguridad.</strong> El servidor no tiene copia
                ni puede recuperarla. Sin estas 12 palabras no podrás restaurar el acceso a tus
                documentos cifrados.
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-[#1E293B] dark:bg-[#07090E]">
              <p className="font-mono text-sm leading-7 text-sky-800 dark:text-[#BAE6FD]">
                {recoveryPhrase}
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={handleCopyPhrase}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-sky-500/40 hover:bg-slate-200 hover:text-sky-700 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#F8FAFC] dark:hover:border-[#38BDF8]/40 dark:hover:bg-[#1E293B] dark:hover:text-[#BAE6FD]"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-[#0284C7] dark:text-[#38BDF8]" />
                    <span className="text-[#0284C7] dark:text-[#38BDF8]">Copiada al portapapeles</span>
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
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 dark:text-[#07090E]"
              >
                <ShieldCheck className="h-4 w-4 text-white dark:text-[#07090E]" />
                Ya la guardé, entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
