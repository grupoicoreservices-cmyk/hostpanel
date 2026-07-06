import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X, UserCircle2 } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { ADMIN } from "@/lib/testIds";
import { useAuth } from "@/context/AuthContext";

export default function AdminUsers() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "usuario_final", empresa_id: "", email_account_id: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, e, a] = await Promise.all([
        api.get("/users"),
        api.get("/empresas"),
        api.get("/contas"),
      ]);
      setRows(u.data); setEmpresas(e.data); setAccounts(a.data);
    } catch { toast.error("Falha ao carregar"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/users", {
        ...form,
        empresa_id: form.empresa_id || null,
        email_account_id: form.email_account_id || null,
      });
      toast.success("Usuário criado");
      setShowForm(false);
      setForm({ email: "", password: "", name: "", role: "usuario_final", empresa_id: "", email_account_id: "" });
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSaving(false); }
  };

  const empresaName = (id) => empresas.find(e => e.id === id)?.nome || "—";

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground mt-1">Crie administradores de empresa e usuários finais do webmail.</p>
        </div>
        <button data-testid={ADMIN.addBtn} onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all">
          <Plus className="w-4 h-4"/> Novo usuário
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">E-mail</th>
              <th className="text-left px-4 py-3">Perfil</th>
              <th className="text-left px-4 py-3">Empresa</th>
              <th className="text-center px-4 py-3">Ativo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`${ADMIN.rowPrefix}user-${r.id}`} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-3 flex items-center gap-2"><UserCircle2 className="w-4 h-4 text-primary"/><strong>{r.name}</strong></td>
                <td className="px-4 py-3 text-muted-foreground">{r.email}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">{r.role}</span></td>
                <td className="px-4 py-3 text-muted-foreground">{empresaName(r.empresa_id)}</td>
                <td className="px-4 py-3 text-center">{r.is_active ? "sim" : "não"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">Nenhum usuário cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg voxyra-compose-anim">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Novo usuário</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-3">
              {[
                ["name","Nome"],
                ["email","E-mail"],
                ["password","Senha"],
              ].map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
                  <input
                    data-testid={`user-input-${k}`}
                    type={k === "password" ? "password" : "text"}
                    value={form[k]}
                    onChange={e => setForm({ ...form, [k]: e.target.value })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </label>
              ))}
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Perfil</span>
                <select
                  data-testid="user-input-role"
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="usuario_final">Usuário final (webmail)</option>
                  <option value="empresa_admin">Admin da empresa</option>
                  {user?.role === "superadmin" && <option value="superadmin">Superadmin</option>}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Empresa</span>
                <select
                  data-testid="user-input-empresa"
                  value={form.empresa_id}
                  onChange={e => setForm({ ...form, empresa_id: e.target.value })}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">— Nenhuma —</option>
                  {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </label>
              {form.role === "usuario_final" && (
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conta de e-mail vinculada</span>
                  <select
                    data-testid="user-input-account"
                    value={form.email_account_id}
                    onChange={e => setForm({ ...form, email_account_id: e.target.value })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="">— Nenhuma —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button data-testid={ADMIN.cancelBtn} onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button data-testid={ADMIN.saveBtn} disabled={saving || !form.name || !form.email || !form.password} onClick={save} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Salvando…" : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
