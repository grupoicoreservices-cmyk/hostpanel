import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Building2, Globe, Users, Server, HardDrive, ShieldAlert } from "lucide-react";

const CARDS = [
  { key: "empresas",  label: "Empresas",        icon: Building2, tone: "text-primary" },
  { key: "dominios",  label: "Domínios",        icon: Globe,     tone: "text-foreground" },
  { key: "contas",    label: "Contas de e-mail",icon: Users,     tone: "text-foreground" },
  { key: "servidores",label: "Servidores DA",   icon: Server,    tone: "text-emerald-600 dark:text-emerald-400" },
  { key: "storage",   label: "Armazenamento",   icon: HardDrive, tone: "text-primary" },
  { key: "spam",      label: "Spam bloqueado",  icon: ShieldAlert, tone: "text-amber-600 dark:text-amber-400" },
];

export default function AdminDashboard() {
  const [s, setS] = useState({});
  useEffect(() => { api.get("/dashboard/stats").then(({data}) => setS(data)).catch(()=>{}); }, []);

  const values = {
    empresas: s.empresas ?? 0,
    dominios: s.dominios ?? 0,
    contas: s.contas ?? 0,
    servidores: `${s.servidores_online ?? 0}/${s.servidores_total ?? 0}`,
    storage: `${Math.round((s.storage_used_mb ?? 0) / 1024 * 10) / 10} GB`,
    spam: s.spam_blocked_7d ?? 0,
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
        <h1 className="font-display text-4xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Visão consolidada do ambiente Voxyra Mail.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map(c => {
          const Icon = c.icon;
          return (
            <div
              key={c.key}
              data-testid={`admin-stat-${c.key}`}
              className="rounded-2xl border border-border bg-card p-5 hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">{c.label}</div>
                <div className={`h-9 w-9 rounded-xl bg-muted flex items-center justify-center ${c.tone}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className={`font-display text-4xl font-bold ${c.tone}`}>
                {typeof values[c.key] === "number" ? values[c.key].toLocaleString("pt-BR") : values[c.key]}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-xl font-bold mb-3">Próximos passos</h2>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Cadastre um <strong className="text-foreground">Servidor DirectAdmin</strong> em <em>Servidores DA</em>.</li>
          <li>Crie uma <strong className="text-foreground">Empresa</strong>.</li>
          <li>Adicione <strong className="text-foreground">Domínios</strong> vinculados à empresa e ao servidor.</li>
          <li>Provisiona <strong className="text-foreground">Contas de e-mail</strong> — o sistema chama a API DirectAdmin.</li>
          <li>Crie um <strong className="text-foreground">Usuário final</strong> ligado à conta para acessar o Webmail.</li>
        </ol>
      </div>
    </div>
  );
}
