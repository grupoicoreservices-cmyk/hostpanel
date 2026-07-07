import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Mail, X, KeyRound, HardDrive, PauseCircle, PlayCircle, RefreshCw } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { ADMIN } from "@/lib/testIds";

export default function AdminAccounts() {
  const [rows, setRows] = useState([]);
  const [domains, setDomains] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "", dominio_id: "", empresa_id: "", quota_mb: 1024, password: "" });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pwdModal, setPwdModal] = useState(null); // {id, email, password, confirm}
  const [quotaModal, setQuotaModal] = useState(null); // {id, email, quota_mb}

  const load = useCallback(async () => {
    try {
      const [a, d] = await Promise.all([api.get("/contas"), api.get("/dominios")]);
      setRows(a.data); setDomains(d.data);
    } catch { toast.error("Falha ao carregar"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onDomainChange = (id) => {
    const d = domains.find(x => x.id === id);
    setForm(f => ({ ...f, dominio_id: id, empresa_id: d?.empresa_id || "" }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/contas", { ...form, quota_mb: Number(form.quota_mb) });
      toast.success("Conta criada");
      setShowForm(false); setForm({ email: "", dominio_id: "", empresa_id: "", quota_mb: 1024, password: "" }); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSaving(false); }
  };

  const patch = async (id, upd) => {
    try { await api.patch(`/contas/${id}`, upd); toast.success("Atualizada"); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  const del = async (id) => {
    if (!window.confirm("Excluir esta conta de e-mail? Removerá também no DirectAdmin.")) return;
    try { await api.delete(`/contas/${id}`); toast.success("Removida"); load(); }
    catch { toast.error("Falha"); }
  };

  const domainName = (id) => domains.find(d => d.id === id)?.nome || "—";

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Contas de e-mail</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Contas provisionadas via DirectAdmin ou registradas automaticamente pelo webmail (bypass login).
            Ajuste quota, senha e status.
          </p>
        </div>
        <button
          data-testid="admin-refresh-contas"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 font-semibold text-sm hover:bg-muted transition-all"
        >
          <RefreshCw className="w-4 h-4"/> Atualizar
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">E-mail</th>
              <th className="text-left px-4 py-3">Domínio</th>
              <th className="text-center px-4 py-3">Quota (MB)</th>
              <th className="text-center px-4 py-3">Uso</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`${ADMIN.rowPrefix}account-${r.id}`} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-3 flex items-center gap-2"><Mail className="w-4 h-4 text-primary"/><strong>{r.email}</strong></td>
                <td className="px-4 py-3 text-muted-foreground">{domainName(r.dominio_id)}</td>
                <td className="px-4 py-3 text-center">{r.quota_mb}</td>
                <td className="px-4 py-3 text-center">{Math.round((r.used_mb || 0) * 10) / 10}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    r.status === "ativo" ? "bg-emerald-500/10 text-emerald-600" : "bg-slate-500/10 text-slate-500"
                  }`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-right flex justify-end gap-1">
                  <button
                    data-testid={`account-password-${r.id}`}
                    onClick={() => setPwdModal({ id: r.id, email: r.email, password: "", confirm: "" })}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                    title="Resetar senha"
                  ><KeyRound className="w-4 h-4"/></button>
                  <button
                    data-testid={`account-quota-btn-${r.id}`}
                    onClick={() => setQuotaModal({ id: r.id, email: r.email, quota_mb: r.quota_mb })}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                    title="Ajustar quota"
                  ><HardDrive className="w-4 h-4"/></button>
                  <button
                    data-testid={`account-status-${r.id}`}
                    onClick={() => patch(r.id, { status: r.status === "ativo" ? "suspenso" : "ativo" })}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                    title="Suspender/Ativar"
                  >{r.status === "ativo" ? <PauseCircle className="w-4 h-4"/> : <PlayCircle className="w-4 h-4"/>}</button>
                  <button
                    data-testid={`${ADMIN.deleteRow}account-${r.id}`}
                    onClick={() => del(r.id)}
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"
                  ><Trash2 className="w-4 h-4"/></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Nenhuma conta cadastrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg voxyra-compose-anim">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Nova conta de e-mail</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Domínio</span>
                <select
                  data-testid="account-input-dominio"
                  value={form.dominio_id}
                  onChange={e => onDomainChange(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Selecione…</option>
                  {domains.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">E-mail completo</span>
                <input
                  data-testid="account-input-email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="usuario@dominio.com.br"
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Senha</span>
                  <input
                    data-testid="account-input-password"
                    type="password"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quota (MB)</span>
                  <input
                    data-testid="account-input-quota"
                    type="number"
                    value={form.quota_mb}
                    onChange={e => setForm({ ...form, quota_mb: e.target.value })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </label>
              </div>
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button data-testid={ADMIN.cancelBtn} onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button data-testid={ADMIN.saveBtn} disabled={saving || !form.email || !form.password || !form.dominio_id} onClick={save} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Salvando…" : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Resetar senha */}
      {pwdModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm">
            <div className="p-5 border-b border-border flex items-center gap-2">
              <KeyRound className="w-4 h-4"/>
              <h2 className="font-display text-lg font-bold">Resetar senha da caixa</h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-muted-foreground">
                Nova senha para <strong>{pwdModal.email}</strong>. Será aplicada no DirectAdmin e no cache local do webmail.
              </p>
              <input
                data-testid="account-new-password-input"
                type="password"
                autoFocus
                placeholder="Nova senha (mín. 6 caracteres)"
                value={pwdModal.password}
                onChange={e => setPwdModal({ ...pwdModal, password: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <input
                data-testid="account-confirm-password-input"
                type="password"
                placeholder="Confirmar nova senha"
                value={pwdModal.confirm}
                onChange={e => setPwdModal({ ...pwdModal, confirm: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {pwdModal.password && pwdModal.confirm && pwdModal.password !== pwdModal.confirm && (
                <div className="text-xs text-destructive">As senhas não conferem.</div>
              )}
              {pwdModal.password && pwdModal.password.length < 6 && (
                <div className="text-xs text-destructive">Mínimo 6 caracteres.</div>
              )}
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button
                data-testid="account-pwd-cancel"
                onClick={() => setPwdModal(null)}
                className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted"
              >Cancelar</button>
              <button
                data-testid="account-pwd-submit"
                disabled={
                  saving
                  || pwdModal.password.length < 6
                  || pwdModal.password !== pwdModal.confirm
                }
                onClick={async () => {
                  setSaving(true);
                  try {
                    await api.patch(`/contas/${pwdModal.id}`, { password: pwdModal.password });
                    toast.success("Senha redefinida no DirectAdmin");
                    setPwdModal(null);
                    load();
                  } catch (e) {
                    toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
                  } finally { setSaving(false); }
                }}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
              >{saving ? "Salvando…" : "Redefinir"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ajustar quota */}
      {quotaModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm">
            <div className="p-5 border-b border-border flex items-center gap-2">
              <HardDrive className="w-4 h-4"/>
              <h2 className="font-display text-lg font-bold">Ajustar quota</h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-muted-foreground">
                Nova quota em MB para <strong>{quotaModal.email}</strong>.
              </p>
              <input
                data-testid="account-new-quota-input"
                type="number"
                min="10"
                autoFocus
                value={quotaModal.quota_mb}
                onChange={e => setQuotaModal({ ...quotaModal, quota_mb: Number(e.target.value) })}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button onClick={() => setQuotaModal(null)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button
                data-testid="account-quota-submit"
                disabled={saving || quotaModal.quota_mb < 10}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await api.patch(`/contas/${quotaModal.id}`, { quota_mb: quotaModal.quota_mb });
                    toast.success("Quota atualizada");
                    setQuotaModal(null);
                    load();
                  } catch (e) {
                    toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
                  } finally { setSaving(false); }
                }}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
              >{saving ? "Salvando…" : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
