import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Sun, Moon, LayoutPanelLeft, LayoutPanelTop, HelpCircle, Settings, ArrowLeft, AlertCircle, Mail, Bell, BellOff } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import useSWR from "swr";

import Sidebar from "@/components/mail/Sidebar";
import StatsBar from "@/components/mail/StatsBar";
import MessageList from "@/components/mail/MessageList";
import ReadingPane from "@/components/mail/ReadingPane";
import ComposeModal from "@/components/mail/ComposeModal";
import SaasPanel from "@/components/mail/SaaSPanel";

import { api, formatApiErrorDetail } from "@/lib/api";
import { MAIL, ADMIN } from "@/lib/testIds";
import { useAuth } from "@/context/AuthContext";
import { usePrefs } from "@/context/PrefsContext";
import useWebmailStream from "@/hooks/useWebmailStream";
import { toast } from "sonner";


/** Fetcher SWR: escolhe o endpoint certo por pasta. Pastas virtuais que
 *  não existem no IMAP (Starred, Snoozed) devolvem estrutura vazia. */
const VIRTUAL_FOLDERS = new Set(["Starred", "Snoozed"]);
const EMPTY_PAGE = { items: [], total: 0, page: 1, page_size: 50, unread: 0, folder_counts: {} };
const COUNT_FOLDERS = "INBOX,Sent,Drafts,Trash,Junk,Archive";

