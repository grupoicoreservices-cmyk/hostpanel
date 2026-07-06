import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Building2, X } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { ADMIN } from "@/lib/testIds";

const EMPTY = { nome: "", cnpj_cpf: "", email_responsavel: "", telefone: "", plano: "Starter", status: "ativo" };

export default function AdminEmpresas() {
  const [rows, setRows] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get("/empresas"); setRows(data); } catch (e) { toast.error("Falha ao listar"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/empresas", form);
      toast.success("Empresa criada");
      setShowForm(false); setForm(EMPTY); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!window.confirm("Remover esta empresa? Todos os domínios e contas relacionados serão excluídos.")) return;
    try { await api.delete(`/empresas/${id}`); toast.success("Removida"); load(); }
    catch (e) { toast.error("Falha ao remover"); }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Empresas</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie empresas/clientes SaaS.</p>
        </div>
        <button
          data-testid={ADMIN.addBtn}
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all"
        >
          <Plus className="w-4 h-4" /> Nova empresa
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">CNPJ/CPF</th>
              <th className="text-left px-4 py-3">Responsável</th>
              <th className="text-left px-4 py-3">Plano</th>
              <th className="text-center px-4 py-3">Domínios</th>
              <th className="text-center px-4 py-3">Contas</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`${ADMIN.rowPrefix}empresa-${r.id}`} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-primary"/><strong>{r.nome}</strong></td>
                <td className="px-4 py-3 text-muted-foreground">{r.cnpj_cpf || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.email_responsavel || "—"}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">{r.plano}</span></td>
                <td className="px-4 py-3 text-center">{r.dominios_count}</td>
                <td className="px-4 py-3 text-center">{r.contas_count}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.status === "ativo" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-slate-500/10 text-slate-500"}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    data-testid={`${ADMIN.deleteRow}empresa-${r.id}`}
                    onClick={() => del(r.id)}
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                    title="Remover"
                  ><Trash2 className="w-4 h-4"/></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">Nenhuma empresa cadastrada ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg voxyra-compose-anim">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Nova empresa</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-3">
              {[
                ["nome","Nome"],
                ["cnpj_cpf","CNPJ ou CPF"],
                ["email_responsavel","E-mail do responsável"],
                ["telefone","Telefone"],
                ["plano","Plano"],
              ].map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
                  <input
                    data-testid={`empresa-input-${k}`}
                    value={form[k] || ""}
                    onChange={e => setForm({ ...form, [k]: e.target.value })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </label>
              ))}
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
                <select
                  data-testid="empresa-input-status"
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </label>
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button data-testid={ADMIN.cancelBtn} onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button data-testid={ADMIN.saveBtn} disabled={saving || !form.nome} onClick={save} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 active:scale-[.98] disabled:opacity-60">
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
