import { Inbox, Star, Clock, Send, FileEdit, ShieldAlert, Trash2, Archive, Building2, Plus, LogOut, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MAIL, AUTH } from "@/lib/testIds";
import { useAuth } from "@/context/AuthContext";

const FOLDERS = [
  { id: "INBOX",    label: "Entrada",         icon: Inbox,       color: "text-blue-500" },
  { id: "Starred",  label: "Favoritos",       icon: Star,        color: "text-amber-500" },
  { id: "Snoozed",  label: "Adiados",         icon: Clock,       color: "text-purple-500" },
  { id: "Sent",     label: "Enviados",        icon: Send,        color: "text-sky-500" },
  { id: "Drafts",   label: "Rascunhos",       icon: FileEdit,    color: "text-orange-500" },
  { id: "Junk",     label: "Antispam Center", icon: ShieldAlert, color: "text-red-500" },
  { id: "Trash",    label: "Lixeira",         icon: Trash2,      color: "text-slate-500" },
  { id: "Archive",  label: "Arquivo",         icon: Archive,     color: "text-emerald-500" },
];

export default function Sidebar({ activeFolder, onFolderChange, onCompose, empresas = [], folderCounts = {} }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "superadmin" || user?.role === "empresa_admin";

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-secondary border-r border-border">
      {/* Brand */}
      <div className="p-5 flex items-center gap-3">
        <img
          src="/logo.png"
          alt="Voxyra"
          className="h-10 w-10 object-contain flex-shrink-0"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
        <div>
          <div className="font-display font-bold text-lg leading-tight">Voxyra Mail</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">SaaS Webmail</div>
        </div>
      </div>

      {/* Compose */}
      <div className="px-4">
        <button
          data-testid={MAIL.composeBtn}
          onClick={onCompose}
          className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-full py-3 font-semibold text-sm shadow-sm hover:bg-blue-700 active:scale-[.98] transition-all"
        >
          <Plus className="w-4 h-4"/> Nova mensagem
        </button>
      </div>

      {/* Folders */}
      <nav className="mt-4 flex-1 overflow-y-auto voxyra-scroll">
        <ul className="px-2 space-y-0.5">
          {FOLDERS.map((f) => {
            const Icon = f.icon;
            const active = activeFolder === f.id;
            const unread = folderCounts?.[f.id]?.unread || 0;
            const showBadge = unread > 0;
            return (
              <li key={f.id}>
                <button
                  data-testid={`${MAIL.folderPrefix}${f.id.toLowerCase()}`}
                  onClick={() => onFolderChange(f.id)}
                  className={`group w-full flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-r-full text-sm transition-colors ${
                    active
                      ? "bg-primary/12 text-primary font-semibold"
                      : "text-foreground/80 hover:bg-blue-100/60 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon className={`w-4 h-4 transition-transform ${active ? "text-primary" : `${f.color} group-hover:scale-110`}`} />
                  <span className={`flex-1 text-left ${showBadge && !active ? "font-semibold" : ""}`}>{f.label}</span>
                  {showBadge && (
                    <span
                      data-testid={`folder-unread-${f.id.toLowerCase()}`}
                      className={`min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                        active ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary"
                      }`}
                    >
                      {unread > 999 ? "999+" : unread}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Empresas — apenas para admin */}
        {isAdmin && (
          <div className="mt-6 px-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Empresas</div>
            <div className="space-y-1">
              {(empresas.length ? empresas : [{ id: "self", nome: user?.name || "Minha empresa" }]).map((e) => (
                <div key={e.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border text-xs">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="truncate">{e.nome}</span>
                </div>
              ))}
              <button
                onClick={() => navigate("/admin/empresas")}
                data-testid="sidebar-add-empresa"
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-blue-100/40 dark:hover:bg-slate-800 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar empresa
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-border flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
          {(user?.name || "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate">{user?.name}</div>
          <div className="text-[11px] text-muted-foreground truncate">{user?.email}</div>
        </div>
        <button
          data-testid={AUTH.logoutBtn}
          onClick={async () => { await logout(); navigate("/login"); }}
          className="p-1.5 rounded-md hover:bg-blue-200/50 dark:hover:bg-slate-800 text-muted-foreground transition-colors"
          title="Sair"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
