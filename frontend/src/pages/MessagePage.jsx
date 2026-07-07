import { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Mail } from "lucide-react";
import { toast } from "sonner";

import ReadingPane from "@/components/mail/ReadingPane";
import ComposeModal from "@/components/mail/ComposeModal";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/** Página standalone para abrir uma única mensagem em nova aba. */
export default function MessagePage() {
  const { uid } = useParams();
  const [params] = useSearchParams();
  const folder = params.get("folder") || "INBOX";
  const navigate = useNavigate();
  const { user } = useAuth();

  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [composeInitial, setComposeInitial] = useState({});

  const isSpamFolder = folder === "Junk" || folder === "Spam";

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const endpoint = isSpamFolder
          ? `/spam/messages/${uid}`
          : `/webmail/messages/${uid}`;
        const { data } = await api.get(endpoint, { params: { folder } });
        if (!cancel) setMessage(data);
      } catch (e) {
        toast.error("Falha ao carregar mensagem");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [uid, folder, isSpamFolder]);

  const doReply = () => {
    if (!message) return;
    setComposeInitial({
      to: message.from_addr,
      subject: message.subject?.startsWith("Re:") ? message.subject : `Re: ${message.subject || ""}`,
      body: `\n\n\n--- Mensagem original ---\nDe: ${message.from_addr}\n${(message.body_text || "").slice(0, 500)}`,
    });
    setComposing(true);
  };

  const doArchive = async () => {
    if (!message) return;
    try {
      await api.post(`/webmail/messages/${message.uid}/move`, null, {
        params: { src_folder: folder, dst_folder: "Archive" },
      });
      toast.success("Arquivada");
      window.close();
    } catch { toast.error("Falha ao arquivar"); }
  };

  const doDelete = async () => {
    if (!message) return;
    try {
      await api.delete(`/webmail/messages/${message.uid}`, { params: { folder } });
      toast.success("Excluída");
      window.close();
    } catch { toast.error("Falha ao excluir"); }
  };

  const doSpam = async (addBlacklist = false) => {
    if (!message) return;
    try {
      await api.post("/spam/report", {
        uids: [message.uid],
        src_folder: folder,
        add_blacklist: addBlacklist,
      });
      toast.success("Movida para spam");
      window.close();
    } catch { toast.error("Falha ao mover"); }
  };

  const doNotSpam = async (addWhitelist = false) => {
    if (!message) return;
    try {
      await api.post("/spam/not-spam", {
        uids: [message.uid],
        folder,
        add_whitelist: addWhitelist,
      });
      toast.success("Restaurada");
      window.close();
    } catch { toast.error("Falha ao restaurar"); }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-background overflow-hidden" data-testid="message-page">
      {/* Barra superior compacta */}
      <div className="border-b border-border bg-card flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/mail"))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
          <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Mail className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display font-bold text-sm truncate">Voxyra Webmail</div>
            <div className="text-[11px] text-muted-foreground truncate">{user?.email}</div>
          </div>
          <button
            onClick={() => window.close()}
            className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors"
            title="Fechar aba"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Reading pane full width */}
      <div className="flex-1 flex min-h-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Carregando mensagem…
          </div>
        ) : (
          <ReadingPane
            message={message}
            onArchive={doArchive}
            onSpam={doSpam}
            onNotSpam={doNotSpam}
            onDelete={doDelete}
            onReply={doReply}
            onReplyQuick={doReply}
            onClose={() => window.close()}
            isSpamFolder={isSpamFolder}
            hideOpenNewTab
          />
        )}
      </div>

      <ComposeModal
        open={composing}
        initial={composeInitial}
        onClose={() => setComposing(false)}
        onSent={() => window.close()}
      />
    </div>
  );
}
