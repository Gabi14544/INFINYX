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
    <div className="flex min-h-screen items-center justify-center bg-[#F8F7F4] px-4 py-10 text-[#181816]">
      <div className="w-full max-w-md">
        {/* Marca corporativa institucional */}
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#141413] ring-1 ring-[#262523] shadow-md">
            <ShieldCheck className="h-6 w-6 text-[#C8B69E]" />
          </span>
          <h1 className="font-editorial mt-3 text-2xl font-bold tracking-tight text-[#181816]">
            Tech-Value Vault
          </h1>
          <p className="mt-1 text-xs uppercase tracking-widest text-[#6E6A63]">
            Zero-Knowledge · AES-GCM-256 · Private Wealth Custody
          </p>
        </div>

        {/* Tarjeta de Login / Registro / OTP */}
        <div className="overflow-hidden rounded-2xl border border-[#E6E4DD] bg-white shadow-[0_12px_40px_rgba(20,20,19,0.06)]">
          {isAwaitingOtp ? (
            /* Vista de Verificación OTP de 6 dígitos */
            <form onSubmit={handleVerifyOtp} className="space-y-5 p-6 sm:p-8">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D8D0C5] bg-[#F5F2EB] px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider text-[#5C5043]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#6E6053]" />
                  Autenticación Multifactor
                </span>
                <h2 className="font-editorial mt-2 text-xl font-semibold text-[#181816]">
                  Verificación OTP de 6 dígitos
                </h2>
                <p className="mt-1 text-sm text-[#6E6A63]">
                  Introduce el código temporal enviado a{' '}
                  <strong className="text-[#181816]">{otpEmail}</strong>
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              {resendSuccess && !error && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-lg border border-[#D8D0C5] bg-[#F5F2EB] px-3.5 py-3 text-sm text-[#5C5043]"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#6E6053]" />
                  <span className="break-words">
                    Se ha enviado un nuevo código de verificación a tu correo institucional.
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="auth-otp"
                  className="block text-center text-xs font-semibold uppercase tracking-wider text-[#6E6A63]"
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
                  className="w-full rounded-xl border border-[#DCD9D0] bg-[#FAF9F6] px-4 py-3.5 text-center font-mono text-3xl font-bold tracking-[0.4em] text-[#181816] placeholder:text-[#DCD9D0] outline-none transition focus:border-[#141413] focus:ring-2 focus:ring-[#141413]/10 disabled:opacity-60"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || isResending || otpCode.length < 6}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#141413] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2B2A27] focus:outline-none focus:ring-2 focus:ring-[#141413]/20 disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6E6053] transition hover:text-[#181816] disabled:opacity-50"
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
                  className="inline-flex items-center gap-1.5 text-xs text-[#8C867B] transition hover:text-[#181816] disabled:opacity-50"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Volver / Cambiar correo
                </button>
              </div>

              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-[#8C867B]">
                <Lock className="h-3 w-3" />
                Cifrado de extremo a extremo · PBKDF2-SHA256 · Servidor ciego
              </p>
            </form>
          ) : (
            <>
              {/* Pestañas Iniciar Sesión / Crear Cuenta */}
              <div
                role="tablist"
                aria-label="Modo de autenticación"
                className="grid grid-cols-2 border-b border-[#E6E4DD] bg-[#F3F1EC] p-1.5"
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
                        ? 'bg-white text-[#181816] shadow-xs ring-1 ring-[#E6E4DD]'
                        : 'text-[#6E6A63] hover:text-[#181816]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 p-6 sm:p-8">
                <div>
                  <h2 className="font-editorial text-xl font-semibold text-[#181816]">
                    {tab === 'login' ? 'Acceso a la bóveda' : 'Nueva bóveda cifrada'}
                  </h2>
                  <p className="mt-1 text-sm text-[#6E6A63]">
                    {tab === 'login'
                      ? 'Tu clave se deriva en local. El servidor nunca la ve.'
                      : 'Generamos tu clave AES-GCM-256 en este dispositivo.'}
                  </p>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <span className="break-words">{error}</span>
                  </div>
                )}

                {authSuccessMessage && !error && (
                  <div
                    role="status"
                    className="flex items-start gap-2.5 rounded-lg border border-[#D8D0C5] bg-[#F5F2EB] px-3.5 py-3 text-sm text-[#5C5043]"
                  >
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#6E6053]" />
                    <span className="break-words">{authSuccessMessage}</span>
                  </div>
                )}

                {pendingConfirmationEmail && !error && !authSuccessMessage && (
                  <div
                    role="status"
                    className="flex items-start gap-2.5 rounded-lg border border-[#D8D0C5] bg-[#F5F2EB] px-3.5 py-3 text-sm text-[#5C5043]"
                  >
                    <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#6E6053]" />
                    <span className="break-words">
                      Cuenta creada. Te hemos enviado un correo de confirmación a{' '}
                      <strong>{pendingConfirmationEmail}</strong>. Debes confirmarlo antes de entrar:
                      revisa tu bandeja y luego inicia sesión.
                    </span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-email"
                    className="text-sm font-medium text-[#181816]"
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
                    className="w-full rounded-lg border border-[#DCD9D0] bg-white px-3.5 py-2.5 text-sm text-[#181816] placeholder:text-[#9E9A91] outline-none transition focus:border-[#141413] focus:ring-2 focus:ring-[#141413]/10 disabled:opacity-60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-password"
                    className="text-sm font-medium text-[#181816]"
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
                      className="w-full rounded-lg border border-[#DCD9D0] bg-white px-3.5 py-2.5 pr-11 text-sm text-[#181816] placeholder:text-[#9E9A91] outline-none transition focus:border-[#141413] focus:ring-2 focus:ring-[#141413]/10 disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={isLoading}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#6E6A63] transition hover:bg-[#F3F1EC] hover:text-[#181816] disabled:opacity-50"
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
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#141413] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2B2A27] focus:outline-none focus:ring-2 focus:ring-[#141413]/20 disabled:cursor-not-allowed disabled:opacity-60"
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

                <p className="flex items-center justify-center gap-1.5 text-center text-xs text-[#8C867B]">
                  <Lock className="h-3 w-3" />
                  Cifrado de extremo a extremo · PBKDF2-SHA256 · Servidor ciego
                </p>
              </form>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-[#8C867B]">
          Infraestructura auditada · Ningún operador o tercero puede leer tus documentos
        </p>
      </div>

      {/* Modal de Frase de Recuperación: material sensible de un solo uso en RAM */}
      {recoveryPhrase && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Frase de recuperación"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#E6E4DD] bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#D8D0C5] bg-[#F5F2EB] text-[#6E6053]">
                <KeyRound className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-editorial text-xl font-semibold text-[#181816]">
                  Tu frase de recuperación
                </h3>
                <p className="text-xs text-[#6E6A63]">
                  Generada en cliente · Custodia Zero-Knowledge
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-[#E2D6C1] bg-[#FAF6EE] px-3.5 py-3 text-sm text-[#5C4D3C]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#8C6D44]" />
              <p>
                <strong>Guarda esta clave con extrema seguridad.</strong> El servidor no tiene copia
                ni puede recuperarla. Sin estas 12 palabras no podrás restaurar el acceso a tus
                documentos cifrados.
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-[#E6E4DD] bg-[#F8F7F4] p-4">
              <p className="font-mono text-sm font-medium leading-7 text-[#181816]">
                {recoveryPhrase}
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={handleCopyPhrase}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#DCD9D0] bg-white px-4 py-2.5 text-sm font-medium text-[#181816] transition hover:bg-[#F3F1EC]"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-[#6E6053]" />
                    Copiada al portapapeles
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
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#141413] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2B2A27]"
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
