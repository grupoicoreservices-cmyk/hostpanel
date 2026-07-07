import { useState, useCallback, useEffect, useRef, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { api, formatApiErrorDetail } from "@/lib/api";
import { AUTH } from "@/lib/testIds";

/** Login do webmail — visual inspirado no Google Sign-in (2 colunas dentro
 *  de um card centralizado, cinza claro no fundo, campos Material floating).
 *
 *  Fluxo em 2 passos: primeiro pede o e-mail (busca branding do domínio) e
 *  depois pede a senha. Se o usuário clicar em "voltar" pode trocar de conta.
 */
export default function ClientLogin() {
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState("email"); // 'email' | 'password'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [branding, setBranding] = useState(null);
  const [brandingLoading, setBrandingLoading] = useState(false);

  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  // 1) White-label por Host
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/public/host-branding");
        if (!cancelled && data && data.domain) setBranding(data);
      } catch {
        /* silencioso */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Foco automático nos campos ao mudar de step
  useEffect(() => {
    const t = setTimeout(() => {
      if (step === "email") emailInputRef.current?.focus();
      else passwordInputRef.current?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [step]);

  // 2) Ao sair do campo e-mail, tenta refinar o branding pelo domínio
  const fetchBranding = useCallback(async (rawEmail) => {
    const e = (rawEmail || "").trim().toLowerCase();
    const at = e.indexOf("@");
    if (at < 0 || at === e.length - 1) return;
    const domain = e.slice(at + 1);
    if (!domain.includes(".")) return;
    setBrandingLoading(true);
    try {
      const res = await api.get(`/public/domains/${encodeURIComponent(domain)}/branding`);
      setBranding(res.data);
    } catch {
      /* domínio não hospedado */
    } finally {
      setBrandingLoading(false);
    }
  }, []);

  const goToPassword = async (e) => {
    e.preventDefault();
    setError("");
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim.includes("@")) {
      setError("Informe um e-mail válido");
      return;
    }
    await fetchBranding(emailTrim);
    setStep("password");
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const emailTrim = email.trim().toLowerCase();
    try {
      let data;
      try {
        const res = await api.post("/auth/webmail-login", { email: emailTrim, password });
        data = res.data;
      } catch (bypassErr) {
        const res = await api.post("/auth/login", { email: emailTrim, password });
        data = res.data;
      }
      await refresh();
      toast.success(`Bem-vindo, ${data.user.name || data.user.email}`);
      navigate("/mail");
    } catch (e) {
      const msg = formatApiErrorDetail(e.response?.data?.detail) || e.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const changeAccount = () => {
    setStep("email");
    setPassword("");
    setError("");
  };

  const logoUrl = branding?.logo_url;
  const brandName = branding?.empresa || "Voxyra Webmail";
  const year = new Date().getFullYear();

  return (
    <div
      className="min-h-screen w-full flex flex-col bg-slate-100 dark:bg-slate-900"
      data-testid="client-login-page"
      style={{ fontFamily: '"Google Sans", "Roboto", -apple-system, "Segoe UI", sans-serif' }}
    >
      {/* Corpo com card central */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div
          className="w-full max-w-[900px] rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-8 sm:p-12"
          data-testid="client-login-card"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
            {/* Coluna esquerda: título + logo */}
            <div className="flex flex-col justify-start">
              <BrandMark logoUrl={logoUrl} />
              <h1 className="mt-4 text-[2rem] sm:text-[2.25rem] leading-[1.15] font-normal text-slate-900 dark:text-slate-100 tracking-tight">
                Faça login
              </h1>
              <p className="mt-2 text-slate-700 dark:text-slate-300 text-[15px]">
                Ir para <span className="font-medium">{brandName}</span>
              </p>

              {/* Chip da conta quando está no passo da senha */}
              {step === "password" && (
                <button
                  type="button"
                  onClick={changeAccount}
                  data-testid="client-login-change-account"
                  className="mt-6 inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-sm text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-700 dark:text-blue-300 text-[10px] font-bold uppercase">
                    {(email[0] || "?").toUpperCase()}
                  </span>
                  <span className="truncate max-w-[200px]">{email}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </button>
              )}
            </div>

            {/* Coluna direita: form */}
            <div className="flex flex-col justify-between">
              {step === "email" ? (
                <form onSubmit={goToPassword} className="flex flex-col gap-4">
                  <FloatingInput
                    ref={emailInputRef}
                    id="email"
                    testid={AUTH.loginEmail}
                    label="E-mail"
                    type="email"
                    value={email}
                    onChange={(v) => { setEmail(v); if (error) setError(""); }}
                    onBlur={() => fetchBranding(email)}
                    autoComplete="username"
                    trailing={brandingLoading ? "…" : null}
                    hasError={!!error}
                  />
                  {error && (
                    <div
                      data-testid="client-login-email-error"
                      className="text-[13px] text-red-600 dark:text-red-400 -mt-2"
                    >
                      {error}
                    </div>
                  )}
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); toast.info("Contate o administrador do seu domínio para recuperar o e-mail."); }}
                    className="text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:underline w-fit"
                    data-testid="client-login-forgot-email"
                  >
                    Esqueceu o e-mail?
                  </a>

                  <div className="mt-4 text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Não está no seu computador? Use uma janela anônima para fazer login com privacidade.
                  </div>

                  <div className="mt-8 flex items-center justify-end gap-3">
                    <button
                      type="submit"
                      data-testid={AUTH.loginSubmit}
                      className="inline-flex items-center justify-center px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-medium shadow-sm active:scale-[.98] transition-all"
                    >
                      Avançar
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={submit} className="flex flex-col gap-4">
                  {/* input escondido de e-mail para autofill dos password managers */}
                  <input
                    type="email" value={email} readOnly hidden
                    autoComplete="username"
                  />
                  <FloatingInput
                    ref={passwordInputRef}
                    id="password"
                    testid={AUTH.loginPassword}
                    label="Digite sua senha"
                    type="password"
                    value={password}
                    onChange={(v) => { setPassword(v); if (error) setError(""); }}
                    autoComplete="current-password"
                    hasError={!!error}
                  />
                  {error && (
                    <div
                      data-testid="client-login-password-error"
                      className="text-[13px] text-red-600 dark:text-red-400 -mt-2"
                    >
                      {error}
                    </div>
                  )}
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); toast.info("A recuperação de senha deve ser feita pelo administrador do seu domínio."); }}
                    className="text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:underline w-fit"
                    data-testid="client-login-forgot-password"
                  >
                    Esqueceu a senha?
                  </a>

                  <div className="mt-8 flex items-center justify-end gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      data-testid={AUTH.loginSubmit}
                      className="inline-flex items-center justify-center px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[14px] font-medium shadow-sm active:scale-[.98] transition-all min-w-[100px]"
                    >
                      {loading ? "Entrando…" : "Entrar"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé estilo Google */}
      <footer className="px-6 pb-6 pt-2 flex flex-wrap items-center justify-between text-[13px] text-slate-600 dark:text-slate-400 max-w-[900px] mx-auto w-full">
        <div className="inline-flex items-center gap-2 hover:text-slate-800 dark:hover:text-slate-200 cursor-default">
          Português (Brasil)
        </div>
        <div className="flex items-center gap-6">
          <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-slate-800 dark:hover:text-slate-200">Ajuda</a>
          <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-slate-800 dark:hover:text-slate-200">Privacidade</a>
          <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-slate-800 dark:hover:text-slate-200">Termos</a>
        </div>
      </footer>

      {/* Marca discreta para não confundir com Google */}
      <div className="pb-4 text-center text-[11px] text-slate-500 dark:text-slate-500">
        © {year} {brandName}
      </div>
    </div>
  );
}

function BrandMark({ logoUrl }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt="logo"
        className="h-10 w-auto object-contain"
        data-testid="client-login-logo"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return (
    <div
      className="w-11 h-11 rounded-full flex items-center justify-center"
      style={{
        background: "conic-gradient(from 210deg, #4285F4 0deg, #34A853 90deg, #FBBC05 180deg, #EA4335 270deg, #4285F4 360deg)",
      }}
      data-testid="client-login-logo-default"
    >
      <div className="w-9 h-9 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center">
        <Mail className="w-4 h-4 text-blue-600" strokeWidth={2.5} />
      </div>
    </div>
  );
}

/* -------- Floating-label input (Material-ish) -------- */
const FloatingInput = forwardRef(function FloatingInput(
  { id, testid, label, type = "text", value, onChange, onBlur, autoComplete, trailing, hasError },
  ref
) {
  const [focused, setFocused] = useState(false);
  const raised = focused || (value && value.length > 0);
  const borderCls = hasError
    ? "border-red-500 dark:border-red-500"
    : (focused ? "border-blue-600 dark:border-blue-400" : "border-slate-400 dark:border-slate-500");
  return (
    <div className="relative">
      <input
        ref={ref}
        id={id}
        data-testid={testid}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        autoComplete={autoComplete}
        required
        className={`peer w-full h-14 px-4 rounded-lg bg-transparent border-[1.5px] ${borderCls} text-slate-900 dark:text-slate-100 text-[16px] focus:outline-none transition-colors`}
      />
      <label
        htmlFor={id}
        className={`absolute left-3 px-1 bg-white dark:bg-slate-800 pointer-events-none transition-all text-[15px] ${
          raised
            ? `top-0 -translate-y-1/2 text-[12px] ${hasError ? "text-red-600 dark:text-red-400" : focused ? "text-blue-600 dark:text-blue-400" : "text-slate-500 dark:text-slate-400"}`
            : "top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
        }`}
      >
        {label}
      </label>
      {trailing && (
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {trailing}
        </span>
      )}
    </div>
  );
});
