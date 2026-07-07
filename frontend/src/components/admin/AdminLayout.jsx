import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Mail, LayoutDashboard, Building2, Server, Globe, Users2, UserCircle2, ScrollText, Activity, ShieldAlert, ShieldX, LogOut, ArrowRight, Sun, Moon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usePrefs } from "@/context/PrefsContext";
import { ADMIN, AUTH, MAIL } from "@/lib/testIds";

const NAV = [
  { to: "/admin/dashboard",   label: "Dashboard",     icon: LayoutDashboard, id: "dashboard",     color: "text-blue-500" },
  { to: "/admin/empresas",    label: "Empresas",      icon: Building2,       id: "empresas",      color: "text-indigo-500",  superOnly: true },
  { to: "/admin/servidores",  label: "Servidores DA", icon: Server,          id: "servidores",    color: "text-emerald-500", superOnly: true },
  { to: "/admin/dominios",    label: "Domínios",      icon: Globe,           id: "dominios",      color: "text-sky-500" },
  { to: "/admin/contas",      label: "Contas de e-mail", icon: Users2,       id: "contas",        color: "text-amber-500" },
  { to: "/admin/usuarios",    label: "Usuários",      icon: UserCircle2,     id: "usuarios",      color: "text-rose-500" },
  { to: "/admin/monitoramento", label: "Monitoramento", icon: Activity,      id: "monitoramento", color: "text-lime-500" },
  { to: "/admin/antispam",    label: "Antispam Center", icon: ShieldAlert,   id: "antispam",      color: "text-red-500" },
  { to: "/admin/quarentena",  label: "Quarentena Spam", icon: ShieldX,       id: "quarentena",    color: "text-pink-500" },
  { to: "/admin/logs",        label: "Logs",          icon: ScrollText,      id: "logs",          color: "text-orange-500" },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const { prefs, update } = usePrefs();
  const navigate = useNavigate();

  return (
    <div className="h-screen w-full flex overflow-hidden bg-background">
      <aside className="w-64 flex-shrink-0 flex flex-col bg-secondary border-r border-border">
        <div className="p-5 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <div className="font-display font-bold text-lg leading-tight">Voxyra</div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Painel Admin</div>
          </div>
        </div>

        <nav className="mt-2 flex-1 overflow-y-auto voxyra-scroll px-2 space-y-0.5">
          {NAV.filter(n => !n.superOnly || user?.role === "superadmin").map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                data-testid={`${ADMIN.navPrefix}${n.id}`}
                className={({ isActive }) => `group w-full flex items-center gap-3 px-4 py-2.5 rounded-r-full text-sm transition-colors ${
                  isActive ? "bg-primary/12 text-primary font-semibold" : "text-foreground/80 hover:bg-blue-100/60 dark:hover:bg-slate-800"
                }`}
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`w-4 h-4 transition-colors ${isActive ? "text-primary" : `${n.color} group-hover:scale-110`}`} />
                    <span>{n.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <button
            data-testid={ADMIN.switchToWebmail}
            onClick={() => navigate("/mail")}
            className="w-full inline-flex items-center justify-between px-3 py-2 rounded-lg bg-card border border-border text-sm hover:bg-muted transition-colors"
          >
            <span className="flex items-center gap-2"><Mail className="w-4 h-4 text-primary"/> Ir para webmail</span>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-3 border-t border-border flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
            {(user?.name || "?").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate">{user?.name}</div>
            <div className="text-[11px] text-muted-foreground truncate uppercase tracking-wider">{user?.role}</div>
          </div>
          <button
            data-testid={MAIL.themeToggle}
            onClick={() => update({ theme: prefs.theme === "dark" ? "light" : "dark" })}
            className="p-1.5 rounded-md hover:bg-blue-200/50 dark:hover:bg-slate-800 text-muted-foreground transition-colors"
          >
            {prefs.theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
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

      <main className="flex-1 overflow-y-auto voxyra-scroll">
        <Outlet />
      </main>
    </div>
  );
}
