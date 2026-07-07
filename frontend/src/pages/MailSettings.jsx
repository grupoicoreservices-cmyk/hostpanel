import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, PenLine, Plane, Save, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { usePrefs } from "@/context/PrefsContext";

/**
 * Página de configurações do usuário no Webmail.
 *
 * Abas:
 *  - Assinatura: campo texto salvo em user_preferences.signature (auto-injetado no compose)
 *  - Resposta automática: proxy para DirectAdmin CMD_API_EMAIL_VACATION
 */
export default function MailSettings() {
  const { user } = useAuth();
  const { prefs, update } = usePrefs();
  const navigate = useNavigate();

  const [tab, setTab] = useState("signature");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button
            data-testid="settings-back-btn"
            onClick={() => navigate("/mail")}
            className="p-2 rounded-lg border border-border hover:bg-muted transition-colors"
            title="Voltar para o webmail"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Configurações do webmail</h1>
            <div className="text-sm text-muted-foreground">{user?.email}</div>
          </div>
        </div>

        <div className="flex gap-1 border-b border-border mb-6">
          <TabButton
            testid="settings-tab-signature"
            active={tab === "signature"}
            onClick={() => setTab("signature")}
            icon={PenLine}
            label="Assinatura"
          />
          <TabButton
            testid="settings-tab-vacation"
            active={tab === "vacation"}
            onClick={() => setTab("vacation")}
            icon={Plane}
            label="Resposta automática"
          />
        </div>

        {tab === "signature" && (
          <SignatureTab prefs={prefs} update={update} />
        )}
        {tab === "vacation" && (
          <VacationTab />
        )}
      </div>
    </div>
  );
}

function TabButton({ testid, active, onClick, icon: Icon, label }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function SignatureTab({ prefs, update }) {
  const [value, setValue] = useState(prefs?.signature || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(prefs?.signature || ""); }, [prefs?.signature]);

  const save = async () => {
    setSaving(true);
    try {
      await update({ signature: value });
      toast.success("Assinatura salva. Novas mensagens já vão incluir automaticamente.");
    } catch (e) {
      toast.error("Falha ao salvar assinatura");
    } finally { setSaving(false); }
  };

  const clear = async () => {
    setValue("");
    setSaving(true);
    try {
      await update({ signature: "" });
      toast.success("Assinatura removida");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-6">
        <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Assinatura (texto simples)
        </label>
        <textarea
          data-testid="signature-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={8}
          placeholder={`Ex.:\nJoão Silva\nGerente Comercial · Voxyra\n+55 (11) 91234-5678\nvoxyra.net.br`}
          className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
        />
        <div className="mt-2 text-[11px] text-muted-foreground">
          A assinatura é anexada automaticamente ao final das novas mensagens, precedida pelo
          separador padrão <code className="font-mono">-- </code> (RFC 3676).
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          data-testid="signature-save-btn"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
        >
          <Save className="w-4 h-4" /> {saving ? "Salvando…" : "Salvar assinatura"}
        </button>
        {value && (
          <button
            data-testid="signature-clear-btn"
            onClick={clear}
            className="inline-flex items-center gap-2 border border-border rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            <Trash2 className="w-4 h-4" /> Remover
          </button>
        )}
      </div>
    </div>
  );
}

function VacationTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supported, setSupported] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [active, setActive] = useState(false);
  const [text, setText] = useState("");
  const [start, setStart] = useState(defaultLocalDate(0));
  const [end, setEnd] = useState(defaultLocalDate(7));

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg("");
      try {
        const { data } = await api.get("/webmail/settings/vacation");
        setActive(!!data.active);
        setText(data.text || "");
        if (data.starttime) setStart(data.starttime.slice(0, 10));
        if (data.endtime) setEnd(data.endtime.slice(0, 10));
      } catch (e) {
        const detail = formatApiErrorDetail(e.response?.data?.detail) || e.message;
        if (e.response?.status === 400) {
          setSupported(false);
        }
        setErrorMsg(detail);
      } finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    if (!text.trim()) { toast.error("Escreva o texto da resposta automática"); return; }
    if (!start || !end) { toast.error("Escolha data de início e fim"); return; }
    if (new Date(end) < new Date(start)) { toast.error("A data de fim deve ser posterior à data de início"); return; }
    setSaving(true);
    try {
      await api.put("/webmail/settings/vacation", {
        text,
        starttime: new Date(start).toISOString(),
        endtime: new Date(end).toISOString(),
      });
      setActive(true);
      toast.success("Resposta automática ativada");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha ao ativar");
    } finally { setSaving(false); }
  };

  const disable = async () => {
    setSaving(true);
    try {
      await api.delete("/webmail/settings/vacation");
      setActive(false);
      toast.success("Resposta automática desativada");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha ao desativar");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="text-sm text-muted-foreground">Carregando…</div>;

  if (!supported) {
    return (
      <div data-testid="vacation-unsupported" className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5 text-sm">
        <div className="font-bold text-amber-900 dark:text-amber-200 mb-1">
          Recurso indisponível para esta conta
        </div>
        <div className="text-amber-800 dark:text-amber-300">
          Para usar resposta automática o domínio precisa estar vinculado a um servidor DirectAdmin.
          {errorMsg && <div className="mt-1 text-xs opacity-80">{errorMsg}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        data-testid="vacation-status"
        className={`rounded-xl border p-4 flex items-center gap-3 ${
          active
            ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30"
            : "border-border bg-card"
        }`}
      >
        {active ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <XCircle className="w-5 h-5 text-muted-foreground" />
        )}
        <div className="text-sm font-semibold">
          {active ? "Resposta automática ativa" : "Resposta automática desativada"}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
            Início
          </label>
          <input
            data-testid="vacation-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
            Fim
          </label>
          <input
            data-testid="vacation-end"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Mensagem enviada aos remetentes
        </label>
        <textarea
          data-testid="vacation-text"
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Olá,\n\nEstarei fora do escritório de ${start} a ${end}.\nRetorno assim que possível. Para urgências, entre em contato com equipe@voxyra.net.br.\n\nAtenciosamente,`}
          className="w-full px-3 py-2.5 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          data-testid="vacation-save-btn"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
        >
          <Save className="w-4 h-4" /> {saving ? "Salvando…" : active ? "Atualizar" : "Ativar resposta automática"}
        </button>
        {active && (
          <button
            data-testid="vacation-disable-btn"
            onClick={disable}
            disabled={saving}
            className="inline-flex items-center gap-2 border border-border rounded-lg px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            <XCircle className="w-4 h-4" /> Desativar agora
          </button>
        )}
      </div>
    </div>
  );
}

function defaultLocalDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
