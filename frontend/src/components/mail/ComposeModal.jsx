import { useState } from "react";
import { X, Paperclip, Smile, Type, MoreHorizontal, Minus, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { MAIL } from "@/lib/testIds";

export default function ComposeModal({ open, onClose, initial = {}, onSent }) {
  const [to, setTo] = useState(initial.to || "");
  const [subject, setSubject] = useState(initial.subject || "");
  const [body, setBody] = useState(initial.body || "");
  const [sending, setSending] = useState(false);
  const [minimized, setMinimized] = useState(false);

  if (!open) return null;

  const send = async () => {
    if (!to.trim()) { toast.error("Informe o destinatário"); return; }
    setSending(true);
    try {
      await api.post("/webmail/send", {
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: subject || "(sem assunto)",
        body_text: body,
      });
      toast.success("Mensagem enviada");
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`fixed z-50 bottom-6 right-6 w-[520px] max-w-[calc(100vw-32px)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden voxyra-compose-anim ${
      minimized ? "h-14" : "h-[560px] max-h-[calc(100vh-48px)]"
    }`}>
      <div className="bg-slate-900 text-white px-4 py-3 flex items-center gap-2">
        <div className="font-display font-semibold text-sm flex-1">Nova mensagem</div>
        <button onClick={() => setMinimized(!minimized)} className="p-1 hover:bg-white/10 rounded" title="Minimizar">
          {minimized ? <Maximize2 className="w-3.5 h-3.5"/> : <Minus className="w-3.5 h-3.5"/>}
        </button>
        <button
          data-testid={MAIL.composeClose}
          onClick={onClose}
          className="p-1 hover:bg-white/10 rounded"
          title="Fechar"
        >
          <X className="w-4 h-4"/>
        </button>
      </div>

      {!minimized && (
        <>
          <div className="p-3 border-b border-border">
            <input
              data-testid={MAIL.composeTo}
              placeholder="Para"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-2 py-2 text-sm bg-transparent focus:outline-none border-b border-border/50"
            />
            <input
              data-testid={MAIL.composeSubject}
              placeholder="Assunto"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-2 py-2 text-sm bg-transparent focus:outline-none"
            />
          </div>
          <textarea
            data-testid={MAIL.composeBody}
            placeholder="Escreva sua mensagem…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="flex-1 px-4 py-3 text-sm bg-transparent focus:outline-none resize-none voxyra-scroll"
          />
          <div className="p-3 border-t border-border flex items-center gap-2">
            <button
              data-testid={MAIL.composeSend}
              onClick={send}
              disabled={sending}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-5 py-2 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all disabled:opacity-60"
            >
              {sending ? "Enviando…" : "Enviar"}
            </button>
            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Anexar">
              <Paperclip className="w-4 h-4"/>
            </button>
            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Formatar">
              <Type className="w-4 h-4"/>
            </button>
            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Emoji">
              <Smile className="w-4 h-4"/>
            </button>
            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground ml-auto" title="Mais">
              <MoreHorizontal className="w-4 h-4"/>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
