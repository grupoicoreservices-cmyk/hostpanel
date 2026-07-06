import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Activity, Database, Server, Mail, Send, RefreshCw, CheckCircle2, XCircle, Clock, ShieldCheck, ShieldX, Cpu } from "lucide-react";
import { ADMIN } from "@/lib/testIds";

const KIND_ICON = {
  api: Cpu,
  database: Database,
  directadmin: Server,
  imap: Mail,
  smtp: Send,
};

function fmtUptime(seconds) {
  const s = Math.max(0, seconds | 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export default function AdminMonitoring() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [lastAt, setLastAt] = useState(null);
  const intervalRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/monitoring/services");
      setData(data);
      setLastAt(new Date());
    } catch (e) {
      toast.error("Não foi possível atualizar o monitoramento");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (auto) {
      intervalRef.current = setInterval(load, 15000);
      return () => clearInterval(intervalRef.current);
    }
  }, [auto, load]);

  const s = data?.summary || {};
  const a = data?.activity || {};
  const services = data?.services || [];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
          <h1 className="font-display text-4xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-8 h-8 text-primary"/> Monitoramento
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Status em tempo real de API, MongoDB, servidores DirectAdmin, IMAP e SMTP.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <input
              data-testid="monitoring-auto-toggle"
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (15s)
          </label>
          <button
            data-testid="monitoring-refresh-btn"
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-xs font-semibold hover:bg-muted transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Serviços online" value={`${s.online ?? 0}/${s.total ?? 0}`} tone="success" icon={CheckCircle2} testId="monitoring-sum-online" />
        <SummaryCard label="Serviços offline" value={s.offline ?? 0} tone={s.offline ? "danger" : "muted"} icon={XCircle} testId="monitoring-sum-offline" />
        <SummaryCard label="Uptime da API" value={fmtUptime(s.uptime_seconds ?? 0)} tone="primary" icon={Clock} testId="monitoring-sum-uptime" />
        <SummaryCard label="Logins hoje" value={`${a.login_success_24h ?? 0} ✓ · ${a.login_failed_24h ?? 0} ✗`} tone={a.login_failed_24h ? "warning" : "success"} icon={a.login_failed_24h ? ShieldX : ShieldCheck} testId="monitoring-sum-logins" />
      </div>

      {/* Services table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Serviços</h2>
          {lastAt && (
            <div className="text-xs text-muted-foreground">
              Última verificação: {lastAt.toLocaleTimeString("pt-BR")}
            </div>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Serviço</th>
              <th className="text-left px-4 py-3">Endereço</th>
              <th className="text-center px-4 py-3">Latência</th>
              <th className="text-center px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {services.map((svc, i) => {
              const Icon = KIND_ICON[svc.kind] || Activity;
              const online = svc.status === "online";
              return (
                <tr
                  key={`${svc.kind}-${svc.name}-${i}`}
                  data-testid={`monitoring-row-${svc.kind}-${i}`}
                  className="border-t border-border hover:bg-muted/30"
                >
                  <td className="px-4 py-3 flex items-center gap-2">
                    <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                      online ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive"
                    }`}>
                      <Icon className="w-4 h-4"/>
                    </span>
                    <div>
                      <div className="font-semibold">{svc.name}</div>
                      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{svc.kind}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{svc.detail || "—"}</td>
                  <td className="px-4 py-3 text-center">
                    {svc.latency_ms >= 0 ? (
                      <span className={`font-mono text-xs font-bold ${
                        svc.latency_ms < 200 ? "text-emerald-600 dark:text-emerald-400"
                        : svc.latency_ms < 800 ? "text-amber-600 dark:text-amber-400"
                        : "text-destructive"
                      }`}>{svc.latency_ms} ms</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      online ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive"
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500 animate-pulse" : "bg-destructive"}`}/>
                      {online ? "online" : "offline"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {services.length === 0 && !loading && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground text-sm">
                Nenhum serviço para monitorar ainda. Cadastre um servidor DirectAdmin em Servidores DA.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Activity */}
      <div className="mt-6 grid md:grid-cols-3 gap-3">
        <MiniStat label="Ações admin (24h)"    value={a.admin_actions_24h ?? 0} />
        <MiniStat label="Logins ok (24h)"      value={a.login_success_24h ?? 0} tone="success" />
        <MiniStat label="Logins falhados (24h)" value={a.login_failed_24h ?? 0} tone={a.login_failed_24h ? "warning" : "muted"} />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone = "primary", icon: Icon, testId }) {
  const toneClass = {
    primary: "text-primary bg-primary/10",
    success: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    danger:  "text-destructive bg-destructive/10",
    warning: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
    muted:   "text-muted-foreground bg-muted",
  }[tone];
  return (
    <div data-testid={testId} className="rounded-2xl border border-border bg-card p-5 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">{label}</div>
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${toneClass}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="font-display text-2xl font-bold">{value}</div>
    </div>
  );
}

function MiniStat({ label, value, tone = "muted" }) {
  const cls = {
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-display text-2xl font-bold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}
