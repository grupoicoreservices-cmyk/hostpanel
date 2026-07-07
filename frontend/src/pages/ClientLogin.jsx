import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Mail, Lock, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/lib/api";
import { AUTH } from "@/lib/testIds";

/** Login exclusivo do cliente final — sem menções a admin/SaaS. */
export default function ClientLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const u = await login(email.trim(), password);
      toast.success(`Bem-vindo, ${u.name || u.email}`);
      // Cliente sempre para /mail; admin também pode acessar
      navigate("/mail");
    } catch (e) {
      const msg = formatApiErrorDetail(e.response?.data?.detail) || e.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left visual pane */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900 text-white p-12">
        <div className="absolute inset-0 opacity-20"
             style={{ backgroundImage: "radial-gradient(circle at 20% 20%, rgba(255,255,255,.3) 0, transparent 50%), radial-gradient(circle at 80% 80%, rgba(255,255,255,.15) 0, transparent 50%)" }}/>
        <div className="relative z-10 flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
            <Mail className="w-6 h-6"/>
          </div>
          <div>
            <div className="font-display text-2xl font-bold tracking-tight">Voxyra Webmail</div>
            <div className="text-xs text-blue-100/80">Sua caixa postal profissional</div>
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <h1 className="font-display text-4xl xl:text-5xl font-bold tracking-tight leading-[1.05]">
            E-mail rápido,<br/>
            <span className="text-blue-200">seguro e</span><br/>
            sempre online.
          </h1>
          <p className="text-blue-100/80 max-w-md">
            Toda a caixa postal do seu domínio na palma da mão — desktop e mobile.
          </p>
        </div>

        <div className="relative z-10 text-xs text-blue-100/60">
          © {new Date().getFullYear()} Voxyra
        </div>
      </div>

      {/* Right form pane */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-3 h-3"/> Voltar
          </Link>

          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
              <Mail className="w-5 h-5"/>
            </div>
            <div className="font-display font-bold text-xl">Voxyra Webmail</div>
          </div>

          <h2 className="font-display text-3xl font-bold tracking-tight">Entrar no webmail</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Use seu e-mail e senha da caixa postal.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">E-mail</span>
              <div className="mt-1 relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
                <input
                  data-testid={AUTH.loginEmail}
                  type="email" required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@empresa.com.br"
                  className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Senha</span>
              <div className="mt-1 relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
                <input
                  data-testid={AUTH.loginPassword}
                  type="password" required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                />
              </div>
            </label>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              data-testid={AUTH.loginSubmit}
              type="submit" disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 font-semibold shadow-sm hover:bg-blue-700 active:scale-[.98] transition-all disabled:opacity-60"
            >
              {loading ? "Entrando…" : (<>Entrar no webmail <ArrowRight className="w-4 h-4"/></>)}
            </button>
          </form>

          <div className="mt-6 text-xs text-muted-foreground text-center">
            É administrador? <Link to="/login" className="text-primary hover:underline font-semibold">Acessar o console</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
