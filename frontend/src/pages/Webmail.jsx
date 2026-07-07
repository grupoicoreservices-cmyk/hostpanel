import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Sun, Moon, LayoutPanelLeft, LayoutPanelTop, HelpCircle, Settings, ArrowLeft } from "lucide-react";

import Sidebar from "@/components/mail/Sidebar";
import StatsBar from "@/components/mail/StatsBar";
import MessageList from "@/components/mail/MessageList";
import ReadingPane from "@/components/mail/ReadingPane";
import ComposeModal from "@/components/mail/ComposeModal";
import SaasPanel from "@/components/mail/SaaSPanel";

import { api } from "@/lib/api";
import { MAIL, ADMIN } from "@/lib/testIds";
import { useAuth } from "@/context/AuthContext";
import { usePrefs } from "@/context/PrefsContext";
import { toast } from "sonner";


const DEMO_MESSAGES = [
  { uid: "d1", from_name: "DirectAdmin", from_addr: "directadmin@server01.voxyra.net.br",
    subject: "Alerta de quota do domínio",
    preview: "A conta financeiro@grupoicore.com.br atingiu 82% da capacidade contratada.",
    date: new Date().toISOString(), unread: true, starred: true, folder: "INBOX",
    body_html: `<p>Olá, administrador.</p><p>A mailbox <strong>financeiro@grupoicore.com.br</strong> atingiu 82% da capacidade contratada. Recomendamos revisar mensagens antigas, anexos grandes ou ampliar o plano de armazenamento.</p><p><a href="#">Ação recomendada — Abrir painel DirectAdmin</a></p><p>Este aviso faz parte do serviço Voxyra Mail.</p>`,
    to: ["admin@grupoicore.com.br"] },
  { uid: "d2", from_name: "Cliente Bellanapoli", from_addr: "contato@bellanapoli.com.br",
    subject: "Falha de entrega", preview: "Mensagem retornou com erro 550…",
    date: new Date(Date.now()-3600e3).toISOString(), unread: true, folder: "INBOX",
    body_text: "Mensagem retornou com erro 550. Verifique o SPF do domínio remetente." },
  { uid: "d3", from_name: "Sistema Antispam", from_addr: "antispam@voxyra.net.br",
    subject: "Resumo diário", preview: "738 mensagens bloqueadas, 12 quarentenadas.",
    date: new Date(Date.now()-86400e3).toISOString(), folder: "INBOX",
    body_text: "738 mensagens bloqueadas, 12 quarentenadas nas últimas 24 horas." },
  { uid: "d4", from_name: "Comercial", from_addr: "vendas@grupoicore.com.br",
    subject: "Proposta de hospedagem", preview: "Segue plano para revisão.",
    date: new Date(Date.now()-3*86400e3).toISOString(), folder: "INBOX",
    body_text: "Segue plano para revisão do cliente ACME." },
  { uid: "d5", from_name: "Suporte Voxyra", from_addr: "suporte@voxyra.net.br",
    subject: "Ticket #4821 atualizado", preview: "DNS, SPF e DKIM validados.",
    date: new Date(Date.now()-5*86400e3).toISOString(), folder: "INBOX",
    body_text: "DNS, SPF e DKIM validados com sucesso." },
];


