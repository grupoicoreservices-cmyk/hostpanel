import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Sun, Moon, LayoutPanelLeft, LayoutPanelTop, HelpCircle, Settings, ArrowLeft } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import useSWR from "swr";

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
    body_html: `<p>Olá, administrador.</p><p>A mailbox <strong>financeiro@grupoicore.com.br</strong> atingiu 82% da capacidade contratada.</p>`,
    to: ["admin@grupoicore.com.br"] },
  { uid: "d2", from_name: "Cliente Bellanapoli", from_addr: "contato@bellanapoli.com.br",
    subject: "Falha de entrega", preview: "Mensagem retornou com erro 550…",
    date: new Date(Date.now()-3600e3).toISOString(), unread: true, folder: "INBOX",
    body_text: "Mensagem retornou com erro 550. Verifique o SPF do domínio remetente." },
  { uid: "d3", from_name: "Sistema Antispam", from_addr: "antispam@voxyra.net.br",
    subject: "Resumo diário", preview: "738 mensagens bloqueadas, 12 quarentenadas.",
    date: new Date(Date.now()-86400e3).toISOString(), folder: "INBOX",
    body_text: "738 mensagens bloqueadas, 12 quarentenadas nas últimas 24 horas." },
];

/** Fetcher SWR: escolhe o endpoint certo por pasta. */
const messagesFetcher = async ([folder, search]) => {
  if (folder === "Junk" || folder === "Spam") {
    const { data } = await api.get("/spam/messages", {
      params: { limit: 100, search: search || undefined },
    });
    return data.messages || [];
  }
  const { data } = await api.get("/webmail/messages", {
    params: { folder, limit: 50, search: search || undefined },
  });
  return data;
};

export default function Webmail() {
  const { user } = useAuth();
  const { prefs, update } = usePrefs();
  const navigate = useNavigate();

  const [folder, setFolder] = useState("INBOX");
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeInitial, setComposeInitial] = useState({});
  const [stats, setStats] = useState({});

  const isAdmin = user?.role === "superadmin" || user?.role === "empresa_admin";
  const isSpamFolder = folder === "Junk" || folder === "Spam";

  // Debounce da busca (evita re-fetch a cada tecla)
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // SWR cache: mantém dados por pasta+busca; revalida em focus e a cada 60s
  const swrKey = user ? ["mail-messages", folder, searchDebounced] : null;
  const { data: rawMessages, isLoading, isValidating, mutate, error } = useSWR(
    swrKey,
    ([, f, s]) => messagesFetcher([f, s]),
    {
      revalidateOnFocus: true,
      revalidateIfStale: true,
      dedupingInterval: 20_000,
      refreshInterval: 60_000,
      keepPreviousData: true,
    }
  );

  const demoMode = !!error;
  const messages = useMemo(() => {
    if (error) return DEMO_MESSAGES.filter((m) => folder === "INBOX" || m.folder === folder);
    return rawMessages || [];
  }, [rawMessages, error, folder]);

  // Stats admin
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const { data } = await api.get("/dashboard/stats");
        setStats(data);
      } catch { /* silencioso */ }
    })();
  }, [isAdmin]);

  const openMessage = async (m) => {
    if (demoMode) { setSelected(m); return; }
    // Otimista: já mostra o preview enquanto o corpo carrega
    setSelected({ ...m, _loadingBody: true });
    try {
      const endpoint = isSpamFolder ? `/spam/messages/${m.uid}` : `/webmail/messages/${m.uid}`;
      const { data } = await api.get(endpoint, { params: { folder } });
      setSelected(data);
      // marca como lido localmente + revalida cache
      mutate(
        (prev) => (prev || []).map((x) => x.uid === m.uid ? { ...x, unread: false } : x),
        { revalidate: false }
      );
    } catch { setSelected(m); }
  };

  const openInNewTab = () => {
    if (!selected?.uid) return;
    const url = `/mail/message/${selected.uid}?folder=${encodeURIComponent(folder)}`;
    window.open(url, "_blank", "noopener,noreferrer");
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
      mutate();
    } catch { toast.error("Não foi possível arquivar"); }
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
        ? "Movido para spam e remetente bloqueado"
        : "Movido para spam");
      setSelected(null);
      mutate();
    } catch { toast.error("Não foi possível mover"); }
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
      mutate();
    } catch { toast.error("Não foi possível marcar como não-spam"); }
  };

  const doDelete = async () => {
    if (!selected) return;
    if (demoMode) { toast.info("Modo demo — configure IMAP para excluir"); return; }
    try {
      await api.delete(`/webmail/messages/${selected.uid}`, { params: { folder } });
      toast.success("Mensagem excluída");
      setSelected(null);
      mutate();
    } catch { toast.error("Não foi possível excluir"); }
  };

  const folderTitle = useMemo(() => ({
    INBOX: "Caixa de entrada", Sent: "Enviados", Drafts: "Rascunhos", Trash: "Lixeira",
    Junk: "Antispam Center", Spam: "Spam", Archive: "Arquivo", Starred: "Favoritos", Snoozed: "Adiados",
  })[folder] || folder, [folder]);

  const vertical = prefs.view_mode === "vertical";
  const loading = isLoading || (isValidating && !rawMessages);

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

        {isAdmin && <StatsBar stats={stats} />}

        {/* Content area — painéis redimensionáveis */}
        <div className="flex-1 overflow-hidden">
          <PanelGroup
            direction={vertical ? "vertical" : "horizontal"}
            autoSaveId={`voxyra-mail-layout-${vertical ? "v" : "h"}`}
          >
            <Panel defaultSize={38} minSize={22}>
              <MessageList
                messages={messages}
                loading={loading}
                selectedUid={selected?.uid}
                onSelect={openMessage}
                onRefresh={() => mutate()}
                folderTitle={folderTitle}
                folderSubtitle={demoMode
                  ? "Modo demonstração — configure servidor DirectAdmin para dados reais"
                  : `${user?.email || ""}`}
              />
            </Panel>

            <PanelResizeHandle
              data-testid="mail-resize-handle"
              className={vertical
                ? "h-1 bg-border hover:bg-primary/40 transition-colors cursor-row-resize"
                : "w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize"}
            />

            <Panel defaultSize={isAdmin && !vertical ? 42 : 62} minSize={25}>
              <ReadingPane
                message={selected}
                onArchive={doArchive}
                onSpam={doSpam}
                onNotSpam={doNotSpam}
                onDelete={doDelete}
                onReply={doReply}
                onReplyQuick={doReply}
                onClose={() => setSelected(null)}
                onOpenInNewTab={openInNewTab}
                isSpamFolder={isSpamFolder}
              />
            </Panel>

            {!vertical && isAdmin && (
              <>
                <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize" />
                <Panel defaultSize={20} minSize={12}>
                  <SaasPanel stats={stats} />
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
      </div>

      <ComposeModal
        open={composing}
        initial={composeInitial}
        onClose={() => setComposing(false)}
        onSent={() => mutate()}
      />
    </div>
  );
}
