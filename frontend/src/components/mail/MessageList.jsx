import { RefreshCw, MoreHorizontal, Star, Paperclip, AlertCircle } from "lucide-react";
import { MAIL } from "@/lib/testIds";

const TABS = [
  { id: "principal",  label: "Principal" },
  { id: "social",     label: "Social" },
  { id: "promocoes",  label: "Promoções" },
  { id: "sistema",    label: "Sistema" },
];

export default function MessageList({
  messages,
  loading,
  activeTab,
  onTabChange,
  selectedUid,
  onSelect,
  onRefresh,
  folderTitle,
  folderSubtitle,
}) {
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-card overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold tracking-tight truncate">{folderTitle}</h2>
          <div className="text-xs text-muted-foreground truncate mt-0.5">{folderSubtitle}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            data-testid={MAIL.refreshBtn}
            onClick={onRefresh}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors">
            Mais
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-card">
        {TABS.map((t) => (
          <button
            key={t.id}
            data-testid={`${MAIL.tabPrefix}${t.id}`}
            onClick={() => onTabChange(t.id)}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto voxyra-scroll">
        {loading && messages.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando mensagens…</div>
        )}
        {!loading && messages.length === 0 && (
          <div className="p-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <div className="text-sm font-semibold text-foreground">Sem mensagens nesta pasta</div>
            <div className="text-xs text-muted-foreground mt-1">
              Cadastre um servidor DirectAdmin, um domínio e uma conta de e-mail para começar a receber mensagens reais via IMAP.
            </div>
          </div>
        )}

        <ul>
          {messages.map((m) => {
            const active = selectedUid === m.uid;
            return (
              <li key={m.uid}>
                <button
                  data-testid={`${MAIL.messageRowPrefix}${m.uid}`}
                  onClick={() => onSelect(m)}
                  className={`w-full text-left px-4 py-3 border-b border-border flex items-center gap-3 transition-colors ${
                    active
                      ? "bg-primary/8 border-l-4 border-l-primary"
                      : m.unread
                        ? "bg-card hover:bg-blue-50 dark:hover:bg-slate-800"
                        : "bg-card/60 hover:bg-blue-50/60 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <input
                    data-testid={`${MAIL.messageCheckbox}${m.uid}`}
                    type="checkbox"
                    onClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 rounded border-border"
                  />
                  <Star
                    data-testid={`${MAIL.messageStar}${m.uid}`}
                    onClick={(e) => e.stopPropagation()}
                    className={`w-4 h-4 flex-shrink-0 cursor-pointer transition-colors ${
                      m.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm truncate ${m.unread ? "font-bold" : "font-medium"}`}>
                        {m.from_name || m.from_addr}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm truncate ${m.unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {m.subject}
                      </span>
                      {m.preview && (
                        <>
                          <span className="text-muted-foreground/60">—</span>
                          <span className="text-xs text-muted-foreground truncate">{m.preview}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {m.has_attachment && <Paperclip className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                  <div className={`text-[11px] flex-shrink-0 font-medium ${m.unread ? "text-primary" : "text-muted-foreground"}`}>
                    {formatDate(m.date)}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function formatDate(str) {
  if (!str) return "";
  try {
    const d = new Date(str);
    if (isNaN(d)) return String(str).slice(0, 10);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  } catch {
    return String(str).slice(0, 10);
  }
}
