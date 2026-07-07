import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Globe, X, RefreshCw } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { ADMIN } from "@/lib/testIds";

export default function AdminDomains() {
  const [rows, setRows] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [servers, setServers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: "", empresa_id: "", directadmin_server_id: "" });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(null);

  const load = useCallback(async () => {
    try {
      const [d, e, s] = await Promise.all([
        api.get("/dominios"),
        api.get("/empresas"),
        api.get("/servers").catch(() => ({ data: [] })),
      ]);
      setRows(d.data); setEmpresas(e.data); setServers(s.data);
    } catch { toast.error("Falha ao carregar"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/dominios", {
        ...form,
        directadmin_server_id: form.directadmin_server_id || null,
      });
      if (data.contas_count > 0) {
        toast.success(`Domínio criado — ${data.contas_count} conta(s) importada(s) do DirectAdmin`);
      } else {
        toast.success("Domínio criado");
      }
      setShowForm(false); setForm({ nome: "", empresa_id: "", directadmin_server_id: "" }); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSaving(false); }
  };

  const doSync = async (id) => {
    setSyncing(id);
    try {
      const { data } = await api.post(`/dominios/${id}/sync`);
      toast.success(`${data.imported_or_updated} conta(s) sincronizada(s) do ${data.domain}`);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setSyncing(null); }
  };

  const del = async (id) => {
    if (!window.confirm("Remover este domínio e todas as contas relacionadas?")) return;
    try { await api.delete(`/dominios/${id}`); toast.success("Removido"); load(); }
    catch { toast.error("Falha"); }
  };

  const empresaName = (id) => empresas.find(e => e.id === id)?.nome || "—";
  const serverName = (id) => servers.find(s => s.id === id)?.nome || "—";

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Domínios</h1>
          <p className="text-sm text-muted-foreground mt-1">Vincule domínios às empresas e servidores DirectAdmin.</p>
        </div>
        <button
          data-testid={ADMIN.addBtn}
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all"
        ><Plus className="w-4 h-4"/> Novo domínio</button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Domínio</th>
              <th className="text-left px-4 py-3">Empresa</th>
              <th className="text-left px-4 py-3">Servidor DA</th>
              <th className="text-center px-4 py-3">Contas</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`${ADMIN.rowPrefix}domain-${r.id}`} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-3 flex items-center gap-2"><Globe className="w-4 h-4 text-primary"/><strong>{r.nome}</strong></td>
                <td className="px-4 py-3 text-muted-foreground">{empresaName(r.empresa_id)}</td>
                <td className="px-4 py-3 text-muted-foreground">{serverName(r.directadmin_server_id)}</td>
                <td className="px-4 py-3 text-center">{r.contas_count}</td>
                <td className="px-4 py-3 text-right flex justify-end gap-1">
                  {r.directadmin_server_id && (
                    <button
                      data-testid={`admin-sync-domain-${r.id}`}
                      onClick={() => doSync(r.id)}
                      disabled={syncing === r.id}
                      className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors disabled:opacity-50"
                      title="Sincronizar contas do DirectAdmin"
                    >
                      <RefreshCw className={`w-4 h-4 ${syncing === r.id ? "animate-spin" : ""}`}/>
                    </button>
                  )}
                  <button data-testid={`${ADMIN.deleteRow}domain-${r.id}`} onClick={() => del(r.id)} className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"><Trash2 className="w-4 h-4"/></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">Nenhum domínio cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg voxyra-compose-anim">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Novo domínio</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Domínio</span>
                <input
                  data-testid="domain-input-nome"
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                  placeholder="exemplo.com.br"
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Empresa</span>
                <select
                  data-testid="domain-input-empresa"
                  value={form.empresa_id}
                  onChange={e => setForm({ ...form, empresa_id: e.target.value })}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Selecione…</option>
                  {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Servidor DirectAdmin (opcional)</span>
                <select
                  data-testid="domain-input-server"
                  value={form.directadmin_server_id}
                  onChange={e => setForm({ ...form, directadmin_server_id: e.target.value })}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">— Nenhum —</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </label>
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button data-testid={ADMIN.cancelBtn} onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button data-testid={ADMIN.saveBtn} disabled={saving || !form.nome || !form.empresa_id} onClick={save} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Salvando…" : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
