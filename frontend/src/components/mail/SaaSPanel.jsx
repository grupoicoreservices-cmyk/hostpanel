import { useNavigate } from "react-router-dom";
import { Users, Globe, Filter, ScrollText, Server, ShieldCheck, CircleDot } from "lucide-react";
import { MAIL } from "@/lib/testIds";
import { useAuth } from "@/context/AuthContext";

const LINKS = [
  { id: "contas",    label: "Gerenciar contas",        route: "/admin/contas",     icon: Users },
  { id: "dominios",  label: "Domínios & DNS",          route: "/admin/dominios",   icon: Globe },
  { id: "aliases",   label: "Aliases",                 route: "/admin/contas",     icon: ShieldCheck },
  { id: "antispam",  label: "Regras antispam",         route: "/admin/logs",       icon: Filter },
  { id: "logs",      label: "Logs SMTP/IMAP",          route: "/admin/logs",       icon: ScrollText },
  { id: "directadmin", label: "Integração DirectAdmin", route: "/admin/servidores", icon: Server },
];

export default function SaasPanel({ stats, primaryServer, primaryDomain }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "superadmin" || user?.role === "empresa_admin";

  return (
    <aside className="hidden xl:flex w-72 flex-shrink-0 border-l border-border bg-card flex-col overflow-y-auto voxyra-scroll">
      <div className="p-5 border-b border-border">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Painel SaaS</div>
        <div className="font-display text-lg font-bold mt-1">Voxyra Console</div>
      </div>

      <div className="p-4 space-y-3">
        <div className="rounded-xl border border-border p-4 bg-background/40">
          <div className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">Contas ativas</div>
          <div className="font-display font-bold text-lg mt-1">{stats?.contas ?? 0}</div>
          <div className="text-xs text-muted-foreground">em {stats?.dominios ?? 0} domínio(s)</div>
        </div>

        <div className="rounded-xl border border-border p-4 bg-background/40">
          <div className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">Domínio principal</div>
          <div className="font-display font-semibold text-sm mt-1 truncate">
            {primaryDomain || "—"}
          </div>
        </div>
      </div>

      <nav className="px-2 pb-2">
        {LINKS.map((l) => {
          const Icon = l.icon;
          return (
            <button
              key={l.id}
              data-testid={`${MAIL.saasPanelLink}${l.id}`}
              disabled={!isAdmin}
              onClick={() => isAdmin && navigate(l.route)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isAdmin ? "hover:bg-blue-50 dark:hover:bg-slate-800 text-foreground" : "text-muted-foreground/50 cursor-not-allowed"
              }`}
            >
              <Icon className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1 text-left">{l.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-4 border-t border-border">
        <div className={`rounded-xl border p-4 ${
          (stats?.servidores_online ?? 0) > 0
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-amber-500/30 bg-amber-500/5"
        }`}>
          <div className="flex items-center gap-2 text-xs font-bold">
            <CircleDot className={`w-3.5 h-3.5 ${(stats?.servidores_online ?? 0) > 0 ? "text-emerald-500" : "text-amber-500"}`} />
            <span className="truncate">{primaryServer?.nome || "Nenhum servidor"}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {(stats?.servidores_online ?? 0) > 0
              ? "IMAP, SMTP e Webmail operacionais"
              : "Cadastre um servidor DirectAdmin"}
          </div>
        </div>
      </div>
    </aside>
  );
}
