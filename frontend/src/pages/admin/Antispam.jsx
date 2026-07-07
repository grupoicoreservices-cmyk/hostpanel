import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { ShieldAlert, ShieldCheck, ShieldX, RefreshCw, Settings, X, Plus, Trash2, Circle, HelpCircle } from "lucide-react";
import { ADMIN } from "@/lib/testIds";

export default function AdminAntispam() {
  const [accounts, setAccounts] = useState([]);
  const [domains, setDomains] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState(null);
  const [lists, setLists] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a, d] = await Promise.all([
        api.get("/antispam/summary"),
        api.get("/antispam/accounts"),
        api.get("/dominios"),
      ]);
      setSummary(s.data); setAccounts(a.data); setDomains(d.data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const syncAll = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post("/antispam/sync");
      toast.success(`${data.accounts_synced}/${data.accounts_total} contas sincronizadas em ${data.domains} domínio(s)`);
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSyncing(false); }
  };

  const syncOneDomain = async (dominio_id) => {
    try {
      const { data } = await api.post(`/antispam/sync/${dominio_id}`);
      toast.success(`${data.synced}/${data.total} contas sincronizadas em ${data.domain}`);
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  const openEditor = async (acc) => {
    try {
      const { data } = await api.get(`/antispam/accounts/${acc.id}`);
      setEditing({ ...acc, ...data });
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  const openLists = async (acc) => {
    try {
      const [bl, wl] = await Promise.all([
        api.get(`/antispam/accounts/${acc.id}/blacklist`),
        api.get(`/antispam/accounts/${acc.id}/whitelist`),
      ]);
      setLists({ acc, blacklist: bl.data.addresses || [], whitelist: wl.data.addresses || [], newAddr: "", target: "blacklist" });
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  const domainName = (id) => domains.find(d => d.id === id)?.nome || "—";

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
          <h1 className="font-display text-4xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-8 h-8 text-red-500"/> Antispam Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurações SpamAssassin por conta, sincronizadas com o DirectAdmin.
          </p>
        </div>
        <button
          data-testid="antispam-sync-all"
          onClick={syncAll}
          disabled={syncing}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`}/> Sincronizar tudo
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Contas totais"    value={summary.total_accounts ?? 0}    icon={Circle} tone="muted" testId="antispam-stat-total"/>
        <StatCard label="Antispam ativo"   value={summary.enabled_accounts ?? 0}  icon={ShieldCheck} tone="success" testId="antispam-stat-enabled"/>
        <StatCard label="Antispam inativo" value={summary.disabled_accounts ?? 0} icon={ShieldX} tone="danger" testId="antispam-stat-disabled"/>
        <StatCard label="Nunca sincron."   value={summary.unknown_accounts ?? 0}  icon={HelpCircle} tone="warning" testId="antispam-stat-unknown"/>
      </div>

      {/* Accounts table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Conta</th>
              <th className="text-left px-4 py-3">Domínio</th>
              <th className="text-center px-4 py-3">Antispam</th>
              <th className="text-center px-4 py-3">Kill score</th>
              <th className="text-center px-4 py-3">Tag</th>
              <th className="text-center px-4 py-3">Última sync</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => {
              const domain = domains.find(d => d.id === a.dominio_id);
              const canSync = domain && domain.directadmin_server_id;
              return (
                <tr key={a.id} data-testid={`antispam-row-${a.id}`} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{a.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">{domainName(a.dominio_id)}</td>
                  <td className="px-4 py-3 text-center">
                    {a.spam_enabled === true && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                        <ShieldCheck className="w-3 h-3"/> ativo
                      </span>
                    )}
                    {a.spam_enabled === false && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-semibold">
                        <ShieldX className="w-3 h-3"/> inativo
                      </span>
                    )}
                    {a.spam_enabled == null && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{a.kill_score ?? "—"}</td>
                  <td className="px-4 py-3 text-center font-mono text-[11px]">{a.subject_tag || "—"}</td>
                  <td className="px-4 py-3 text-center text-[11px] text-muted-foreground">
                    {a.last_sync ? new Date(a.last_sync).toLocaleString("pt-BR") : "nunca"}
                  </td>
                  <td className="px-4 py-3 text-right flex justify-end gap-1">
                    {canSync && (
                      <>
                        <button
                          data-testid={`antispam-edit-${a.id}`}
                          onClick={() => openEditor(a)}
                          className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors"
                          title="Editar config"
                        ><Settings className="w-4 h-4"/></button>
                        <button
                          data-testid={`antispam-lists-${a.id}`}
                          onClick={() => openLists(a)}
                          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
                          title="Whitelist / Blacklist"
                        ><ShieldAlert className="w-4 h-4"/></button>
                        <button
                          data-testid={`antispam-sync-${a.id}`}
                          onClick={() => syncOneDomain(a.dominio_id)}
                          className="p-1.5 rounded-md hover:bg-emerald-500/10 text-emerald-600 transition-colors"
                          title="Ressincronizar domínio"
                        ><RefreshCw className="w-4 h-4"/></button>
                      </>
                    )}
                    {!canSync && (
                      <span className="text-[11px] text-muted-foreground italic">sem servidor DA</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">
                Nenhuma conta de e-mail cadastrada. Cadastre em <em>Contas de e-mail</em>.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && <EditorModal editing={editing} setEditing={setEditing} onSaved={load} />}
      {lists && <ListsModal lists={lists} setLists={setLists} onChanged={load} />}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone = "muted", testId }) {
  const toneCls = {
    muted: "text-muted-foreground bg-muted",
    success: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    danger:  "text-destructive bg-destructive/10",
    warning: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  }[tone];
  return (
    <div data-testid={testId} className="rounded-2xl border border-border bg-card p-5 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">{label}</div>
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${toneCls}`}>
          <Icon className="w-4 h-4"/>
        </div>
      </div>
      <div className="font-display text-3xl font-bold">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</div>
    </div>
  );
}

function EditorModal({ editing, setEditing, onSaved }) {
  const [form, setForm] = useState({
    enabled: editing.enabled ?? false,
    kill_score: editing.kill_score ?? 5,
    subject_tag: editing.subject_tag ?? "***SPAM***",
    use_bayes: editing.use_bayes ?? true,
    use_razor: editing.use_razor ?? false,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/antispam/accounts/${editing.id}`, { ...form, kill_score: Number(form.kill_score) });
      toast.success("Configuração atualizada");
      setEditing(null);
      onSaved();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg voxyra-compose-anim">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Config SpamAssassin</h2>
            <div className="text-xs text-muted-foreground font-mono mt-0.5">{editing.email}</div>
          </div>
          <button onClick={() => setEditing(null)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="flex items-center justify-between p-3 rounded-xl border border-border">
            <div>
              <div className="font-semibold text-sm">Antispam ativo</div>
              <div className="text-xs text-muted-foreground">Habilita o SpamAssassin para esta conta</div>
            </div>
            <input
              type="checkbox"
              data-testid="antispam-form-enabled"
              checked={form.enabled}
              onChange={e => setForm({ ...form, enabled: e.target.checked })}
              className="w-5 h-5"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kill score (default 5.0)</span>
            <input
              data-testid="antispam-form-kill"
              type="number" step="0.1" min="1" max="20"
              value={form.kill_score}
              onChange={e => setForm({ ...form, kill_score: e.target.value })}
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="text-[11px] text-muted-foreground mt-1">Quanto menor, mais rigoroso. 5.0 é o padrão.</div>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subject tag</span>
            <input
              data-testid="antispam-form-tag"
              value={form.subject_tag}
              onChange={e => setForm({ ...form, subject_tag: e.target.value })}
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 p-3 rounded-xl border border-border">
              <input
                type="checkbox"
                data-testid="antispam-form-bayes"
                checked={form.use_bayes}
                onChange={e => setForm({ ...form, use_bayes: e.target.checked })}
              />
              <span className="text-sm">Bayes learning</span>
            </label>
            <label className="flex items-center gap-2 p-3 rounded-xl border border-border">
              <input
                type="checkbox"
                data-testid="antispam-form-razor"
                checked={form.use_razor}
                onChange={e => setForm({ ...form, use_razor: e.target.checked })}
              />
              <span className="text-sm">Razor</span>
            </label>
          </div>
        </div>
        <div className="p-5 border-t border-border flex justify-end gap-2">
          <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
          <button
            data-testid="antispam-form-save"
            disabled={saving}
            onClick={save}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
          >{saving ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

function ListsModal({ lists, setLists, onChanged }) {
  const { acc, target } = lists;
  const items = lists[target] || [];

  const add = async () => {
    const addr = (lists.newAddr || "").trim();
    if (!addr) return;
    try {
      await api.post(`/antispam/accounts/${acc.id}/${target}`, { address: addr });
      toast.success(`Adicionado à ${target}`);
      const { data } = await api.get(`/antispam/accounts/${acc.id}/${target}`);
      setLists({ ...lists, [target]: data.addresses || [], newAddr: "" });
      onChanged();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  const remove = async (address) => {
    try {
      await api.delete(`/antispam/accounts/${acc.id}/${target}`, { params: { address } });
      const { data } = await api.get(`/antispam/accounts/${acc.id}/${target}`);
      setLists({ ...lists, [target]: data.addresses || [] });
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg voxyra-compose-anim">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Listas de {target === "blacklist" ? "bloqueio" : "aprovação"}</h2>
            <div className="text-xs text-muted-foreground font-mono mt-0.5">{acc.email}</div>
          </div>
          <button onClick={() => setLists(null)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
        </div>

        <div className="p-5">
          <div className="flex gap-2 border-b border-border mb-3">
            {["blacklist", "whitelist"].map(t => (
              <button
                key={t}
                data-testid={`antispam-tab-${t}`}
                onClick={() => setLists({ ...lists, target: t })}
                className={`px-4 py-2 text-sm font-semibold border-b-2 ${
                  target === t ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                {t === "blacklist" ? "Blacklist" : "Whitelist"}
              </button>
            ))}
          </div>

          <div className="flex gap-2 mb-3">
            <input
              data-testid="antispam-list-add-input"
              value={lists.newAddr || ""}
              onChange={e => setLists({ ...lists, newAddr: e.target.value })}
              placeholder="endereço@exemplo.com"
              className="flex-1 px-3 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              data-testid="antispam-list-add"
              onClick={add}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700"
            ><Plus className="w-4 h-4"/> Adicionar</button>
          </div>

          <div className="max-h-64 overflow-y-auto voxyra-scroll">
            {items.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-8">Lista vazia</div>
            )}
            {items.map(addr => (
              <div key={addr} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50">
                <span className="font-mono text-sm">{addr}</span>
                <button
                  onClick={() => remove(addr)}
                  className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"
                >
                  <Trash2 className="w-4 h-4"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
