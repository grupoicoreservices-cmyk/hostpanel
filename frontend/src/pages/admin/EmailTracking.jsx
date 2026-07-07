import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, RefreshCw, ArrowDownLeft, ArrowUpRight, CheckCircle2, XCircle, Clock, AlertTriangle, Mail, Info } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";

/**
 * Rastreamento de e-mails do domínio via DirectAdmin CMD_EMAIL_LOGS.
 *
 * Escopo: superadmin vê todos os domínios; empresa_admin só os do próprio empresa_id.
 *
 * Filtros: intervalo de datas, endereço (from/to), estado, direção. Colunas
 * espelham a tela nativa do DA (Direção/Estado/De/Para/Assunto/Tamanho/Data).
 */
export default function AdminEmailTracking() {
  const [domains, setDomains] = useState([]);
  const [domainId, setDomainId] = useState("");
  const [dateFrom, setDateFrom] = useState(defaultFrom());
  const [dateTo, setDateTo] = useState(defaultTo());
  const [address, setAddress] = useState("");
  const [state, setState] = useState("");
  const [direction, setDirection] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/dominios");
        const withDA = (data || []).filter((d) => d.directadmin_server_id);
        setDomains(withDA);
        if (withDA.length > 0) setDomainId(withDA[0].id);
      } catch {
        toast.error("Falha ao carregar domínios");
      }
    })();
  }, []);

  const search = useCallback(async () => {
    if (!domainId) { toast.error("Selecione um domínio"); return; }
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (dateFrom) params.date_from = toDABlockDate(dateFrom);
      if (dateTo) params.date_to = toDABlockDate(dateTo);
      if (address.trim()) params.address = address.trim();
      if (state) params.state = state;
      if (direction) params.direction = direction;
      const { data } = await api.get(`/dominios/${domainId}/email-logs`, { params });
      setRows(data.rows || []);
      if ((data.rows || []).length === 0) {
        toast.info("Nenhum registro encontrado nos filtros aplicados");
      }
    } catch (e) {
      const msg = formatApiErrorDetail(e.response?.data?.detail) || e.message;
      setError(msg);
      toast.error(msg);
      setRows([]);
    } finally { setLoading(false); }
  }, [domainId, dateFrom, dateTo, address, state, direction]);

  const stats = useMemo(() => {
    const total = rows.length;
    const delivered = rows.filter((r) => /delivered|entreg/i.test(r.state)).length;
    const bounced = rows.filter((r) => /bounce|falh/i.test(r.state)).length;
    const deferred = rows.filter((r) => /defer/i.test(r.state)).length;
    return { total, delivered, bounced, deferred };
  }, [rows]);

  return (
    <div className="space-y-6" data-testid="admin-email-tracking">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Rastreamento de e-mails</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Histórico de entrega, bounces e diferimentos por domínio — via DirectAdmin.
        </p>
      </header>

      {/* Filtros */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Domínio</label>
            <select
              data-testid="tracking-domain"
              value={domainId}
              onChange={(e) => setDomainId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {domains.length === 0 && <option value="">Nenhum domínio com DA</option>}
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">De (data)</label>
            <input
              data-testid="tracking-date-from"
              type="datetime-local"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Até (data)</label>
            <input
              data-testid="tracking-date-to"
              type="datetime-local"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Endereço</label>
            <input
              data-testid="tracking-address"
              type="text"
              placeholder="ex: fulano@..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Estado</label>
            <select
              data-testid="tracking-state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">Todos</option>
              <option value="delivered">Entregue</option>
              <option value="bounced">Rebateu (bounce)</option>
              <option value="deferred">Adiado (deferred)</option>
              <option value="frozen">Congelado</option>
              <option value="unknown">Desconhecido</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Direção</label>
            <select
              data-testid="tracking-direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">Todas</option>
              <option value="in">Recebidos</option>
              <option value="out">Enviados</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            data-testid="tracking-search-btn"
            onClick={search}
            disabled={loading || !domainId}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Procurar
          </button>
        </div>
      </div>

      {/* Stats */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total" value={stats.total} icon={Mail} tone="primary"/>
          <StatCard label="Entregues" value={stats.delivered} icon={CheckCircle2} tone="emerald"/>
          <StatCard label="Bounces" value={stats.bounced} icon={XCircle} tone="rose"/>
          <StatCard label="Adiados" value={stats.deferred} icon={Clock} tone="amber"/>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-sm p-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div><strong>Erro do DirectAdmin:</strong> {error}</div>
        </div>
      )}

      {/* Tabela */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="tracking-table">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Direção</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">De</th>
                <th className="px-3 py-2 text-left">Para</th>
                <th className="px-3 py-2 text-left">Assunto</th>
                <th className="px-3 py-2 text-right">Tamanho</th>
                <th className="px-3 py-2 text-left">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-muted/30" data-testid={`tracking-row-${i}`}>
                  <td className="px-3 py-2"><DirectionBadge dir={r.direction} /></td>
                  <td className="px-3 py-2"><StateBadge state={r.state} /></td>
                  <td className="px-3 py-2 font-mono text-[12px] truncate max-w-[220px]" title={r.from}>{r.from}</td>
                  <td className="px-3 py-2 font-mono text-[12px] truncate max-w-[220px]" title={r.to}>{r.to}</td>
                  <td className="px-3 py-2 truncate max-w-[320px]" title={r.subject}>{r.subject || <span className="text-muted-foreground italic">—</span>}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{r.size_text || fmtBytes(r.size)}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.date}</td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-muted-foreground text-sm">
                    <Info className="w-5 h-5 mx-auto mb-2 opacity-50" />
                    Ajuste os filtros e clique em <span className="font-semibold">Procurar</span> para carregar o histórico.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers UI ---------- */
function DirectionBadge({ dir }) {
  const d = (dir || "").toLowerCase();
  if (d.startsWith("in")) {
    return <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
      <ArrowDownLeft className="w-3.5 h-3.5" /> Entrada
    </span>;
  }
  return <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 text-xs font-semibold">
    <ArrowUpRight className="w-3.5 h-3.5" /> Saída
  </span>;
}

function StateBadge({ state }) {
  const s = (state || "").toLowerCase();
  const cfg = /delivered|entreg/i.test(s)
    ? { cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", label: "Entregue", icon: CheckCircle2 }
    : /bounce|falh/i.test(s)
    ? { cls: "bg-red-500/10 text-red-700 dark:text-red-400", label: "Bounce", icon: XCircle }
    : /defer/i.test(s)
    ? { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400", label: "Adiado", icon: Clock }
    : /froz/i.test(s)
    ? { cls: "bg-slate-500/10 text-slate-700 dark:text-slate-300", label: "Congelado", icon: AlertTriangle }
    : { cls: "bg-slate-500/10 text-slate-700 dark:text-slate-300", label: state || "—", icon: Info };
  const Icon = cfg.icon;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.cls}`}>
    <Icon className="w-3 h-3" /> {cfg.label}
  </span>;
}

function StatCard({ label, value, icon: Icon, tone }) {
  const toneCls = {
    primary: "text-primary bg-primary/10",
    emerald: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    rose: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  }[tone] || "text-primary bg-primary/10";
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${toneCls}`}>
        <Icon className="w-5 h-5"/>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">{label}</div>
        <div className="text-2xl font-display font-bold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
function pad(n) { return String(n).padStart(2, "0"); }

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 1); // 24h atrás
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultTo() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converte `2026-07-07T12:00` do datetime-local para `2026-07-07 12:00`
 *  no formato que o DA aceita em `period_start` / `period_end`. */
function toDABlockDate(v) {
  if (!v) return v;
  return v.replace("T", " ");
}

function fmtBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
