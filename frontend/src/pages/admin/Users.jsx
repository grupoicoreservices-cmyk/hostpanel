import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, X, UserCircle2, ShieldCheck, Briefcase, User, Search, Pencil, KeyRound, Trash2, Power } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { ADMIN } from "@/lib/testIds";
import { useAuth } from "@/context/AuthContext";
import { roleLabel, roleBadgeClass, allowedRolesFor, ROLE_ORDER, ROLE_DESCRIPTIONS } from "@/lib/roles";

const ROLE_ICONS = {
  superadmin: ShieldCheck,
  empresa_admin: Briefcase,
  usuario_final: User,
};

const EMPTY_FORM = { email: "", password: "", name: "", role: "usuario_final", empresa_id: "", email_account_id: "" };

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);         // objeto sendo editado (ou null pra criar)
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [pwdModal, setPwdModal] = useState(null);       // {id, email, password}
  const [confirmDelete, setConfirmDelete] = useState(null); // objeto

  // Filtros
  const [q, setQ] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterEmpresa, setFilterEmpresa] = useState("all");

  const load = useCallback(async () => {
    try {
      const [u, e, a] = await Promise.all([
        api.get("/users"),
        api.get("/empresas"),
        api.get("/contas"),
      ]);
      setRows(u.data);
      setEmpresas(e.data);
      setAccounts(a.data);
    } catch { toast.error("Falha ao carregar"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const empresaName = (id) => empresas.find(e => e.id === id)?.nome || "—";
  const allowedRoles = useMemo(() => allowedRolesFor(currentUser?.role), [currentUser?.role]);

  const counts = useMemo(() => {
    const c = { superadmin: 0, empresa_admin: 0, usuario_final: 0, inactive: 0 };
    rows.forEach(r => {
      c[r.role] = (c[r.role] || 0) + 1;
      if (!r.is_active) c.inactive++;
    });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(r => {
      if (filterRole !== "all" && r.role !== filterRole) return false;
      if (filterEmpresa !== "all" && (r.empresa_id || "") !== (filterEmpresa === "none" ? "" : filterEmpresa)) return false;
      if (term && !`${r.name} ${r.email}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, q, filterRole, filterEmpresa]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, role: allowedRoles[allowedRoles.length - 1] });
    setShowForm(true);
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      email: row.email, password: "", name: row.name || "",
      role: row.role, empresa_id: row.empresa_id || "",
      email_account_id: row.email_account_id || "",
    });
    setShowForm(true);
  };

  const submit = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/users/${editing.id}`, {
          name: form.name || undefined,
          role: form.role || undefined,
          empresa_id: form.empresa_id || null,
          email_account_id: form.email_account_id || null,
        });
        toast.success("Usuário atualizado");
      } else {
        await api.post("/users", {
          ...form,
          empresa_id: form.empresa_id || null,
          email_account_id: form.email_account_id || null,
        });
        toast.success("Usuário criado");
      }
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setSaving(false); }
  };

  const toggleActive = async (row) => {
    try {
      await api.patch(`/users/${row.id}`, { is_active: !row.is_active });
      toast.success(row.is_active ? "Usuário desativado" : "Usuário ativado");
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha");
    }
  };

  const resetPassword = async () => {
    if (!pwdModal) return;
    if ((pwdModal.password || "").length < 6) {
      toast.error("Senha muito curta (mínimo 6 caracteres)");
      return;
    }
    try {
      await api.post(`/users/${pwdModal.id}/reset-password`, { password: pwdModal.password });
      toast.success("Senha redefinida");
      setPwdModal(null);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha");
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api.delete(`/users/${confirmDelete.id}`);
      toast.success("Usuário excluído");
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha");
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto" data-testid="admin-users-page">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Usuários & Permissões</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie Super Admins, Gerentes e Usuários do webmail.</p>
        </div>
        <button
          data-testid={ADMIN.addBtn}
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all"
        >
          <Plus className="w-4 h-4"/> Novo usuário
        </button>
      </div>

      {/* Stat cards por perfil */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {ROLE_ORDER.map((role) => {
          const Icon = ROLE_ICONS[role];
          return (
            <div
              key={role}
              data-testid={`user-stat-${role}`}
              className={`rounded-2xl border p-5 bg-card ${filterRole === role ? "ring-2 ring-primary" : ""} cursor-pointer transition-all hover:shadow-md`}
              onClick={() => setFilterRole(filterRole === role ? "all" : role)}
              title={ROLE_DESCRIPTIONS[role]}
            >
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${roleBadgeClass(role)}`}>
                  <Icon className="w-5 h-5"/>
                </div>
                <div className="flex-1">
                  <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">{roleLabel(role)}</div>
                  <div className="font-display text-2xl font-bold">{counts[role] || 0}</div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="rounded-2xl border p-5 bg-card">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              <Power className="w-5 h-5"/>
            </div>
            <div className="flex-1">
              <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Inativos</div>
              <div className="font-display text-2xl font-bold">{counts.inactive}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex-1 relative min-w-[240px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <input
            data-testid="users-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <select
          data-testid="users-filter-role"
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="px-3 py-2 rounded-lg bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="all">Todos os perfis</option>
          {ROLE_ORDER.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        {currentUser?.role === "superadmin" && (
          <select
            data-testid="users-filter-empresa"
            value={filterEmpresa}
            onChange={(e) => setFilterEmpresa(e.target.value)}
            className="px-3 py-2 rounded-lg bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">Todas as empresas</option>
            <option value="none">— Sem empresa —</option>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        )}
      </div>

      {/* Tabela */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">E-mail</th>
              <th className="text-left px-4 py-3">Perfil</th>
              <th className="text-left px-4 py-3">Empresa</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const Icon = ROLE_ICONS[r.role] || UserCircle2;
              const isMe = r.id === currentUser?.id;
              const canManageSuper = currentUser?.role === "superadmin";
              const canManageRow = canManageSuper || r.role !== "superadmin";
              return (
                <tr
                  key={r.id}
                  data-testid={`${ADMIN.rowPrefix}user-${r.id}`}
                  className="border-t border-border hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-primary flex-shrink-0"/>
                      <strong>{r.name}</strong>
                      {isMe && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold">VOCÊ</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.email}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${roleBadgeClass(r.role)}`}>
                      {roleLabel(r.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{empresaName(r.empresa_id)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${r.is_active ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"}`}>
                      {r.is_active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      {canManageRow && (
                        <>
                          <button
                            data-testid={`user-edit-${r.id}`}
                            onClick={() => openEdit(r)}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4"/>
                          </button>
                          <button
                            data-testid={`user-reset-pwd-${r.id}`}
                            onClick={() => setPwdModal({ id: r.id, email: r.email, password: "" })}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="Resetar senha"
                          >
                            <KeyRound className="w-4 h-4"/>
                          </button>
                          {!isMe && (
                            <button
                              data-testid={`user-toggle-active-${r.id}`}
                              onClick={() => toggleActive(r)}
                              className={`p-1.5 rounded-lg hover:bg-muted transition-colors ${r.is_active ? "text-emerald-600" : "text-red-600"}`}
                              title={r.is_active ? "Desativar" : "Ativar"}
                            >
                              <Power className="w-4 h-4"/>
                            </button>
                          )}
                          {!isMe && (
                            <button
                              data-testid={`user-delete-${r.id}`}
                              onClick={() => setConfirmDelete(r)}
                              className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-600 transition-colors"
                              title="Excluir"
                            >
                              <Trash2 className="w-4 h-4"/>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                {rows.length === 0 ? "Nenhum usuário cadastrado." : "Nenhum resultado com os filtros aplicados."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Criar/Editar */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg voxyra-compose-anim">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">{editing ? "Editar usuário" : "Novo usuário"}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null); }} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome</span>
                <input
                  data-testid="user-input-name"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">E-mail</span>
                <input
                  data-testid="user-input-email"
                  type="email"
                  disabled={!!editing}
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                />
                {editing && <span className="text-[11px] text-muted-foreground">O e-mail não pode ser alterado.</span>}
              </label>
              {!editing && (
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Senha</span>
                  <input
                    data-testid="user-input-password"
                    type="password"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </label>
              )}
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Perfil</span>
                <select
                  data-testid="user-input-role"
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {allowedRoles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
                <span className="text-[11px] text-muted-foreground block mt-1">{ROLE_DESCRIPTIONS[form.role]}</span>
              </label>
              {currentUser?.role === "superadmin" && (
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
              )}
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
              <button data-testid={ADMIN.cancelBtn} onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button
                data-testid={ADMIN.saveBtn}
                disabled={saving || !form.name || !form.email || (!editing && !form.password)}
                onClick={submit}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? "Salvando…" : (editing ? "Atualizar" : "Criar")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reset senha */}
      {pwdModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-display text-lg font-bold flex items-center gap-2"><KeyRound className="w-4 h-4"/> Resetar senha</h2>
              <button onClick={() => setPwdModal(null)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-muted-foreground">Defina uma nova senha para <strong>{pwdModal.email}</strong>. Ele(a) precisará usar essa senha no próximo login.</p>
              <input
                data-testid="user-new-password-input"
                type="password"
                autoFocus
                placeholder="Nova senha (mín. 6 caracteres)"
                value={pwdModal.password}
                onChange={e => setPwdModal({ ...pwdModal, password: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button onClick={() => setPwdModal(null)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button
                data-testid="user-reset-pwd-submit"
                disabled={(pwdModal.password || "").length < 6}
                onClick={resetPassword}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
              >
                Redefinir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de delete */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm">
            <div className="p-5">
              <div className="mx-auto h-12 w-12 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center mb-3">
                <Trash2 className="w-6 h-6 text-red-600"/>
              </div>
              <h2 className="font-display text-lg font-bold text-center">Excluir usuário?</h2>
              <p className="text-sm text-muted-foreground text-center mt-2">
                <strong>{confirmDelete.name}</strong> ({confirmDelete.email}) será removido permanentemente. Esta ação não pode ser desfeita.
              </p>
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button
                data-testid="user-confirm-delete"
                onClick={doDelete}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
