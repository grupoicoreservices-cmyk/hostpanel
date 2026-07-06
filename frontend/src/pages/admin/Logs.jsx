import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ScrollText } from "lucide-react";

export default function AdminLogs() {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    api.get("/admin-logs").then(({data}) => setLogs(data)).catch(()=>{});
  }, []);
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="text-[11px] uppercase font-bold tracking-widest text-muted-foreground">Painel Admin</div>
        <h1 className="font-display text-4xl font-bold tracking-tight">Logs administrativos</h1>
        <p className="text-sm text-muted-foreground mt-1">Histórico de ações executadas por administradores.</p>
      </div>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Data</th>
              <th className="text-left px-4 py-3">Ator</th>
              <th className="text-left px-4 py-3">Ação</th>
              <th className="text-left px-4 py-3">Alvo</th>
              <th className="text-left px-4 py-3">Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={l.id || i} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{new Date(l.timestamp).toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3">{l.actor_email}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">{l.action}</span></td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{l.target || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{l.details ? JSON.stringify(l.details) : "—"}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-40"/>
                Nenhum log registrado ainda.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
