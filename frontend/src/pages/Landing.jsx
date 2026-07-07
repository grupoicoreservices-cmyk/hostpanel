import { useNavigate, Link } from "react-router-dom";
import { Mail, Shield, ArrowRight, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEffect } from "react";

export default function Landing() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    if (user && user !== false) {
      if (user.role === "usuario_final") navigate("/mail", { replace: true });
      else navigate("/admin/dashboard", { replace: true });
    }
  }, [user, ready, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-950 text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none"
           style={{ backgroundImage: "radial-gradient(circle at 20% 30%, rgba(96,165,250,.35) 0, transparent 60%), radial-gradient(circle at 80% 70%, rgba(129,140,248,.25) 0, transparent 60%)" }}/>

      {/* Header */}
      <header className="relative z-10 px-6 lg:px-12 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
            <Mail className="w-6 h-6"/>
          </div>
          <div>
            <div className="font-display font-bold text-xl leading-tight">Voxyra Mail</div>
            <div className="text-[11px] uppercase tracking-widest text-blue-200/70">SaaS · Multi-empresa</div>
          </div>
        </div>
        <a href="mailto:suporte@voxyra.net.br" className="hidden md:block text-sm text-blue-200 hover:text-white transition-colors">
          Suporte
        </a>
      </header>

      {/* Hero */}
      <main className="relative z-10 px-6 lg:px-12 py-8 max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur text-xs font-semibold uppercase tracking-widest text-blue-200 mb-6">
            <CheckCircle2 className="w-3.5 h-3.5"/> Plataforma pronta
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
            Escolha por onde<br/>quer entrar.
          </h1>
          <p className="mt-4 text-blue-100/80 text-lg max-w-xl mx-auto">
            Webmail para clientes finais e Console Administrativo para gestores — na mesma plataforma, com credenciais separadas.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Webmail card */}
          <Link
            to="/"
            data-testid="landing-webmail-btn"
            className="group relative rounded-3xl bg-white/[.06] backdrop-blur border border-white/10 p-8 hover:bg-white/[.12] hover:border-blue-300/40 transition-all"
          >
            <div className="absolute top-6 right-6 h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center group-hover:scale-110 transition-transform">
              <ArrowRight className="w-5 h-5"/>
            </div>
            <div className="h-14 w-14 rounded-2xl bg-blue-500/20 flex items-center justify-center mb-5">
              <Mail className="w-7 h-7 text-blue-300"/>
            </div>
            <h2 className="font-display text-2xl font-bold mb-2">Webmail do cliente</h2>
            <p className="text-blue-100/70 text-sm">
              Acesse sua caixa postal. Envie, receba, organize seus e-mails com uma interface moderna e segura.
            </p>
            <ul className="mt-5 space-y-1.5 text-sm text-blue-100/80">
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-blue-300"/> IMAP + SMTP · TLS</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-blue-300"/> Tema claro & escuro</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-blue-300"/> Modo horizontal / vertical</li>
            </ul>
          </Link>

          {/* Admin card */}
          <Link
            to="/login"
            data-testid="landing-admin-btn"
            className="group relative rounded-3xl bg-white/[.06] backdrop-blur border border-white/10 p-8 hover:bg-white/[.12] hover:border-indigo-300/40 transition-all"
          >
            <div className="absolute top-6 right-6 h-10 w-10 rounded-full bg-indigo-500 flex items-center justify-center group-hover:scale-110 transition-transform">
              <ArrowRight className="w-5 h-5"/>
            </div>
            <div className="h-14 w-14 rounded-2xl bg-indigo-500/20 flex items-center justify-center mb-5">
              <Shield className="w-7 h-7 text-indigo-300"/>
            </div>
            <h2 className="font-display text-2xl font-bold mb-2">Console administrativo</h2>
            <p className="text-indigo-100/70 text-sm">
              Gerencie empresas, domínios, contas de e-mail, servidores DirectAdmin, antispam e monitoramento.
            </p>
            <ul className="mt-5 space-y-1.5 text-sm text-indigo-100/80">
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-300"/> Multi-empresa & multi-domínio</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-300"/> Integração DirectAdmin</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-300"/> Antispam & monitoramento</li>
            </ul>
          </Link>
        </div>

        <div className="mt-10 text-center text-xs text-blue-200/50">
          © {new Date().getFullYear()} Voxyra · Todos os direitos reservados
        </div>
      </main>
    </div>
  );
}
