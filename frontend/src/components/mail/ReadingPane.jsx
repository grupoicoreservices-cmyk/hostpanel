import { useEffect, useRef, useState } from "react";
import { Archive, ShieldAlert, ShieldCheck, Reply, MoreHorizontal, Trash2, Forward, MailOpen, Ban, ExternalLink, Printer, Code, EyeOff, Download, FileText, Image as ImageIcon, FileArchive, FileSpreadsheet } from "lucide-react";
import DOMPurify from "dompurify";
import { MAIL } from "@/lib/testIds";
import { api } from "@/lib/api";
import { toast } from "sonner";

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

export default function ReadingPane({
  message, onArchive, onSpam, onDelete, onReply, onClose, onReplyQuick,
  onNotSpam, onBlockSender, isSpamFolder, onOpenInNewTab, hideOpenNewTab,
  onForward, onMarkUnread, onShowSource,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [rawOpen, setRawOpen] = useState(false);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

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

  const doPrint = () => {
    setMenuOpen(false);
    const html = message.body_html ? DOMPurify.sanitize(message.body_html, SANITIZE_CONFIG) : `<pre style="white-space:pre-wrap;font-family:sans-serif">${escapeHtml(message.body_text || "")}</pre>`;
    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(message.subject || "")}</title>
      <style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;color:#111}
      h1{font-size:20px;margin:0 0 4px 0}.meta{color:#555;font-size:12px;margin-bottom:16px}
      .body{border-top:1px solid #ddd;padding-top:16px}</style></head><body>
      <h1>${escapeHtml(message.subject || "")}</h1>
      <div class="meta">De ${escapeHtml(message.from_addr || "")} · ${escapeHtml(message.date || "")}</div>
      <div class="body">${html}</div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background/40 dark:bg-slate-950/40">
      {/* Action bar */}
      <div className="p-4 border-b border-border flex items-center gap-2 flex-wrap bg-card relative" ref={menuRef}>
        {isSpamFolder ? (
          <>
            <button data-testid="reading-not-spam-btn" onClick={() => onNotSpam?.(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors">
              <ShieldCheck className="w-3.5 h-3.5" /> Não é spam
            </button>
            <button data-testid="reading-not-spam-wl-btn" onClick={() => onNotSpam?.(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
              title="Move para a Entrada e adiciona remetente ao whitelist do DirectAdmin">
              <ShieldCheck className="w-3.5 h-3.5" /> Não é spam + Whitelist
            </button>
          </>
        ) : (
          <>
            <button data-testid={MAIL.archiveBtn} onClick={onArchive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors">
              <Archive className="w-3.5 h-3.5" /> Arquivar
            </button>
            <button data-testid={MAIL.spamBtn} onClick={() => onSpam?.(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors">
              <ShieldAlert className="w-3.5 h-3.5" /> Marcar spam
            </button>
            <button data-testid="reading-spam-bl-btn" onClick={() => onSpam?.(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors"
              title="Move para o Spam e adiciona remetente ao blacklist do DirectAdmin">
              <Ban className="w-3.5 h-3.5" /> Spam + Bloquear remetente
            </button>
            <button data-testid={MAIL.replyBtn} onClick={onReply}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-blue-700 transition-colors">
              <Reply className="w-3.5 h-3.5" /> Responder
            </button>
            <button data-testid="reading-forward-btn" onClick={onForward}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors">
              <Forward className="w-3.5 h-3.5" /> Encaminhar
            </button>
          </>
        )}
        <button data-testid={MAIL.deleteBtn} onClick={onDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors text-destructive">
          <Trash2 className="w-3.5 h-3.5" /> Excluir
        </button>

        {/* Ações agrupadas no menu de 3 pontos — agora funcional */}
        <div className="ml-auto flex items-center gap-2">
          {!hideOpenNewTab && onOpenInNewTab && (
            <button data-testid="reading-open-new-tab-btn" onClick={onOpenInNewTab}
              className="p-2 rounded-lg border border-border hover:bg-muted transition-colors"
              title="Abrir em nova aba">
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          <div className="relative">
            <button
              data-testid={MAIL.moreBtn}
              onClick={() => setMenuOpen((v) => !v)}
              className="p-2 rounded-lg border border-border hover:bg-muted transition-colors"
              title="Mais ações"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 w-56 z-30 bg-card border border-border rounded-xl shadow-xl p-1">
                <MenuItem icon={Forward} label="Encaminhar" onClick={() => { setMenuOpen(false); onForward?.(); }} testid="reading-menu-forward"/>
                <MenuItem icon={EyeOff} label="Marcar como não lida" onClick={() => { setMenuOpen(false); onMarkUnread?.(); }} testid="reading-menu-unread"/>
                <MenuItem icon={Printer} label="Imprimir" onClick={doPrint} testid="reading-menu-print"/>
                <MenuItem icon={Code} label={rawOpen ? "Ocultar cabeçalhos" : "Mostrar cabeçalhos"}
                  onClick={() => { setMenuOpen(false); setRawOpen((v) => !v); onShowSource?.(); }}
                  testid="reading-menu-source"/>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content — scrollbar sempre visível via voxyra-scroll-visible.
          `min-h-0` é crítico: sem ele, `flex-1` num flex-col ganha
          min-height:auto e o overflow-y-scroll interno é ignorado. */}
      <div className="flex-1 min-h-0 overflow-y-scroll voxyra-scroll-visible p-6" data-testid="reading-scroll-area">
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

        {rawOpen && (
          <details open className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-[11px] font-mono">
            <summary className="cursor-pointer font-semibold">Cabeçalhos técnicos</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all">
{`Message-ID: ${message.message_id || "—"}
From: ${message.from_name ? `${message.from_name} <${message.from_addr}>` : message.from_addr}
To: ${(message.to || []).join(", ")}
Date: ${message.date}
Folder: ${message.folder}
Spam-Score: ${message.spam_score ?? "—"}
Spam-Status: ${message.spam_status || "—"}`}
            </pre>
          </details>
        )}

        <div className="border border-border rounded-xl p-6 bg-card">
          {(message.spam_flag || (typeof message.spam_score === "number" && message.spam_score >= 3)) && (
            <div data-testid="reading-spam-warning"
              className="mb-4 flex items-start gap-3 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3">
              <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-xs">
                <div className="font-semibold text-red-800 dark:text-red-300">
                  Marcada como spam pelo SpamAssassin
                  {typeof message.spam_score === "number" && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-red-200 dark:bg-red-900 text-red-900 dark:text-red-100 font-mono">
                      score {message.spam_score.toFixed(1)}
                    </span>
                  )}
                </div>
                {message.spam_status && (
                  <div className="mt-1 text-red-700/80 dark:text-red-300/80 font-mono break-all">
                    {message.spam_status}
                  </div>
                )}
              </div>
            </div>
          )}
          {body}
        </div>

        {message.attachments?.length > 0 && (
          <div className="mt-4" data-testid="reading-attachments">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Anexos ({message.attachments.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((a, i) => (
                <AttachmentChip
                  key={`${a.filename || 'att'}-${a.size || 0}-${i}`}
                  attachment={a}
                  index={a.index ?? i}
                  uid={message.uid}
                  folder={message.folder || "INBOX"}
                />
              ))}
            </div>
          </div>
        )}

        {/* Quick reply */}
        <div className="mt-6 flex gap-2">
          <button data-testid="reading-quick-reply-btn" onClick={onReplyQuick}
            className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-sm text-muted-foreground">
            <Reply className="w-4 h-4" /> Responder rapidamente…
          </button>
          <button data-testid="reading-quick-forward-btn" onClick={onForward}
            className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-sm text-muted-foreground">
            <Forward className="w-4 h-4" /> Encaminhar…
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, testid }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm text-left"
    >
      <Icon className="w-4 h-4 text-muted-foreground"/>
      <span>{label}</span>
    </button>
  );
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function iconForMime(mime, filename) {
  const m = String(mime || "").toLowerCase();
  const ext = String(filename || "").split(".").pop().toLowerCase();
  if (m.startsWith("image/") || ["png","jpg","jpeg","gif","webp","svg","bmp"].includes(ext)) return ImageIcon;
  if (["zip","rar","7z","tar","gz","bz2"].includes(ext) || m.includes("zip") || m.includes("compressed")) return FileArchive;
  if (["xls","xlsx","csv","ods"].includes(ext) || m.includes("spreadsheet")) return FileSpreadsheet;
  return FileText;
}

function formatBytesRP(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentChip({ attachment, index, uid, folder }) {
  const [busy, setBusy] = useState(false);
  const Icon = iconForMime(attachment.content_type, attachment.filename);

  const download = async () => {
    setBusy(true);
    try {
      const res = await api.get(`/webmail/messages/${encodeURIComponent(uid)}/attachment/${index}`, {
        params: { folder },
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: attachment.content_type || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.filename || "arquivo";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // libera memória em seguida
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e?.response?.data?.detail ? String(e.response.data.detail) : "Falha ao baixar anexo");
    } finally { setBusy(false); }
  };

  return (
    <div
      data-testid={`attachment-chip-${index}`}
      className="px-3 py-2 rounded-lg border border-border bg-card text-xs flex items-center gap-2 group hover:border-primary/40 transition-colors"
    >
      <Icon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
      <span className="truncate max-w-[220px]" title={attachment.filename}>{attachment.filename}</span>
      <span className="text-muted-foreground">{formatBytesRP(attachment.size)}</span>
      <button
        data-testid={`attachment-download-${index}`}
        onClick={download}
        disabled={busy}
        className="ml-1 p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
        title="Baixar"
      >
        <Download className={`w-3.5 h-3.5 ${busy ? "animate-pulse" : ""}`} />
      </button>
    </div>
  );
}
