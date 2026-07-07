import { useEffect, useRef, useState } from "react";
import { X, Paperclip, Smile, Type, MoreHorizontal, Minus, Maximize2, Send, Clock, ChevronDown, FileText } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "@/lib/api";
import { MAIL } from "@/lib/testIds";
import { usePrefs } from "@/context/PrefsContext";

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const SIGNATURE_SEP = "\n\n-- \n";

/** Modal de composição — suporta envio imediato, encaminhamento e agendamento. */
export default function ComposeModal({ open, onClose, initial = {}, onSent }) {
  const { prefs } = usePrefs() || { prefs: { signature: "" } };
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [sending, setSending] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(""); // datetime-local string

  // Reset dos campos quando o modal é aberto com um novo `initial`
  useEffect(() => {
    if (open) {
      setTo(initial.to || "");
      setCc(initial.cc || "");
      setSubject(initial.subject || "");
      // Anexa assinatura ao final somente se não existir separador ainda no corpo
      const baseBody = initial.body || "";
      const sig = (prefs?.signature || "").trim();
      const nextBody = sig && !baseBody.includes("\n-- \n") ? `${baseBody}${SIGNATURE_SEP}${sig}` : baseBody;
      setBody(nextBody);
      setShowCc(!!initial.cc);
      setScheduleOpen(false);
      setScheduleAt(defaultScheduleAt());
      setAttachments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial.to, initial.subject, initial.body, initial.cc]);

  if (!open) return null;

  const totalAttBytes = attachments.reduce((s, f) => s + (f.size || 0), 0);
  const overLimit = totalAttBytes > MAX_TOTAL_BYTES;

  const addFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);
    const nextTotal = totalAttBytes + incoming.reduce((s, f) => s + f.size, 0);
    if (nextTotal > MAX_TOTAL_BYTES) {
      toast.error(`Anexos excedem 25 MB (total ficaria em ${(nextTotal / (1024 * 1024)).toFixed(1)} MB)`);
      return;
    }
    setAttachments((prev) => [...prev, ...incoming]);
  };

  const removeAttachment = (idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const buildPayload = () => ({
    to: to.split(",").map((s) => s.trim()).filter(Boolean),
    cc: cc.split(",").map((s) => s.trim()).filter(Boolean),
    subject: subject || "(sem assunto)",
    body_text: body,
  });

  const send = async () => {
    if (!to.trim()) { toast.error("Informe o destinatário"); return; }
    if (overLimit) { toast.error("Remova alguns anexos (limite 25 MB)"); return; }
    setSending(true);
    try {
      if (attachments.length > 0) {
        const fd = new FormData();
        fd.append("to", to);
        if (cc) fd.append("cc", cc);
        fd.append("subject", subject || "(sem assunto)");
        fd.append("body_text", body || "");
        attachments.forEach((f) => fd.append("attachments", f, f.name));
        await api.post("/webmail/send-with-attachments", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        await api.post("/webmail/send", buildPayload());
      }
      toast.success("Mensagem enviada");
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setSending(false); }
  };

  const schedule = async () => {
    if (!to.trim()) { toast.error("Informe o destinatário"); return; }
    if (!scheduleAt) { toast.error("Escolha data e hora"); return; }
    if (attachments.length > 0) {
      toast.error("Anexos ainda não são suportados em envio agendado. Envie agora ou remova os anexos.");
      return;
    }
    const when = new Date(scheduleAt);
    if (isNaN(when) || when.getTime() < Date.now() + 30_000) {
      toast.error("Escolha uma data no futuro (mín. 1 min à frente)");
      return;
    }
    setSending(true);
    try {
      await api.post("/webmail/schedule", {
        ...buildPayload(),
        scheduled_at: when.toISOString(),
      });
      toast.success(`Agendado para ${when.toLocaleString("pt-BR")}`);
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setSending(false); }
  };

  const title = initial._mode === "forward"
    ? "Encaminhar mensagem"
    : initial._mode === "reply"
      ? "Responder"
      : "Nova mensagem";

  return (
    <div className={`fixed z-50 bottom-6 right-6 w-[560px] max-w-[calc(100vw-32px)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden voxyra-compose-anim ${
      minimized ? "h-14" : "h-[620px] max-h-[calc(100vh-48px)]"
    }`}>
      <div className="bg-slate-900 text-white px-4 py-3 flex items-center gap-2">
        <div className="font-display font-semibold text-sm flex-1">{title}</div>
        <button onClick={() => setMinimized(!minimized)} className="p-1 hover:bg-white/10 rounded" title="Minimizar">
          {minimized ? <Maximize2 className="w-3.5 h-3.5"/> : <Minus className="w-3.5 h-3.5"/>}
        </button>
        <button data-testid={MAIL.composeClose} onClick={onClose} className="p-1 hover:bg-white/10 rounded" title="Fechar">
          <X className="w-4 h-4"/>
        </button>
      </div>

      {!minimized && (
        <>
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2 border-b border-border/50">
              <input
                data-testid={MAIL.composeTo}
                placeholder="Para"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="flex-1 px-2 py-2 text-sm bg-transparent focus:outline-none"
              />
              {!showCc && (
                <button
                  data-testid="compose-toggle-cc"
                  onClick={() => setShowCc(true)}
                  className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground hover:text-primary px-2"
                >
                  Cc
                </button>
              )}
            </div>
            {showCc && (
              <input
                data-testid="compose-cc"
                placeholder="Cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                className="w-full px-2 py-2 text-sm bg-transparent focus:outline-none border-b border-border/50"
              />
            )}
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
            placeholder={initial._mode === "forward" ? "Adicione um comentário (opcional)…" : "Escreva sua mensagem…"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="flex-1 px-4 py-3 text-sm bg-transparent focus:outline-none resize-none voxyra-scroll-visible"
          />

          {attachments.length > 0 && (
            <div
              data-testid="compose-attachments-list"
              className="px-3 pt-2 pb-1 border-t border-border bg-muted/30 flex flex-wrap gap-2"
            >
              {attachments.map((f, i) => (
                <div
                  key={`${f.name}-${f.size}-${i}`}
                  data-testid={`compose-attachment-${i}`}
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-card border border-border text-xs"
                  title={`${f.name} — ${formatBytes(f.size)}`}
                >
                  <FileText className="w-3.5 h-3.5 text-primary flex-shrink-0"/>
                  <span className="truncate max-w-[160px]">{f.name}</span>
                  <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                  <button
                    data-testid={`compose-attachment-remove-${i}`}
                    onClick={() => removeAttachment(i)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Remover anexo"
                  >
                    <X className="w-3.5 h-3.5"/>
                  </button>
                </div>
              ))}
              <div className={`ml-auto text-[10px] font-semibold uppercase tracking-widest ${overLimit ? "text-destructive" : "text-muted-foreground"}`}>
                {formatBytes(totalAttBytes)} / 25 MB
              </div>
            </div>
          )}

          <input
            data-testid="compose-file-input"
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />

          <div className="p-3 border-t border-border flex items-center gap-2 flex-wrap">
            {/* Split button: Enviar | Agendar */}
            <div className="inline-flex rounded-full overflow-hidden shadow-sm">
              <button
                data-testid={MAIL.composeSend}
                onClick={send}
                disabled={sending}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 font-semibold text-sm hover:bg-blue-700 active:scale-[.98] transition-all disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5"/> {sending ? "Enviando…" : "Enviar"}
              </button>
              <button
                data-testid="compose-schedule-toggle"
                onClick={() => setScheduleOpen((v) => !v)}
                disabled={sending}
                className="bg-primary/90 text-primary-foreground px-3 border-l border-primary-foreground/20 hover:bg-blue-700 transition-colors disabled:opacity-60"
                title="Agendar envio"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${scheduleOpen ? "rotate-180" : ""}`}/>
              </button>
            </div>

            <button
              data-testid="compose-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
              title="Anexar arquivos (máx. 25 MB)"
            >
              <Paperclip className="w-4 h-4"/>
            </button>
            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Formatar (em breve)">
              <Type className="w-4 h-4"/>
            </button>
            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Emoji (em breve)">
              <Smile className="w-4 h-4"/>
            </button>
            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground ml-auto" title="Mais">
              <MoreHorizontal className="w-4 h-4"/>
            </button>
          </div>

          {scheduleOpen && (
            <div data-testid="compose-schedule-panel" className="border-t border-border bg-muted/40 p-4 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-1">
                  <Clock className="w-3 h-3"/> Enviar em
                </label>
                <input
                  data-testid="compose-schedule-input"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  min={defaultScheduleAt()}
                  className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="flex gap-1.5">
                {[
                  { label: "+1h", ms: 3600e3 },
                  { label: "amanhã 9h", fn: () => setNextMorning(setScheduleAt) },
                  { label: "seg 9h", fn: () => setNextMonday(setScheduleAt) },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => p.fn ? p.fn() : setScheduleAt(fmtLocal(new Date(Date.now() + p.ms)))}
                    className="px-2.5 py-1.5 rounded-md border border-border text-[11px] font-semibold hover:bg-card transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                data-testid="compose-schedule-submit"
                onClick={schedule}
                disabled={sending}
                className="inline-flex items-center gap-1.5 bg-emerald-600 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
              >
                <Clock className="w-3.5 h-3.5"/> Agendar envio
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */
function pad(n) { return String(n).padStart(2, "0"); }
function formatBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultScheduleAt() {
  const d = new Date(Date.now() + 3600e3); // +1h
  d.setSeconds(0, 0);
  return fmtLocal(d);
}
function setNextMorning(setter) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  setter(fmtLocal(d));
}
function setNextMonday(setter) {
  const d = new Date();
  const diff = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(9, 0, 0, 0);
  setter(fmtLocal(d));
}
