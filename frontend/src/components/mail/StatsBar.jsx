import { useMemo } from "react";

const CARDS = [
  { key: "dominios",   label: "Domínios",         suffix: "ativos",       tone: "primary" },
  { key: "contas",     label: "Contas",           suffix: "mailboxes",    tone: "foreground" },
  { key: "spam",       label: "Spam bloqueado",   suffix: "últimos 7 dias", tone: "warning" },
  { key: "servidor",   label: "Servidor",         suffix: "DirectAdmin conectado", tone: "success" },
];

export default function StatsBar({ stats }) {
  const value = useMemo(() => ({
    dominios: stats?.dominios ?? 0,
    contas: stats?.contas ?? 0,
    spam: stats?.spam_blocked_7d ?? 0,
    servidor: (stats?.servidores_online ?? 0) > 0 ? "Online" : "Aguardando",
  }), [stats]);

  const tone = {
    primary: "text-primary",
    foreground: "text-foreground",
    warning: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b border-border bg-card">
      {CARDS.map((c) => (
        <div
          key={c.key}
          data-testid={`webmail-stat-${c.key}`}
          className="rounded-xl border border-border bg-background/40 dark:bg-slate-900/40 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all"
        >
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">{c.label}</div>
          <div className={`font-display text-3xl font-bold mt-1.5 voxyra-fade-in ${tone[c.tone]}`}>
            {value[c.key].toLocaleString("pt-BR")}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{c.suffix}</div>
        </div>
      ))}
    </div>
  );
}