const messagesFetcher = async ([folder, search, page, pageSize]) => {
  if (VIRTUAL_FOLDERS.has(folder)) return { ...EMPTY_PAGE, page_size: pageSize };
  if (folder === "Junk" || folder === "Spam") {
    const { data } = await api.get("/spam/messages", {
      params: { limit: pageSize, search: search || undefined },
    });
    const items = data.messages || [];
    return { items, total: items.length, page: 1, page_size: pageSize, unread: 0, folder_counts: {} };
  }
  // IMPORTANTE: `count_folders` faz o backend usar UMA única conexão IMAP para
  // listar mensagens + calcular contadores de todas as pastas. Isso evita
  // esbarrar em `mail_max_userip_connections` do Dovecot (default 15).
  const { data } = await api.get("/webmail/messages", {
    params: {
      folder,
      page,
      page_size: pageSize,
      search: search || undefined,
      count_folders: COUNT_FOLDERS,
    },
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
  // Paginação
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem("voxyra:mail-page-size") || "20", 10);
      return [10, 20, 30, 50, 100].includes(v) ? v : 20;
    } catch { return 20; }
  });
  const changePageSize = (n) => {
    setPageSize(n);
    setPage(1);
    try { localStorage.setItem("voxyra:mail-page-size", String(n)); } catch { /* noop */ }
  };
  // Loader de entrada no webmail (aparece na 1ª carga de mensagens)
  const [firstLoadDone, setFirstLoadDone] = useState(false);

  const isAdmin = user?.role === "superadmin" || user?.role === "empresa_admin";
  const isSpamFolder = folder === "Junk" || folder === "Spam";

  // Debounce da busca (evita re-fetch a cada tecla)
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // SWR cache: mantém dados por pasta+busca+página; revalida em focus.
  // O refresh automático agressivo foi REMOVIDO — o SSE (IMAP IDLE) notifica
  // quando algo muda, então polling periódico só drena conexões IMAP à toa.
  const swrKey = user ? ["mail-messages", folder, searchDebounced, page, pageSize] : null;
  const { data: pageData, isLoading, isValidating, mutate, error } = useSWR(
    swrKey,
    ([, f, s, p, ps]) => messagesFetcher([f, s, p, ps]),
    {
      revalidateOnFocus: true,
      revalidateIfStale: false,
      dedupingInterval: 15_000,
      // Sem refreshInterval — deixa o SSE cuidar de push
      errorRetryCount: 1,       // Evita rajadas contra o Dovecot
      errorRetryInterval: 10_000,
      shouldRetryOnError: (err) => {
        // Erros de limite de conexão IMAP não devem retryar
        const detail = String(err?.response?.data?.detail || "");
        return !/LIMIT|Maximum number of connections/i.test(detail);
      },
    }
  );

  // folder_counts agora vem embutido em `pageData` (mesma conexão IMAP).
  // Guarda o último valor conhecido para não zerar durante loading da próxima página.
  const [folderCounts, setFolderCounts] = useState({});
  useEffect(() => {
    if (pageData?.folder_counts) setFolderCounts(pageData.folder_counts);
  }, [pageData]);
  const mutateCounts = mutate; // Revalidar `/messages` já refaz os counts

  // ---- Notificações desktop ----
  const [notifPerm, setNotifPerm] = useState(() =>
    typeof Notification !== "undefined" ? Notification.permission : "unsupported");

  const requestNotifPerm = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try {
      const p = await Notification.requestPermission();
      setNotifPerm(p);
      if (p === "granted") toast.success("Notificações ativadas");
    } catch { /* noop */ }
  }, []);

  const notify = useCallback((title, body) => {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (document.visibilityState === "visible") return; // não incomoda se a aba está ativa
      const n = new Notification(title, { body, icon: "/favicon.svg", tag: "voxyra-mail" });
      setTimeout(() => n.close(), 8000);
    } catch { /* noop */ }
  }, []);

  // ---- Stream SSE (IMAP IDLE) ----
  const backendBase = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "") + "/api";
  const [streamStatus, setStreamStatus] = useState("connecting"); // connecting|live|error
  useWebmailStream({
    baseUrl: backendBase,
    enabled: !!user,
    folder: "INBOX", // sempre monitora INBOX para novos e-mails
    onEvent: (evt) => {
      if (evt.type === "ready") setStreamStatus("live");
      else if (evt.type === "error") setStreamStatus("error");
      else if (evt.type === "new_mail") {
        setStreamStatus("live");
        mutateCounts();
        // Só revalida a listagem se o usuário está na pasta afetada
        if (folder === (evt.folder || "INBOX")) mutate();
        notify("Nova mensagem", `Você recebeu uma nova mensagem em ${evt.folder || "INBOX"}.`);
      } else if (evt.type === "expunge") {
        mutateCounts();
        if (folder === (evt.folder || "INBOX")) mutate();
      }
    },
  });

  // Marca fim da primeira carga (para o splash sumir)
  useEffect(() => {
    if (pageData !== undefined || error) setFirstLoadDone(true);
  }, [pageData, error]);

  // Ao trocar de pasta ou busca, volta para página 1
  useEffect(() => { setPage(1); }, [folder, searchDebounced]);

  const messages = useMemo(() => Array.isArray(pageData?.items) ? pageData.items : [], [pageData]);
  const totalMessages = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalMessages / pageSize));
  const errorDetail = useMemo(
    () => error ? (formatApiErrorDetail(error.response?.data?.detail) || error.message) : null,
    [error]
  );
  const [errorDismissed, setErrorDismissed] = useState(false);
  useEffect(() => { setErrorDismissed(false); }, [folder, searchDebounced]);

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
    // Otimista: já mostra o preview enquanto o corpo carrega
    setSelected({ ...m, _loadingBody: true });
    try {
      const endpoint = isSpamFolder ? `/spam/messages/${m.uid}` : `/webmail/messages/${m.uid}`;
      const { data } = await api.get(endpoint, { params: { folder } });
      setSelected(data);
      // marca como lido localmente + revalida cache
      mutate(
        (prev) => {
          if (!prev) return prev;
          const items = (prev.items || []).map((x) => x.uid === m.uid ? { ...x, unread: false } : x);
          return { ...prev, items, unread: Math.max(0, (prev.unread || 0) - (m.unread ? 1 : 0)) };
        },
        { revalidate: false }
      );
      mutateCounts();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha ao abrir mensagem");
      setSelected(m);
    }
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
      _mode: "reply",
    });
    setComposing(true);
  };

  const doForward = () => {
    if (!selected) return;
    const header = `\n\n\n---------- Mensagem encaminhada ----------\nDe: ${selected.from_name ? `${selected.from_name} <${selected.from_addr}>` : selected.from_addr}\nData: ${selected.date}\nAssunto: ${selected.subject}\nPara: ${(selected.to || []).join(", ")}\n\n`;
    setComposeInitial({
      to: "",
      subject: selected.subject?.toLowerCase().startsWith("fwd:") ? selected.subject : `Fwd: ${selected.subject || ""}`,
      body: header + (selected.body_text || selected.preview || ""),
      _mode: "forward",
    });
    setComposing(true);
  };

  const doMarkUnread = async () => {
    if (!selected) return;
    try {
      await api.post(`/webmail/messages/${selected.uid}/mark-unread`, null, { params: { folder } });
      toast.success("Marcada como não lida");
      mutate(); mutateCounts();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha"); }
  };

  const doArchive = async () => {
    if (!selected) return;
    try {
      await api.post(`/webmail/messages/${selected.uid}/move`, null, {
        params: { src_folder: folder, dst_folder: "Archive" },
      });
      toast.success("Mensagem arquivada");
      setSelected(null);
      mutate(); mutateCounts();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Não foi possível arquivar"); }
  };

  const doSpam = async (addBlacklist = false) => {
    if (!selected) return;
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
      mutate(); mutateCounts();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Não foi possível mover"); }
  };

  const doNotSpam = async (addWhitelist = false) => {
    if (!selected) return;
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
      mutate(); mutateCounts();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha"); }
  };

  const doDelete = async () => {
    if (!selected) return;
    try {
      await api.delete(`/webmail/messages/${selected.uid}`, { params: { folder } });
      toast.success("Mensagem excluída");
      setSelected(null);
      mutate(); mutateCounts();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Falha"); }
  };

  const folderTitle = useMemo(() => ({
    INBOX: "Caixa de entrada", Sent: "Enviados", Drafts: "Rascunhos", Trash: "Lixeira",
    Junk: "Antispam Center", Spam: "Spam", Archive: "Arquivo", Starred: "Favoritos", Snoozed: "Adiados",
  })[folder] || folder, [folder]);

  const vertical = prefs.view_mode === "vertical";
  const loading = isLoading || (isValidating && !pageData);

  const refreshAll = () => { mutate(); mutateCounts(); };

  // Splash de entrada: enquanto a primeira coleta de mensagens não termina,
  // mostra tela full-screen com feedback claro.
  if (!firstLoadDone) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background" data-testid="webmail-loading-splash">
        <div className="text-center max-w-sm px-6">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <Mail className="w-7 h-7 animate-pulse" />
          </div>
          <div className="font-display text-2xl font-bold tracking-tight">Carregando conteúdo…</div>
          <div className="text-sm text-muted-foreground mt-1.5">
            Estamos buscando suas mensagens no servidor. Só um instante.
          </div>
          <div className="mt-6 flex justify-center gap-1">
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex overflow-hidden bg-background">
      <Sidebar
        activeFolder={folder}
        onFolderChange={(f) => { setFolder(f); setSelected(null); }}
        onCompose={() => { setComposeInitial({}); setComposing(true); }}
        folderCounts={folderCounts || {}}
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
              data-testid="mail-notif-toggle"
              onClick={() => {
                if (notifPerm === "granted") toast.info("Notificações desktop já ativadas");
                else if (notifPerm === "denied") toast.error("Notificações bloqueadas pelo navegador. Reative nas configurações do site.");
                else requestNotifPerm();
              }}
              className={`relative p-2 rounded-lg hover:bg-muted transition-colors ${notifPerm === "granted" ? "text-primary" : "text-muted-foreground"}`}
              title={notifPerm === "granted" ? "Notificações desktop ativas" : "Ativar notificações desktop"}
            >
              {notifPerm === "granted" ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              <span
                data-testid="mail-stream-status"
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                  streamStatus === "live" ? "bg-emerald-500" : streamStatus === "error" ? "bg-red-500" : "bg-amber-500"
                }`}
                title={`Push: ${streamStatus === "live" ? "conectado" : streamStatus === "error" ? "erro" : "conectando"}`}
              />
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
              onClick={() => navigate("/mail/settings")}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
              title="Configurações do webmail"
            >
              <Settings className="w-4 h-4" />
            </button>

            <div className="h-8 w-8 rounded-full bg-primary/12 text-primary flex items-center justify-center text-xs font-bold">
              {(user?.name || "?").slice(0, 2).toUpperCase()}
            </div>
          </div>
        </div>

        {isAdmin && <StatsBar stats={stats} />}

        {/* Banner de erro (IMAP inacessível, senha faltando etc) */}
        {errorDetail && !loading && !errorDismissed && (
          <div className="px-6 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 flex items-start gap-2 text-xs">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"/>
            <div className="flex-1 text-amber-900 dark:text-amber-200">
              <strong>Não foi possível carregar mensagens do servidor:</strong> {errorDetail}
              <button onClick={() => mutate()} className="ml-2 underline hover:no-underline">Tentar novamente</button>
            </div>
            <button
              data-testid="mail-error-dismiss"
              onClick={() => setErrorDismissed(true)}
              className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 flex-shrink-0"
              title="Dispensar aviso"
            >
              ×
            </button>
          </div>
        )}

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
                onRefresh={refreshAll}
                folderTitle={folderTitle}
                folderSubtitle={user?.email || ""}
                page={page}
                pageSize={pageSize}
                total={totalMessages}
                totalPages={totalPages}
                onPageChange={setPage}
                onPageSizeChange={changePageSize}
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
                onForward={doForward}
                onMarkUnread={doMarkUnread}
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
        onSent={() => { mutate(); mutateCounts(); }}
      />
    </div>
  );
}
