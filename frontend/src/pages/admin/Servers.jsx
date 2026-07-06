import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Server, X, Zap } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { ADMIN } from "@/lib/testIds";

const EMPTY = { nome: "", url: "", port: 2222, api_user: "", api_token: "", ssl: true };

export default function AdminServers() {
  const [rows, setRows] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get("/servers"); setRows(data); } catch { toast.error("Falha ao listar"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/servers", { ...form, port: Number(form.port) });
      toast.success("Servidor cadastrado");
      setShowForm(false); setForm(EMPTY); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSaving(false); }
  };

  const test = async (id) => {
    try {
      const { data } = await api.post(`/servers/${id}/test`);
      toast[data.status === "online" ? "success" : "error"](`Status: ${data.status}`);
      load();
    } catch { toast.error("Falha no teste"); }
  };

  const del = async (id) => {
    if (!window.confirm("Remover este servidor?")) return;
    try { await api.delete(`/servers/${id}`); toast.success("Removido"); load(); }
    catch { toast.error("Falha ao remover"); }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Servidores DirectAdmin</h1>
          <p className="text-sm text-muted-foreground mt-1">Cadastre e monitore os servidores DirectAdmin do ambiente.</p>
        </div>
        <button
          data-testid={ADMIN.addBtn}
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all"
        ><Plus className="w-4 h-4"/> Novo servidor</button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">URL</th>
              <th className="text-left px-4 py-3">Porta</th>
              <th className="text-left px-4 py-3">API User</th>
              <th className="text-left px-4 py-3">SSL</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`${ADMIN.rowPrefix}server-${r.id}`} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-3 flex items-center gap-2"><Server className="w-4 h-4 text-primary"/><strong>{r.nome}</strong></td>
                <td className="px-4 py-3 text-muted-foreground">{r.url}</td>
                <td className="px-4 py-3">{r.port}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.api_user}</td>
                <td className="px-4 py-3">{r.ssl ? "Ativo" : "Inativo"}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    r.status === "online" ? "bg-emerald-500/10 text-emerald-600" :
                    r.status === "offline" ? "bg-destructive/10 text-destructive" :
                    "bg-slate-500/10 text-slate-500"
                  }`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-right flex justify-end gap-1">
                  <button
                    data-testid={`${ADMIN.testServerBtn}${r.id}`}
                    onClick={() => test(r.id)}
                    className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors"
                    title="Testar conexão"
                  ><Zap className="w-4 h-4"/></button>
                  <button
                    data-testid={`${ADMIN.deleteRow}server-${r.id}`}
                    onClick={() => del(r.id)}
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                  ><Trash2 className="w-4 h-4"/></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Nenhum servidor cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg voxyra-compose-anim">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Novo servidor DirectAdmin</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-3">
              {[
                ["nome","Nome amigável"],
                ["url","URL (ex: server01.voxyra.net.br)"],
                ["port","Porta"],
                ["api_user","Usuário API"],
                ["api_token","Chave / Token API"],
              ].map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
                  <input
                    data-testid={`server-input-${k}`}
                    type={k === "api_token" ? "password" : k === "port" ? "number" : "text"}
                    value={form[k] ?? ""}
                    onChange={e => setForm({ ...form, [k]: e.target.value })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  data-testid="server-input-ssl"
                  checked={form.ssl}
                  onChange={e => setForm({ ...form, ssl: e.target.checked })}
                />
                <span className="text-sm">SSL ativo</span>
              </label>
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button data-testid={ADMIN.cancelBtn} onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button data-testid={ADMIN.saveBtn} disabled={saving || !form.nome || !form.url} onClick={save} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Salvando…" : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
