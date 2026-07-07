import { useState, useMemo, useEffect } from "react";
import { RefreshCw, Star, Paperclip, AlertCircle, SlidersHorizontal, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { MAIL } from "@/lib/testIds";

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

/** Chaves das colunas configuráveis (persistidas em localStorage). */
const COLUMN_DEFS = [
  { id: "preview",   label: "Prévia do texto" },
  { id: "recipient", label: "Destinatário (Para)" },
  { id: "size",      label: "Tamanho" },
];
const DEFAULT_COLUMNS = { preview: true, recipient: false, size: false };

function readColumns() {
  try {
    const raw = localStorage.getItem("voxyra:mail-columns");
    if (!raw) return DEFAULT_COLUMNS;
    return { ...DEFAULT_COLUMNS, ...JSON.parse(raw) };
  } catch { return DEFAULT_COLUMNS; }
}
function saveColumns(cols) {
  try { localStorage.setItem("voxyra:mail-columns", JSON.stringify(cols)); } catch { /* noop */ }
}

export default function MessageList({
  messages,
  loading,
  selectedUid,
  onSelect,
  onRefresh,
  folderTitle,
  folderSubtitle,
  page = 1,
  pageSize = 20,
  total = 0,
  totalPages = 1,
  onPageChange,
  onPageSizeChange,
}) {
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [colsOpen, setColsOpen] = useState(false);

  // Hidrata as colunas do localStorage no mount
  useEffect(() => { setColumns(readColumns()); }, []);

  const toggleCol = (id) => {
    setColumns((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveColumns(next);
      return next;
    });
  };

  // Fecha o dropdown de colunas ao clicar fora
  useEffect(() => {
    if (!colsOpen) return;
    const onDocClick = (e) => {
      if (!e.target.closest?.("[data-columns-menu]")) setColsOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [colsOpen]);

  const empty = !loading && messages.length === 0;
  const activeCols = useMemo(() =>
    COLUMN_DEFS.filter(c => columns[c.id]).map(c => c.id), [columns]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-card overflow-hidden h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold tracking-tight truncate">{folderTitle}</h2>
          <div className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="truncate">{folderSubtitle}</span>
            {total > 0 && (
              <span
                data-testid="mail-total-count"
                className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-muted text-[10px] font-semibold"
                title={`${total} mensagens no total`}
              >
                {total} {total === 1 ? "mensagem" : "mensagens"}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 relative" data-columns-menu>
          <button
            data-testid="mail-columns-btn"
            onClick={() => setColsOpen(o => !o)}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            title="Configurar colunas"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          {colsOpen && (
            <div className="absolute right-0 top-11 w-56 z-30 bg-card border border-border rounded-xl shadow-xl p-1">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Exibir colunas
              </div>
              {COLUMN_DEFS.map((c) => (
                <button
                  key={c.id}
                  data-testid={`mail-column-toggle-${c.id}`}
                  onClick={() => toggleCol(c.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm text-left"
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center border ${columns[c.id] ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                    {columns[c.id] && <Check className="w-3 h-3" />}
                  </span>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          )}
          <button
            data-testid={MAIL.refreshBtn}
            onClick={onRefresh}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto voxyra-scroll">
        {loading && (
          <div className="p-6 text-center" data-testid="messagelist-loading">
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <RefreshCw className="w-4 h-4 animate-spin text-primary" />
              Carregando mensagens…
            </div>
            {/* Skeleton rows enquanto a lista real não chega */}
            <ul className="text-left">
              {[...Array(6)].map((_, i) => (
                <li key={i} className="px-4 py-3 border-b border-border flex items-start gap-3 animate-pulse">
                  <div className="w-3.5 h-3.5 mt-1 rounded bg-muted flex-shrink-0" />
                  <div className="w-4 h-4 mt-0.5 rounded bg-muted flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="h-3 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-4/5" />
                    <div className="h-2.5 bg-muted/60 rounded w-3/5" />
                  </div>
                  <div className="w-10 h-3 bg-muted rounded flex-shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {empty && !loading && (
          <div className="p-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <div className="text-sm font-semibold text-foreground">Sem mensagens nesta pasta</div>
            <div className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Se você acabou de configurar sua caixa, aguarde alguns segundos e clique em atualizar.
              Caso contrário, verifique se o servidor IMAP do domínio está acessível e as credenciais estão corretas.
            </div>
          </div>
        )}

        <ul>
          {messages.map((m) => {
            const active = selectedUid === m.uid;
            const toStr = Array.isArray(m.to) ? m.to.filter(Boolean).join(", ") : (m.to || "");
            return (
              <li key={m.uid}>
                <button
                  data-testid={`${MAIL.messageRowPrefix}${m.uid}`}
                  onClick={() => onSelect(m)}
                  className={`w-full text-left px-4 py-3 border-b border-border flex items-start gap-3 transition-colors ${
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
                    className="w-3.5 h-3.5 mt-1 rounded border-border flex-shrink-0"
                  />
                  <Star
                    data-testid={`${MAIL.messageStar}${m.uid}`}
                    onClick={(e) => e.stopPropagation()}
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 cursor-pointer transition-colors ${
                      m.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm truncate ${m.unread ? "font-bold" : "font-medium"}`} title={m.from_addr}>
                        {m.from_name || m.from_addr}
                      </span>
                      {m.from_name && m.from_addr && (
                        <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
                          &lt;{m.from_addr}&gt;
                        </span>
                      )}
                    </div>
                    <div className={`text-sm truncate ${m.unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                      {m.subject}
                    </div>
                    {activeCols.includes("preview") && m.preview && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {m.preview}
                      </div>
                    )}
                    {activeCols.includes("recipient") && toStr && (
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        Para: {toStr}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className={`text-[11px] font-medium whitespace-nowrap ${m.unread ? "text-primary" : "text-muted-foreground"}`}>
                      {formatDate(m.date)}
                    </div>
                    <div className="flex items-center gap-1">
                      {m.has_attachment && <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />}
                      {(m.spam_flag || (typeof m.spam_score === "number" && m.spam_score >= 3)) && (
                        <span
                          title={m.spam_status || `Score ${m.spam_score}`}
                          className="px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[10px] font-bold"
                          data-testid={`spam-score-${m.uid}`}
                        >
                          {typeof m.spam_score === "number" ? `SPAM ${m.spam_score.toFixed(1)}` : "SPAM"}
                        </span>
                      )}
                      {activeCols.includes("size") && m.size != null && (
                        <span className="text-[10px] text-muted-foreground">{formatSize(m.size)}</span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Pagination footer */}
      {total > 0 && (
        <div
          data-testid="mail-pagination"
          className="flex-shrink-0 border-t border-border px-3 py-2 flex items-center justify-between gap-3 bg-card/95 text-xs"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <label htmlFor="mail-page-size" className="hidden sm:inline">Mostrar</label>
            <select
              id="mail-page-size"
              data-testid="mail-page-size"
              value={pageSize}
              onChange={(e) => onPageSizeChange?.(parseInt(e.target.value, 10))}
              className="bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} / página</option>
              ))}
            </select>
            <span className="hidden md:inline">
              {(() => {
                if (total === 0) return "";
                const from = (page - 1) * pageSize + 1;
                const to = Math.min(page * pageSize, total);
                return `${from}-${to} de ${total}`;
              })()}
            </span>
          </div>

          <PaginationControls
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
          />
        </div>
      )}
    </div>
  );
}

function PaginationControls({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return (
    <div className="text-muted-foreground text-[11px]">Página 1 de 1</div>
  );
  const go = (p) => {
    const next = Math.max(1, Math.min(totalPages, p));
    if (next !== page) onPageChange?.(next);
  };
  // Constrói uma janela compacta de páginas (1 … n-1 n n+1 … total)
  const pages = [];
  const push = (p) => { if (!pages.includes(p) && p >= 1 && p <= totalPages) pages.push(p); };
  push(1);
  for (let p = page - 1; p <= page + 1; p++) push(p);
  push(totalPages);
  pages.sort((a, b) => a - b);

  return (
    <div className="flex items-center gap-1">
      <button
        data-testid="pagination-first"
        onClick={() => go(1)}
        disabled={page === 1}
        className="p-1.5 rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
        title="Primeira página"
      >
        <ChevronsLeft className="w-3.5 h-3.5" />
      </button>
      <button
        data-testid="pagination-prev"
        onClick={() => go(page - 1)}
        disabled={page === 1}
        className="p-1.5 rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
        title="Anterior"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <div className="flex items-center gap-0.5">
        {pages.map((p, i) => {
          const prev = pages[i - 1];
          const gap = prev != null && p - prev > 1;
          return (
            <span key={p} className="flex items-center">
              {gap && <span className="px-1 text-muted-foreground/60">…</span>}
              <button
                data-testid={`pagination-page-${p}`}
                onClick={() => go(p)}
                className={`min-w-[26px] h-7 px-2 rounded-md text-[11px] font-semibold transition-colors ${
                  p === page
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground/80"
                }`}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </button>
            </span>
          );
        })}
      </div>
      <button
        data-testid="pagination-next"
        onClick={() => go(page + 1)}
        disabled={page === totalPages}
        className="p-1.5 rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
        title="Próxima"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
      <button
        data-testid="pagination-last"
        onClick={() => go(totalPages)}
        disabled={page === totalPages}
        className="p-1.5 rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
        title="Última página"
      >
        <ChevronsRight className="w-3.5 h-3.5" />
      </button>
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

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
