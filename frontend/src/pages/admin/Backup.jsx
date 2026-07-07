import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, X, Server, Trash2, TestTube2, Pencil, Power, HardDrive, CheckCircle2, XCircle, Clock, Info, Play, FileSearch, ArrowRight, RefreshCw } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const EMPTY_FORM = {
  nome: "",
  protocol: "sftp",
  host: "",
  port: 22,
  username: "",
  auth_type: "password",
  base_path: "/backup",
  password: "",
  private_key: "",
  passphrase: "",
  empresa_id: "",
  retention_days: 90,
  poll_interval_min: 15,
  enabled: true,
};

export default function AdminBackup() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null); // server_id
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api.get("/backup/servers"), api.get("/empresas")]);
      setRows(s.data);
      setEmpresas(e.data);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Falha ao carregar servidores");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const empresaName = (id) => empresas.find(x => x.id === id)?.nome || "— Global —";

  const defaultPort = (proto) => (proto === "sftp" ? 22 : proto === "ftps" ? 990 : 21);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      ...EMPTY_FORM,
      ...row,
      password: "",       // vazio no form; só é enviado se preenchido
      private_key: "",
      passphrase: "",
      empresa_id: row.empresa_id || "",
    });
    setShowForm(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, empresa_id: form.empresa_id || null };
      // Remove campos secretos vazios em edição para preservar valor atual
      if (editing) {
        if (!payload.password) delete payload.password;
        if (!payload.private_key) delete payload.private_key;
      }
      if (editing) {
        await api.patch(`/backup/servers/${editing.id}`, payload);
        toast.success("Servidor atualizado");
      } else {
        await api.post("/backup/servers", payload);
        toast.success("Servidor cadastrado");
      }
      setShowForm(false); setEditing(null); setForm(EMPTY_FORM); load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setSaving(false); }
  };

  const runTest = async (row) => {
    setTesting(row.id);
    try {
      const { data } = await api.post(`/backup/servers/${row.id}/test`);
      toast.success(data.message || "Conexão OK");
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha no teste");
      load();
    } finally { setTesting(null); }
  };

  const toggleEnabled = async (row) => {
    try {
      await api.patch(`/backup/servers/${row.id}`, { enabled: !row.enabled });
      toast.success(row.enabled ? "Desativado" : "Ativado");
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha");
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api.delete(`/backup/servers/${confirmDelete.id}`);
      toast.success("Servidor removido");
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha");
    }
  };

  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter(r => r.enabled).length;
    const ok = rows.filter(r => r.last_status === "ok").length;
    const errors = rows.filter(r => r.last_status && r.last_status.startsWith("error")).length;
    return { total, active, ok, errors };
  }, [rows]);

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto" data-testid="admin-backup-page">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
          <h1 className="font-display text-4xl font-bold tracking-tight flex items-center gap-2">
            <HardDrive className="w-8 h-8 text-primary"/> Retenção & Backup
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Configure servidores SFTP/FTP externos para arquivar todos os e-mails recebidos.
            Cada mensagem é salva como <code className="text-primary">.eml</code> em
            <code className="text-primary"> /empresa/dominio/conta/YYYY-MM/</code>. A restauração
            traz a mensagem de volta para a caixa via IMAP <code>APPEND</code>.
          </p>
        </div>
        <button
          data-testid="backup-add-btn"
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all"
        >
          <Plus className="w-4 h-4"/> Novo servidor de backup
        </button>
      </div>

      {/* Aviso: coleta agendada em iteração seguinte */}
      <div className="mb-6 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-start gap-3">
        <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"/>
        <div className="text-xs">
          <div className="font-semibold text-amber-900 dark:text-amber-200">Status atual</div>
          <div className="text-amber-800 dark:text-amber-300 mt-0.5">
            Você já pode cadastrar e testar servidores SFTP/FTP aqui. A coleta automática
            (polling IMAP → upload) e a interface de restauração serão liberadas na próxima
            atualização. Enquanto isso, use o botão <strong>Testar</strong> para validar a
            conectividade.
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Servidores" value={stats.total} icon={Server} tone="blue"/>
        <StatCard label="Ativos" value={stats.active} icon={Power} tone="emerald"/>
        <StatCard label="Última conexão OK" value={stats.ok} icon={CheckCircle2} tone="emerald"/>
        <StatCard label="Com erro" value={stats.errors} icon={XCircle} tone="red"/>
      </div>

      {/* Tabela */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Servidor</th>
              <th className="text-left px-4 py-3">Endereço</th>
              <th className="text-left px-4 py-3">Empresa</th>
              <th className="text-left px-4 py-3">Retenção</th>
              <th className="text-left px-4 py-3">Último status</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.id}
                data-testid={`backup-row-${r.id}`}
                className="border-t border-border hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Server className={`w-4 h-4 flex-shrink-0 ${r.enabled ? "text-primary" : "text-muted-foreground/50"}`}/>
                    <strong>{r.nome}</strong>
                    {!r.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">DESATIVADO</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 uppercase">
                    {r.protocol} • {r.auth_type === "key" ? "chave" : "senha"}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                  {r.username}@{r.host}:{r.port}
                  <div className="text-[11px]">{r.base_path}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{empresaName(r.empresa_id)}</td>
                <td className="px-4 py-3 text-xs">
                  {r.retention_days} dias
                  <div className="text-[11px] text-muted-foreground">poll: {r.poll_interval_min}min</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.last_status} error={r.last_error} lastRun={r.last_run_at}/>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <button
                      data-testid={`backup-test-${r.id}`}
                      onClick={() => runTest(r)}
                      disabled={testing === r.id}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      title="Testar conexão"
                    >
                      <TestTube2 className={`w-4 h-4 ${testing === r.id ? "animate-pulse text-primary" : ""}`}/>
                    </button>
                    <button
                      data-testid={`backup-toggle-${r.id}`}
                      onClick={() => toggleEnabled(r)}
                      className={`p-1.5 rounded-lg hover:bg-muted transition-colors ${r.enabled ? "text-emerald-600" : "text-red-600"}`}
                      title={r.enabled ? "Desativar" : "Ativar"}
                    >
                      <Power className="w-4 h-4"/>
                    </button>
                    <button
                      data-testid={`backup-edit-${r.id}`}
                      onClick={() => openEdit(r)}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Editar"
                    >
                      <Pencil className="w-4 h-4"/>
                    </button>
                    <button
                      data-testid={`backup-delete-${r.id}`}
                      onClick={() => setConfirmDelete(r)}
                      className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-600 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center">
                <Server className="w-10 h-10 mx-auto mb-2 text-muted-foreground/30"/>
                <div className="text-sm font-semibold">Nenhum servidor de backup cadastrado</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Cadastre um servidor SFTP/FTP externo (recomendamos um DirectAdmin dedicado para retenção).
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Cadastro/Edição */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl my-8">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">{editing ? "Editar servidor" : "Novo servidor de backup"}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null); }} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Nome amigável" full>
                <input
                  data-testid="backup-form-name"
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                  placeholder="Backup DirectAdmin Rio"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </Field>
              <Field label="Protocolo">
                <select
                  data-testid="backup-form-protocol"
                  value={form.protocol}
                  onChange={e => setForm({ ...form, protocol: e.target.value, port: defaultPort(e.target.value) })}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="sftp">SFTP (recomendado)</option>
                  <option value="ftps">FTPS (FTP com TLS)</option>
                  <option value="ftp">FTP (não criptografado)</option>
                </select>
              </Field>
              <Field label="Porta">
                <input
                  data-testid="backup-form-port"
                  type="number"
                  value={form.port}
                  onChange={e => setForm({ ...form, port: Number(e.target.value) })}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </Field>
              <Field label="Host" full>
                <input
                  data-testid="backup-form-host"
                  value={form.host}
                  onChange={e => setForm({ ...form, host: e.target.value })}
                  placeholder="backup.voxyra.net.br"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </Field>
              <Field label="Usuário">
                <input
                  data-testid="backup-form-username"
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </Field>
              <Field label="Autenticação">
                <select
                  data-testid="backup-form-authtype"
                  value={form.auth_type}
                  onChange={e => setForm({ ...form, auth_type: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="password">Senha</option>
                  <option value="key">Chave privada (SFTP)</option>
                </select>
              </Field>
              {form.auth_type === "password" ? (
                <Field label={editing ? "Nova senha (deixe em branco para manter)" : "Senha"} full>
                  <input
                    data-testid="backup-form-password"
                    type="password"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </Field>
              ) : (
                <>
                  <Field label={editing ? "Nova chave privada PEM (opcional)" : "Chave privada PEM"} full>
                    <textarea
                      data-testid="backup-form-privkey"
                      rows={5}
                      value={form.private_key}
                      onChange={e => setForm({ ...form, private_key: e.target.value })}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;…&#10;-----END OPENSSH PRIVATE KEY-----"
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono text-[11px]"
                    />
                  </Field>
                  <Field label="Passphrase (se a chave tiver)" full>
                    <input
                      data-testid="backup-form-passphrase"
                      type="password"
                      value={form.passphrase}
                      onChange={e => setForm({ ...form, passphrase: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </Field>
                </>
              )}
              <Field label="Caminho base" full>
                <input
                  data-testid="backup-form-basepath"
                  value={form.base_path}
                  onChange={e => setForm({ ...form, base_path: e.target.value })}
                  placeholder="/backup"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                />
              </Field>
              {user?.role === "superadmin" && (
                <Field label="Restringir à empresa" full>
                  <select
                    data-testid="backup-form-empresa"
                    value={form.empresa_id}
                    onChange={e => setForm({ ...form, empresa_id: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="">— Global (todas as empresas) —</option>
                    {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Retenção (dias)">
                <input
                  data-testid="backup-form-retention"
                  type="number"
                  min="1"
                  value={form.retention_days}
                  onChange={e => setForm({ ...form, retention_days: Number(e.target.value) })}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </Field>
              <Field label="Intervalo de coleta (min)">
                <input
                  data-testid="backup-form-poll"
                  type="number"
                  min="1"
                  value={form.poll_interval_min}
                  onChange={e => setForm({ ...form, poll_interval_min: Number(e.target.value) })}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </Field>
              <label className="flex items-center gap-2 md:col-span-2 mt-2">
                <input
                  data-testid="backup-form-enabled"
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => setForm({ ...form, enabled: e.target.checked })}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="text-sm">Ativar coleta automática (quando o scheduler for liberado)</span>
              </label>
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button
                data-testid="backup-form-submit"
                onClick={save}
                disabled={saving || !form.nome || !form.host || !form.username || (!editing && form.auth_type === "password" && !form.password) || (!editing && form.auth_type === "key" && !form.private_key)}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? "Salvando…" : (editing ? "Atualizar" : "Criar")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação delete */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm">
            <div className="p-5">
              <div className="mx-auto h-12 w-12 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center mb-3">
                <Trash2 className="w-6 h-6 text-red-600"/>
              </div>
              <h2 className="font-display text-lg font-bold text-center">Excluir servidor de backup?</h2>
              <p className="text-sm text-muted-foreground text-center mt-2">
                <strong>{confirmDelete.nome}</strong> será removido. Os arquivos já enviados ao SFTP <em>não</em> serão apagados.
              </p>
            </div>
            <div className="p-5 border-t border-border flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button
                data-testid="backup-confirm-delete"
                onClick={doDelete}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
              >Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function StatCard({ label, value, icon: Icon, tone }) {
  const cls = {
    blue: "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40",
    emerald: "text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40",
    red: "text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40",
  }[tone] || "text-primary bg-primary/10";
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${cls}`}>
          <Icon className="w-5 h-5"/>
        </div>
        <div className="flex-1">
          <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">{label}</div>
          <div className="font-display text-2xl font-bold">{value}</div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, error, lastRun }) {
  if (!status || status === "never") {
    return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="w-3.5 h-3.5"/> Nunca testado
    </span>;
  }
  if (status === "ok") {
    return <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="w-3.5 h-3.5"/> OK {lastRun && <span className="text-muted-foreground">({new Date(lastRun).toLocaleString("pt-BR")})</span>}
    </span>;
  }
  return <span className="inline-flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400" title={error}>
    <XCircle className="w-3.5 h-3.5"/> Erro <span className="truncate max-w-[240px] font-mono text-[10px]">{error}</span>
  </span>;
}
