import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Globe, X, RefreshCw, Server, Mail, Send, Zap, Link2, Shield, ChevronDown, ChevronUp, ExternalLink, Inbox } from "lucide-react";
import { api, formatApiErrorDetail } from "@/lib/api";
import { ADMIN } from "@/lib/testIds";

const EMPTY = {
  nome: "",
  empresa_id: "",
  directadmin_server_id: "",
  imap_host: "",
  imap_port: 993,
  imap_ssl: true,
  smtp_host: "",
  smtp_port: 587,
  smtp_tls: true,
  webmail_url: "",
  logo_url: "",
  hero_image_url: "",
  allow_bypass_login: false,
};

export default function AdminDomains() {
  const [rows, setRows] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [servers, setServers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [testing, setTesting] = useState(null);
  const [expandAdvanced, setExpandAdvanced] = useState(false);
  const [catchAll, setCatchAll] = useState(null); // {domain, current}

  const openCatchAll = (d) => setCatchAll({ domain: d, current: null });
  const closeCatchAll = () => setCatchAll(null);

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

  const openNew = () => { setForm(EMPTY); setEditing(null); setShowForm(true); setExpandAdvanced(false); };
  const openEdit = (d) => {
    setForm({
      ...EMPTY, ...d,
      directadmin_server_id: d.directadmin_server_id || "",
      imap_host: d.imap_host || "",
      smtp_host: d.smtp_host || "",
      webmail_url: d.webmail_url || "",
    });
    setEditing(d);
    setShowForm(true);
    setExpandAdvanced(!!(d.imap_host || d.smtp_host || d.allow_bypass_login));
  };

  // Auto-preenche IMAP/SMTP host quando um servidor DirectAdmin é selecionado
  const onServerChange = (server_id) => {
    let imap = form.imap_host, smtp = form.smtp_host;
    const s = servers.find(x => x.id === server_id);
    if (s && !editing) {
      const host = (s.url || "").replace("https://","").replace("http://","").split(":")[0].replace(/\/$/,"");
      if (!imap) imap = host;
      if (!smtp) smtp = host;
    }
    setForm({ ...form, directadmin_server_id: server_id, imap_host: imap, smtp_host: smtp });
  };

  // Auto-sugere hostnames baseado no nome do domínio
  const suggestFromDomain = () => {
    if (!form.nome) return;
    setForm({
      ...form,
      imap_host: form.imap_host || `mail.${form.nome}`,
      smtp_host: form.smtp_host || `mail.${form.nome}`,
      webmail_url: form.webmail_url || `https://webmail.${form.nome}`,
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        const { imap_host, imap_port, imap_ssl, smtp_host, smtp_port, smtp_tls,
                webmail_url, allow_bypass_login, directadmin_server_id } = form;
        await api.patch(`/dominios/${editing.id}`, {
          imap_host: imap_host || null, imap_port: Number(imap_port), imap_ssl,
          smtp_host: smtp_host || null, smtp_port: Number(smtp_port), smtp_tls,
          webmail_url: webmail_url || null, allow_bypass_login,
          logo_url: form.logo_url || null,
          hero_image_url: form.hero_image_url || null,
          directadmin_server_id: directadmin_server_id || null,
        });
        toast.success("Domínio atualizado");
      } else {
        const { data } = await api.post("/dominios", {
          ...form,
          imap_port: Number(form.imap_port),
          smtp_port: Number(form.smtp_port),
          directadmin_server_id: form.directadmin_server_id || null,
          imap_host: form.imap_host || null,
          smtp_host: form.smtp_host || null,
          webmail_url: form.webmail_url || null,
        });
        toast.success(data.contas_count > 0
          ? `Domínio criado — ${data.contas_count} conta(s) importada(s) do DirectAdmin`
          : "Domínio criado");
      }
      setShowForm(false); setForm(EMPTY); setEditing(null); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSaving(false); }
  };

  const doSync = async (id) => {
    setSyncing(id);
    try {
      const { data } = await api.post(`/dominios/${id}/sync`);
      toast.success(`${data.imported_or_updated} conta(s) sincronizada(s) do ${data.domain}`);
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSyncing(null); }
  };

  const testConn = async (kind) => {
    if (!editing?.id && !form.nome) { toast.error("Salve o domínio primeiro"); return; }
    setTesting(kind);
    try {
      // Se ainda não salvou, salva antes de testar
      let id = editing?.id;
      if (!id) { toast.info("Salve o domínio antes de testar"); return; }
      const { data } = await api.post(`/dominios/${id}/test-${kind}`);
      if (data.ok) toast.success(`${kind.toUpperCase()} ✓ ${data.host}:${data.port}`);
      else toast.error(`${kind.toUpperCase()} ✗ ${data.host}:${data.port} — ${data.error}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setTesting(null); }
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
          <p className="text-sm text-muted-foreground mt-1">Configure IMAP, SMTP e login por domínio.</p>
        </div>
        <button data-testid={ADMIN.addBtn} onClick={openNew} className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all">
          <Plus className="w-4 h-4"/> Novo domínio
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Domínio</th>
              <th className="text-left px-4 py-3">Empresa</th>
              <th className="text-center px-4 py-3">IMAP / SMTP</th>
              <th className="text-center px-4 py-3">Bypass</th>
              <th className="text-center px-4 py-3">Contas</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`${ADMIN.rowPrefix}domain-${r.id}`} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 font-semibold"><Globe className="w-4 h-4 text-primary"/>{r.nome}</div>
                  {r.webmail_url && (
                    <a href={r.webmail_url} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1 mt-0.5">
                      <ExternalLink className="w-3 h-3"/> {r.webmail_url}
                    </a>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{empresaName(r.empresa_id)}</td>
                <td className="px-4 py-3 text-center text-[11px] font-mono text-muted-foreground">
                  {r.imap_host ? (
                    <>
                      <div>IMAP {r.imap_host}:{r.imap_port}</div>
                      <div>SMTP {r.smtp_host || r.imap_host}:{r.smtp_port}</div>
                    </>
                  ) : (
                    <span className="italic">não configurado</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {r.allow_bypass_login ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                      <Shield className="w-3 h-3"/> ativo
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">{r.contas_count}</td>
                <td className="px-4 py-3 text-right flex justify-end gap-1">
                  <button
                    data-testid={`admin-edit-domain-${r.id}`}
                    onClick={() => openEdit(r)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                    title="Editar"
                  ><Server className="w-4 h-4"/></button>
                  {r.directadmin_server_id && (
                    <button
                      data-testid={`admin-sync-domain-${r.id}`}
                      onClick={() => doSync(r.id)}
                      disabled={syncing === r.id}
                      className="p-1.5 rounded-md hover:bg-primary/10 text-primary"
                      title="Sincronizar contas do DirectAdmin"
                    ><RefreshCw className={`w-4 h-4 ${syncing === r.id ? "animate-spin" : ""}`}/></button>
                  )}
                  {r.directadmin_server_id && (
                    <button
                      data-testid={`admin-catchall-domain-${r.id}`}
                      onClick={() => openCatchAll(r)}
                      className="p-1.5 rounded-md hover:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      title="Configurar catch-all"
                    ><Inbox className="w-4 h-4"/></button>
                  )}
                  <button data-testid={`${ADMIN.deleteRow}domain-${r.id}`} onClick={() => del(r.id)} className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"><Trash2 className="w-4 h-4"/></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Nenhum domínio cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl voxyra-compose-anim my-8">
            <div className="p-5 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
              <div>
                <h2 className="font-display text-xl font-bold">
                  {editing ? "Editar domínio" : "Novo domínio"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Configuração de IMAP, SMTP e login para o webmail.
                </p>
              </div>
              <button onClick={() => { setShowForm(false); setEditing(null); }} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
            </div>

            <div className="p-5 space-y-5">
              {/* SEÇÃO 1 - IDENTIFICAÇÃO */}
              <FormSection title="Identificação" icon={Globe}>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Domínio" required>
                    <input
                      data-testid="domain-input-nome"
                      value={form.nome}
                      onChange={e => setForm({ ...form, nome: e.target.value.toLowerCase() })}
                      disabled={!!editing}
                      placeholder="exemplo.com.br"
                      className="input"
                    />
                  </Field>
                  <Field label="Empresa" required>
                    <select
                      data-testid="domain-input-empresa"
                      value={form.empresa_id}
                      onChange={e => setForm({ ...form, empresa_id: e.target.value })}
                      disabled={!!editing}
                      className="input"
                    >
                      <option value="">Selecione…</option>
                      {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Servidor DirectAdmin (opcional)">
                  <select
                    data-testid="domain-input-server"
                    value={form.directadmin_server_id}
                    onChange={e => onServerChange(e.target.value)}
                    className="input"
                  >
                    <option value="">— Nenhum —</option>
                    {servers.map(s => <option key={s.id} value={s.id}>{s.nome} ({s.url})</option>)}
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Selecionar preenche IMAP/SMTP automaticamente.
                  </p>
                </Field>
              </FormSection>

              {/* SEÇÃO 2 - IMAP */}
              <FormSection title="IMAP (entrada)" icon={Mail} accent="blue">
                <div className="grid md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <Field label="Servidor IMAP">
                      <input
                        data-testid="domain-imap-host"
                        value={form.imap_host}
                        onChange={e => setForm({ ...form, imap_host: e.target.value })}
                        placeholder="mail.exemplo.com.br"
                        className="input font-mono text-sm"
                      />
                    </Field>
                  </div>
                  <Field label="Porta">
                    <input
                      data-testid="domain-imap-port"
                      type="number"
                      value={form.imap_port}
                      onChange={e => setForm({ ...form, imap_port: e.target.value })}
                      className="input font-mono text-sm"
                    />
                  </Field>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      data-testid="domain-imap-ssl"
                      type="checkbox"
                      checked={form.imap_ssl}
                      onChange={e => setForm({ ...form, imap_ssl: e.target.checked })}
                    />
                    Usar SSL/TLS (recomendado)
                  </label>
                  {editing && (
                    <button
                      onClick={() => testConn("imap")}
                      disabled={testing === "imap"}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted disabled:opacity-60"
                    ><Zap className={`w-3 h-3 ${testing === "imap" ? "animate-pulse" : ""}`}/> Testar IMAP</button>
                  )}
                </div>
              </FormSection>

              {/* SEÇÃO 3 - SMTP */}
              <FormSection title="SMTP (saída)" icon={Send} accent="emerald">
                <div className="grid md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <Field label="Servidor SMTP">
                      <input
                        data-testid="domain-smtp-host"
                        value={form.smtp_host}
                        onChange={e => setForm({ ...form, smtp_host: e.target.value })}
                        placeholder="mail.exemplo.com.br"
                        className="input font-mono text-sm"
                      />
                    </Field>
                  </div>
                  <Field label="Porta">
                    <input
                      data-testid="domain-smtp-port"
                      type="number"
                      value={form.smtp_port}
                      onChange={e => setForm({ ...form, smtp_port: e.target.value })}
                      className="input font-mono text-sm"
                    />
                  </Field>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      data-testid="domain-smtp-tls"
                      type="checkbox"
                      checked={form.smtp_tls}
                      onChange={e => setForm({ ...form, smtp_tls: e.target.checked })}
                    />
                    Usar STARTTLS
                  </label>
                  {editing && (
                    <button
                      onClick={() => testConn("smtp")}
                      disabled={testing === "smtp"}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted disabled:opacity-60"
                    ><Zap className={`w-3 h-3 ${testing === "smtp" ? "animate-pulse" : ""}`}/> Testar SMTP</button>
                  )}
                </div>
              </FormSection>

              {/* Botão sugerir configurações */}
              {form.nome && !form.imap_host && (
                <button
                  onClick={suggestFromDomain}
                  className="w-full text-xs text-primary font-semibold underline"
                >Preencher automaticamente a partir do nome do domínio</button>
              )}

              {/* SEÇÃO 4 - WEBMAIL & BYPASS */}
              <FormSection title="Acesso ao webmail" icon={Link2} accent="purple">
                <Field label="URL do webmail (opcional)">
                  <input
                    data-testid="domain-webmail-url"
                    value={form.webmail_url}
                    onChange={e => setForm({ ...form, webmail_url: e.target.value })}
                    placeholder="https://webmail.exemplo.com.br"
                    className="input font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Link direto para o webmail deste domínio (exibido na listagem).
                  </p>
                </Field>

                <label className="flex items-start gap-3 p-3 rounded-xl border border-border cursor-pointer hover:bg-muted/50">
                  <input
                    data-testid="domain-bypass"
                    type="checkbox"
                    checked={form.allow_bypass_login}
                    onChange={e => setForm({ ...form, allow_bypass_login: e.target.checked })}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-semibold text-sm">Bypass IMAP no login</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Qualquer e-mail deste domínio pode logar diretamente no webmail
                      usando a própria senha da caixa postal (autentica contra o IMAP
                      configurado acima). Não é necessário cadastrar cada usuário
                      manualmente.
                    </div>
                  </div>
                </label>
              </FormSection>

              {/* SEÇÃO 5 - BRANDING */}
              <FormSection title="Branding (opcional)" icon={ExternalLink} accent="emerald">
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Logo (URL)">
                    <input
                      data-testid="domain-logo-url"
                      value={form.logo_url}
                      onChange={e => setForm({ ...form, logo_url: e.target.value })}
                      placeholder="https://.../logo.png"
                      className="input font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Aparece no topo do webmail e ao lado do título do login.
                    </p>
                  </Field>
                  <Field label="Imagem hero (URL)">
                    <input
                      data-testid="domain-hero-url"
                      value={form.hero_image_url}
                      onChange={e => setForm({ ...form, hero_image_url: e.target.value })}
                      placeholder="https://.../hero.jpg"
                      className="input font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Preenche o painel esquerdo da tela de login (substitui o gradient).
                    </p>
                  </Field>
                </div>
                {(form.logo_url || form.hero_image_url) && (
                  <div className="flex gap-3 mt-2">
                    {form.logo_url && (
                      <div className="p-2 rounded-lg border border-border bg-muted/40">
                        <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Preview logo</div>
                        <img src={form.logo_url} alt="logo" className="h-10 object-contain" onError={(e) => e.currentTarget.style.display='none'}/>
                      </div>
                    )}
                    {form.hero_image_url && (
                      <div className="p-2 rounded-lg border border-border bg-muted/40 flex-1">
                        <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Preview hero</div>
                        <img src={form.hero_image_url} alt="hero" className="h-16 w-full object-cover rounded" onError={(e) => e.currentTarget.style.display='none'}/>
                      </div>
                    )}
                  </div>
                )}
              </FormSection>
            </div>

            <div className="p-5 border-t border-border flex gap-2 justify-end sticky bottom-0 bg-card">
              <button data-testid={ADMIN.cancelBtn} onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button
                data-testid={ADMIN.saveBtn}
                disabled={saving || !form.nome || !form.empresa_id}
                onClick={save}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
              >{saving ? "Salvando…" : editing ? "Salvar alterações" : "Criar domínio"}</button>
            </div>
          </div>
        </div>
      )}

      {catchAll && (
        <CatchAllModal domain={catchAll.domain} onClose={closeCatchAll} />
      )}
    </div>
  );
}

function FormSection({ title, icon: Icon, accent = "primary", children }) {
  const accentCls = {
    primary: "text-primary",
    blue: "text-blue-500",
    emerald: "text-emerald-500",
    purple: "text-purple-500",
  }[accent];
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className={`flex items-center gap-2 font-display font-bold text-sm mb-3 ${accentCls}`}>
        <Icon className="w-4 h-4"/> {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

/* --------- Catch-all modal --------- */
function CatchAllModal({ domain, onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState("unset");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(`/dominios/${domain.id}/catch-all`);
        setMode(data.mode || "unset");
        setAddress(data.value || "");
      } catch (e) {
        setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      } finally { setLoading(false); }
    })();
  }, [domain.id]);

  const save = async () => {
    if (mode === "address" && !address.includes("@")) {
      toast.error("Informe um e-mail de destino válido");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/dominios/${domain.id}/catch-all`, {
        mode,
        address: mode === "address" ? address : null,
      });
      setMode(data.mode || "unset");
      setAddress(data.value || "");
      toast.success(`Catch-all de ${domain.nome} atualizado`);
      onClose();
    } catch (e) {
      const msg = formatApiErrorDetail(e.response?.data?.detail) || e.message;
      setError(msg);
      toast.error(msg);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div
        data-testid="catchall-modal"
        className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md voxyra-compose-anim"
      >
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <Inbox className="w-4 h-4 text-blue-600" /> Catch-all
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Domínio: <span className="font-mono">{domain.nome}</span></p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4"/></button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando configuração atual…</div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground leading-relaxed">
                O catch-all define o que acontece quando alguém envia um e-mail para um endereço
                <span className="font-mono">@{domain.nome}</span> que não existe.
              </div>

              <div className="space-y-2">
                <ModeOption
                  testid="catchall-mode-address"
                  active={mode === "address"}
                  onClick={() => setMode("address")}
                  title="Encaminhar para um e-mail"
                  desc="Todas as mensagens para endereços inexistentes vão para esta caixa."
                />
                <ModeOption
                  testid="catchall-mode-blackhole"
                  active={mode === "blackhole"}
                  onClick={() => setMode("blackhole")}
                  title="Descartar silenciosamente"
                  desc="Ideal para reduzir spam — mensagens somem sem aviso ao remetente."
                />
                <ModeOption
                  testid="catchall-mode-fail"
                  active={mode === "fail"}
                  onClick={() => setMode("fail")}
                  title="Rejeitar (bounce)"
                  desc="Devolve com erro para o remetente. Útil para exigir endereço correto."
                />
                <ModeOption
                  testid="catchall-mode-unset"
                  active={mode === "unset"}
                  onClick={() => setMode("unset")}
                  title="Sem catch-all (default do servidor)"
                  desc="Volta ao comportamento padrão do DirectAdmin/Exim."
                />
              </div>

              {mode === "address" && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                    E-mail de destino
                  </label>
                  <input
                    data-testid="catchall-address-input"
                    type="email"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={`captura@${domain.nome}`}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              )}

              {error && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-5 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted"
          >Cancelar</button>
          <button
            data-testid="catchall-save-btn"
            onClick={save}
            disabled={saving || loading}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
          >{saving ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

function ModeOption({ testid, active, onClick, title, desc }) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
        active
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/40 hover:bg-muted/50"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className={`w-3 h-3 mt-1 rounded-full border-2 flex-shrink-0 ${
          active ? "border-primary bg-primary" : "border-muted-foreground/40"
        }`} />
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-muted-foreground">{desc}</div>
        </div>
      </div>
    </button>
  );
}
