import { Archive, ShieldAlert, Reply, MoreHorizontal, Trash2, Forward, MailOpen } from "lucide-react";
import DOMPurify from "dompurify";
import { MAIL } from "@/lib/testIds";

// Configuração restritiva para HTML de e-mail: sem scripts, sem event handlers,
// links abrem em nova aba com noopener.
const SANITIZE_CONFIG = {
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "meta", "link"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "srcset", "formaction"],
  ALLOW_DATA_ATTR: false,
};

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

export default function ReadingPane({ message, onArchive, onSpam, onDelete, onReply, onClose, onReplyQuick }) {
  if (!message) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background/40 dark:bg-slate-950/40">
        <div className="text-center text-muted-foreground max-w-sm px-6">
          <MailOpen className="w-14 h-14 mx-auto mb-3 text-muted-foreground/40" />
          <div className="font-display text-lg font-bold text-foreground">Selecione uma mensagem</div>
          <p className="text-sm mt-1">Escolha um item na lista à esquerda para visualizar seu conteúdo aqui.</p>
        </div>
      </div>
    );
  }

  const body = message.body_html
    ? <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.body_html, SANITIZE_CONFIG) }} />
    : <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.body_text || message.preview || ""}</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background/40 dark:bg-slate-950/40">
      {/* Action bar */}
      <div className="p-4 border-b border-border flex items-center gap-2 flex-wrap bg-card">
        <button
          data-testid={MAIL.archiveBtn}
          onClick={onArchive}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors"
        >
          <Archive className="w-3.5 h-3.5" /> Arquivar
        </button>
        <button
          data-testid={MAIL.spamBtn}
          onClick={onSpam}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors"
        >
          <ShieldAlert className="w-3.5 h-3.5" /> Marcar spam
        </button>
        <button
          data-testid={MAIL.replyBtn}
          onClick={onReply}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-blue-700 transition-colors"
        >
          <Reply className="w-3.5 h-3.5" /> Responder
        </button>
        <button
          data-testid={MAIL.deleteBtn}
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5" /> Excluir
        </button>
        <button
          data-testid={MAIL.moreBtn}
          className="p-2 rounded-lg border border-border hover:bg-muted transition-colors ml-auto"
          title="Mais ações"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto voxyra-scroll p-6">
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <h1 className="font-display text-3xl font-bold tracking-tight">{message.subject || "(sem assunto)"}</h1>
          {message.folder && (
            <span className="px-2 py-0.5 rounded-full bg-primary/12 text-primary text-[11px] font-semibold uppercase tracking-wider">
              {message.folder}
            </span>
          )}
        </div>

        <div className="flex items-start gap-3 mb-6">
          <div className="h-10 w-10 rounded-full bg-primary/12 text-primary flex items-center justify-center text-sm font-bold">
            {(message.from_name || message.from_addr || "?").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{message.from_name || message.from_addr}</div>
            <div className="text-xs text-muted-foreground truncate">
              {message.from_addr} para {(message.to || []).join(", ")}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{message.date}</div>
        </div>

        <div className="border border-border rounded-xl p-6 bg-card">
          {body}
        </div>

        {message.attachments?.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Anexos ({message.attachments.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((a, i) => (
                <div key={`${a.filename || 'att'}-${a.size || 0}-${i}`} className="px-3 py-2 rounded-lg border border-border bg-card text-xs flex items-center gap-2">
                  📎 <span className="truncate max-w-[180px]">{a.filename}</span>
                  <span className="text-muted-foreground">{Math.ceil((a.size || 0) / 1024)} KB</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick reply */}
        <div className="mt-6">
          <button
            data-testid="reading-quick-reply-btn"
            onClick={onReplyQuick}
            className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-sm text-muted-foreground"
          >
            <Forward className="w-4 h-4" /> Clique aqui para responder rapidamente…
          </button>
        </div>
      </div>
    </div>
  );
}
