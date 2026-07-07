import { useEffect, useState, useCallback, useMemo } from "react";
import { ShieldAlert, RefreshCw, Trash2, ShieldCheck, ChevronRight, AlertCircle, Search } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";

/** Painel admin de quarentena de spam.
 *  - Overview agregado por domínio/conta (contagens em tempo real via IMAP)
 *  - Drill-down por conta: listar spams, marcar não-spam (opc. whitelist), excluir em lote
 */
export default function SpamQuarantine() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null); // {account_id, email, domain}
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [checked, setChecked] = useState(new Set());
  const [q, setQ] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/spam/admin/overview");
      setOverview(data);
    } catch (e) {
      toast.error("Falha ao carregar overview");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (acc) => {
    if (!acc) return;
    setMsgLoading(true);
    setChecked(new Set());
    try {
      const { data } = await api.get(`/spam/admin/accounts/${acc.account_id}`);
      setMessages(data.messages || []);
    } catch (e) {
      toast.error("Falha ao carregar mensagens desta conta");
      setMessages([]);
    } finally {
      setMsgLoading(false);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (selectedAccount) loadMessages(selectedAccount); }, [selectedAccount, loadMessages]);

  const toggleAll = () => {
    if (checked.size === messages.length) setChecked(new Set());
    else setChecked(new Set(messages.map(m => m.uid)));
  };
  const toggleOne = (uid) => {
    const next = new Set(checked);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    setChecked(next);
  };

  const bulkNotSpam = async (addWhitelist) => {
    if (!selectedAccount || checked.size === 0) return;
    try {
      const { data } = await api.post(`/spam/admin/accounts/${selectedAccount.account_id}/not-spam`, {
        uids: Array.from(checked),
        add_whitelist: addWhitelist,
      });
      toast.success(`${data.moved} movido(s) para Entrada${addWhitelist && data.whitelisted ? ` — ${data.whitelisted} whitelist DA` : ""}`);
      setChecked(new Set());
      loadMessages(selectedAccount);
      loadOverview();
    } catch { toast.error("Falha ao marcar como não-spam"); }
  };

  const bulkDelete = async () => {
    if (!selectedAccount || checked.size === 0) return;
    if (!confirm(`Excluir ${checked.size} mensagem(ns) definitivamente?`)) return;
    try {
      const { data } = await api.delete(`/spam/admin/accounts/${selectedAccount.account_id}/messages`, {
        data: { uids: Array.from(checked) },
      });
      toast.success(`${data.deleted} mensagem(ns) excluída(s)`);
      setChecked(new Set());
      loadMessages(selectedAccount);
      loadOverview();
    } catch { toast.error("Falha ao excluir"); }
  };

  const filteredAccounts = useMemo(() => {
    if (!overview?.per_account) return [];
    const term = q.trim().toLowerCase();
    if (!term) return overview.per_account;
    return overview.per_account.filter(a =>
      a.email?.toLowerCase().includes(term) || a.domain?.toLowerCase().includes(term)
    );
  }, [overview, q]);

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto" data-testid="spam-quarantine-page">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-500" />
            <h1 className="font-display text-3xl font-bold tracking-tight">Quarentena de Spam</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Mensagens marcadas pelo SpamAssassin em cada conta hospedada. Ações são aplicadas via IMAP + DirectAdmin.
          </p>
        </div>
        <button
          data-testid="spam-refresh-btn"
          onClick={loadOverview}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Contas monitoradas" value={overview?.reachable ?? "—"} sub={`de ${overview?.total_accounts ?? 0}`} tone="blue"/>
        <StatCard label="Spams em quarentena" value={overview?.total_spam ?? "—"} tone="red"/>
        <StatCard label="Domínios afetados" value={overview?.per_domain?.filter(d => d.spam_count > 0).length ?? "—"} tone="amber"/>
        <StatCard label="Média por conta" value={overview?.reachable ? Math.round((overview.total_spam || 0) / overview.reachable) : "—"} tone="emerald"/>
      </div>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        {/* Accounts list */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col max-h-[75vh]">
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
              <input
                data-testid="spam-account-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filtrar por conta ou domínio…"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto voxyra-scroll">
            {loading && (
              <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>
            )}
            {!loading && filteredAccounts.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma conta com senha em cache. Peça aos usuários que façam login pelo webmail ao menos uma vez.
              </div>
            )}
            {filteredAccounts.map((a) => {
              const active = selectedAccount?.account_id === a.account_id;
              const hasError = !!a.error;
              return (
                <button
                  key={a.account_id}
                  data-testid={`spam-account-row-${a.account_id}`}
                  onClick={() => setSelectedAccount(a)}
                  className={`w-full text-left px-4 py-3 border-b border-border flex items-center gap-3 transition-colors ${
                    active ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-muted"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{a.email}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{a.domain}{hasError ? ` — ${a.error}` : ""}</div>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-md flex-shrink-0 ${
                    hasError ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
                    : (a.spam_count || 0) > 0 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  }`}>
                    {hasError ? "—" : a.spam_count}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0"/>
                </button>
              );
            })}
          </div>
        </div>

        {/* Messages pane */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col max-h-[75vh]">
          {!selectedAccount ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-10 text-center">
              <div>
                <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40"/>
                Selecione uma conta à esquerda para ver a quarentena
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-border flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">{selectedAccount.email}</div>
                  <div className="text-xs text-muted-foreground">
                    Pasta {selectedAccount.folder || "Junk"} • {messages.length} mensagens
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    data-testid="spam-select-all-btn"
                    onClick={toggleAll}
                    className="px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted transition-colors"
                  >
                    {checked.size === messages.length && messages.length > 0 ? "Limpar" : "Selecionar tudo"}
                  </button>
                  <button
                    data-testid="spam-bulk-not-spam-btn"
                    disabled={checked.size === 0}
                    onClick={() => bulkNotSpam(false)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-40 transition-colors"
                  >
                    <ShieldCheck className="w-3.5 h-3.5"/> Não é spam ({checked.size})
                  </button>
                  <button
                    data-testid="spam-bulk-not-spam-wl-btn"
                    disabled={checked.size === 0}
                    onClick={() => bulkNotSpam(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-40 transition-colors"
                  >
                    <ShieldCheck className="w-3.5 h-3.5"/> + Whitelist
                  </button>
                  <button
                    data-testid="spam-bulk-delete-btn"
                    disabled={checked.size === 0}
                    onClick={bulkDelete}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-destructive text-destructive text-[11px] font-semibold hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5"/> Excluir ({checked.size})
                  </button>
                  <button
                    onClick={() => loadMessages(selectedAccount)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                    title="Atualizar"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${msgLoading ? "animate-spin" : ""}`}/>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto voxyra-scroll">
                {msgLoading && messages.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">Carregando mensagens…</div>
                )}
                {!msgLoading && messages.length === 0 && (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-emerald-500/60"/>
                    Sem mensagens em quarentena. 
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card border-b border-border text-[11px] uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="p-2 w-8"></th>
                      <th className="p-2 text-left">Remetente</th>
                      <th className="p-2 text-left">Assunto</th>
                      <th className="p-2 text-left w-24">Score</th>
                      <th className="p-2 text-left w-32">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map((m) => (
                      <tr
                        key={m.uid}
                        data-testid={`spam-msg-row-${m.uid}`}
                        className={`border-b border-border hover:bg-muted/60 transition-colors ${checked.has(m.uid) ? "bg-primary/5" : ""}`}
                      >
                        <td className="p-2">
                          <input
                            data-testid={`spam-msg-check-${m.uid}`}
                            type="checkbox"
                            checked={checked.has(m.uid)}
                            onChange={() => toggleOne(m.uid)}
                            className="w-4 h-4 rounded border-border"
                          />
                        </td>
                        <td className="p-2 min-w-0">
                          <div className="truncate max-w-[220px] text-xs font-semibold">{m.from_name || m.from_addr}</div>
                          <div className="truncate max-w-[220px] text-[11px] text-muted-foreground">{m.from_addr}</div>
                        </td>
                        <td className="p-2 min-w-0">
                          <div className="truncate max-w-[420px]">{m.subject}</div>
                        </td>
                        <td className="p-2">
                          {typeof m.spam_score === "number" ? (
                            <span className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-bold ${
                              m.spam_score >= 10 ? "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100"
                              : m.spam_score >= 5 ? "bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-100"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
                            }`}>
                              {m.spam_score.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(m.date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, tone = "blue" }) {
  const toneClass = {
    blue: "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30",
    red: "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30",
    amber: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30",
    emerald: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30",
  }[tone];
  const valueTone = {
    blue: "text-blue-700 dark:text-blue-300",
    red: "text-red-700 dark:text-red-300",
    amber: "text-amber-700 dark:text-amber-300",
    emerald: "text-emerald-700 dark:text-emerald-300",
  }[tone];
  return (
    <div className={`rounded-2xl border p-5 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</div>
      <div className={`mt-2 font-display text-3xl font-bold tracking-tight ${valueTone}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function formatDate(str) {
  if (!str) return "";
  try {
    const d = new Date(str);
    if (isNaN(d)) return String(str).slice(0, 16);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return String(str).slice(0, 16); }
}
