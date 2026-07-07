import { useEffect, useRef } from "react";

/**
 * Hook para consumir o stream SSE do webmail (IMAP IDLE via backend).
 *
 * Reconecta automaticamente em caso de erro (comportamento nativo do EventSource
 * + reconexão manual explícita quando o backend emite "error").
 *
 * @param {object}   opts
 * @param {string}   opts.baseUrl        Prefixo do backend (REACT_APP_BACKEND_URL/api)
 * @param {boolean}  opts.enabled        Se o stream deve estar ativo
 * @param {string}   opts.folder         Pasta a monitorar (default INBOX)
 * @param {(evt: {type:string,folder:string,count?:number,detail?:string}) => void} opts.onEvent
 */
export default function useWebmailStream({ baseUrl, enabled = true, folder = "INBOX", onEvent }) {
  const esRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const retryCountRef = useRef(0);
  const cbRef = useRef(onEvent);

  // Sempre usa o callback mais recente sem reabrir o stream
  useEffect(() => { cbRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!enabled || !baseUrl) return undefined;

    let closed = false;

    const connect = () => {
      if (closed) return;
      try { esRef.current?.close(); } catch { /* noop */ }

      const url = `${baseUrl}/webmail/events?folder=${encodeURIComponent(folder)}`;
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      const handle = (type) => (ev) => {
        try {
          const data = ev.data ? JSON.parse(ev.data) : {};
          cbRef.current?.({ type, ...data });
        } catch {
          cbRef.current?.({ type });
        }
      };

      // Reseta o contador na primeira conexão bem-sucedida
      es.addEventListener("ready", (ev) => { retryCountRef.current = 0; handle("ready")(ev); });
      es.addEventListener("new_mail",  handle("new_mail"));
      es.addEventListener("expunge",   handle("expunge"));
      es.addEventListener("recent",    handle("recent"));
      es.addEventListener("error", (ev) => {
        if (ev.data) handle("error")(ev);
        if (es.readyState === EventSource.CLOSED && !closed) {
          // Backoff exponencial: 5s, 10s, 30s, 60s, 120s (máx.)
          // Isso protege o servidor IMAP contra tempestade de reconexões
          // quando ele já está bloqueando (ex.: mail_max_userip_connections).
          retryCountRef.current = Math.min(retryCountRef.current + 1, 5);
          const delays = [5000, 10000, 30000, 60000, 120000];
          const delay = delays[retryCountRef.current - 1] || 120000;
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      });
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      try { esRef.current?.close(); } catch { /* noop */ }
      esRef.current = null;
    };
  }, [baseUrl, enabled, folder]);
}