export default function Webmail() {
  const { user } = useAuth();
  const { prefs, update } = usePrefs();
  const navigate = useNavigate();

  const [folder, setFolder] = useState("INBOX");
  const [tab, setTab] = useState("principal");
  const [messages, setMessages] = useState([]);
  const [demoMode, setDemoMode] = useState(false);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeInitial, setComposeInitial] = useState({});
  const [stats, setStats] = useState({});

  const isAdmin = user?.role === "superadmin" || user?.role === "empresa_admin";

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      // Para pasta Spam/Junk, usa endpoint dedicado que auto-descobre a pasta correta
      if (folder === "Junk" || folder === "Spam") {
        const { data } = await api.get("/spam/messages", {
          params: { limit: 100, search: search || undefined },
        });
        setMessages(data.messages || []);
        setDemoMode(false);
      } else {
        const { data } = await api.get("/webmail/messages", {
          params: { folder, limit: 50, search: search || undefined },
        });
        setMessages(data);
        setDemoMode(false);
      }
    } catch {
      // Fallback to demo data when IMAP not yet configured
      setMessages(DEMO_MESSAGES.filter((m) => folder === "INBOX" || m.folder === folder));
      setDemoMode(true);
    } finally {
      setLoading(false);
    }
  }, [folder, search]);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get("/dashboard/stats");
      setStats(data);
    } catch {}
  }, []);

  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => { if (isAdmin) loadStats(); }, [isAdmin, loadStats]);

  const openMessage = async (m) => {
    if (demoMode) {
      setSelected(m);
      return;
    }
    try {
      const { data } = await api.get(`/webmail/messages/${m.uid}`, { params: { folder } });
      setSelected(data);
      // mark as read locally
      setMessages((prev) => prev.map((x) => x.uid === m.uid ? { ...x, unread: false } : x));
    } catch (e) {
      setSelected(m);
    }
  };

  const doReply = () => {
    if (!selected) return;
    setComposeInitial({
      to: selected.from_addr,
      subject: selected.subject?.startsWith("Re:") ? selected.subject : `Re: ${selected.subject || ""}`,
      body: `\n\n\n--- Mensagem original ---\nDe: ${selected.from_addr}\n${(selected.body_text || "").slice(0, 500)}`,
    });
    setComposing(true);
  };

  const doArchive = async () => {
    if (!selected) return;
    if (demoMode) { toast.info("Modo demo — configure IMAP para arquivar"); return; }
    try {
      await api.post(`/webmail/messages/${selected.uid}/move`, null, {
        params: { src_folder: folder, dst_folder: "Archive" },
      });
      toast.success("Mensagem arquivada");
      setSelected(null);
      loadMessages();
    } catch (e) { toast.error("Não foi possível arquivar"); }
  };

  const doSpam = async (addBlacklist = false) => {
    if (!selected) return;
    if (demoMode) { toast.info("Modo demo — configure IMAP para mover ao spam"); return; }
    try {
      const { data } = await api.post("/spam/report", {
        uids: [selected.uid],
        src_folder: folder,
        add_blacklist: addBlacklist,
      });
      toast.success(addBlacklist && data.blacklisted
        ? `Movido para spam e remetente bloqueado`
        : "Movido para spam");
      setSelected(null);
      loadMessages();
    } catch (e) { toast.error("Não foi possível mover"); }
  };

  const doNotSpam = async (addWhitelist = false) => {
    if (!selected) return;
    if (demoMode) { toast.info("Modo demo — configure IMAP para restaurar"); return; }
    try {
      const { data } = await api.post("/spam/not-spam", {
        uids: [selected.uid],
        folder,
        add_whitelist: addWhitelist,
      });
      toast.success(addWhitelist && data.whitelisted
        ? "Movido para Entrada e remetente adicionado ao whitelist"
        : "Movido para Entrada");
      setSelected(null);
      loadMessages();
    } catch (e) { toast.error("Não foi possível marcar como não-spam"); }
  };

  const doDelete = async () => {
    if (!selected) return;
    if (demoMode) { toast.info("Modo demo — configure IMAP para excluir"); return; }
    try {
      await api.delete(`/webmail/messages/${selected.uid}`, { params: { folder } });
      toast.success("Mensagem excluída");
      setSelected(null);
      loadMessages();
    } catch (e) { toast.error("Não foi possível excluir"); }
  };

  const folderTitle = useMemo(() => ({
    INBOX: "Caixa de entrada", Sent: "Enviados", Drafts: "Rascunhos", Trash: "Lixeira",
    Junk: "Antispam Center", Spam: "Spam", Archive: "Arquivo", Starred: "Favoritos", Snoozed: "Adiados",
  })[folder] || folder, [folder]);

  const vertical = prefs.view_mode === "vertical";

  return (
    <div className="h-screen w-full flex overflow-hidden bg-background">
      <Sidebar
        activeFolder={folder}
        onFolderChange={(f) => { setFolder(f); setSelected(null); }}
        onCompose={() => { setComposeInitial({}); setComposing(true); }}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="border-b border-border bg-card">
          <div className="px-4 py-3 flex items-center gap-3">
            {isAdmin && (
              <button
                data-testid={ADMIN.switchToWebmail}
                onClick={() => navigate("/admin/dashboard")}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Painel Admin
              </button>
            )}

            <div className="flex-1 relative max-w-2xl">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                data-testid={MAIL.searchInput}
                placeholder={isAdmin ? "Pesquisar e-mails, domínios, anexos ou remetentes" : "Pesquisar e-mails, remetentes ou anexos"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadMessages()}
                className="w-full pl-10 pr-3 py-2.5 rounded-full bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 border border-transparent focus:border-primary/30 transition-all"
              />
            </div>

            <button
              data-testid={MAIL.viewToggle}
              onClick={() => update({ view_mode: vertical ? "horizontal" : "vertical" })}
              title={vertical ? "Modo horizontal" : "Modo vertical"}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
            >
              {vertical ? <LayoutPanelLeft className="w-4 h-4" /> : <LayoutPanelTop className="w-4 h-4" />}
            </button>

            <button
              data-testid={MAIL.themeToggle}
              onClick={() => update({ theme: prefs.theme === "dark" ? "light" : "dark" })}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
              title="Tema"
            >
              {prefs.theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              data-testid={MAIL.supportBtn}
              onClick={() => toast.info("Fale conosco: suporte@voxyra.net.br")}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5" /> Suporte
            </button>

            <button
              data-testid={MAIL.settingsBtn}
              onClick={() => isAdmin ? navigate("/admin/dashboard") : toast.info("Somente administradores")}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
              title="Configurações"
            >
              <Settings className="w-4 h-4" />
            </button>

            <div className="h-8 w-8 rounded-full bg-primary/12 text-primary flex items-center justify-center text-xs font-bold">
              {(user?.name || "?").slice(0, 2).toUpperCase()}
            </div>
          </div>
        </div>

        {/* Stats bar (apenas admin) */}
        {isAdmin && <StatsBar stats={stats} />}

        {/* Content area */}
        <div className={`flex-1 flex overflow-hidden ${vertical ? "flex-col" : ""}`}>
          <div className={vertical ? "h-1/2 flex" : "flex-1 flex"}>
            <MessageList
              messages={messages}
              loading={loading}
              activeTab={tab}
              onTabChange={setTab}
              selectedUid={selected?.uid}
              onSelect={openMessage}
              onRefresh={loadMessages}
              folderTitle={folderTitle}
              folderSubtitle={demoMode
                ? "Modo demonstração — configure servidor DirectAdmin para dados reais"
                : `${user?.email || ""}`}
            />
          </div>

          <div className={vertical ? "flex-1 flex border-t border-border" : "flex-1 flex"}>
            <ReadingPane
              message={selected}
              onArchive={doArchive}
              onSpam={doSpam}
              onNotSpam={doNotSpam}
              onDelete={doDelete}
              onReply={doReply}
              onReplyQuick={doReply}
              onClose={() => setSelected(null)}
              isSpamFolder={folder === "Junk" || folder === "Spam"}
            />
          </div>

          {!vertical && isAdmin && <SaasPanel stats={stats} />}
        </div>
      </div>

      <ComposeModal
        open={composing}
        initial={composeInitial}
        onClose={() => setComposing(false)}
        onSent={loadMessages}
      />
    </div>
  );
}
