import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import { PrefsProvider } from "@/context/PrefsContext";

import Login from "@/pages/Login";
import ClientLogin from "@/pages/ClientLogin";
import Landing from "@/pages/Landing";
import Webmail from "@/pages/Webmail";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminEmpresas from "@/pages/admin/Empresas";
import AdminServers from "@/pages/admin/Servers";
import AdminDomains from "@/pages/admin/Domains";
import AdminAccounts from "@/pages/admin/Accounts";
import AdminLogs from "@/pages/admin/Logs";
import AdminUsers from "@/pages/admin/Users";
import AdminMonitoring from "@/pages/admin/Monitoring";
import AdminAntispam from "@/pages/admin/Antispam";

function Protected({ children, roles }) {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Carregando…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/mail" replace />;
  return children;
}

function DefaultRedirect() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Landing />;
  if (user.role === "superadmin" || user.role === "empresa_admin")
    return <Navigate to="/admin/dashboard" replace />;
  return <Navigate to="/mail" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <PrefsProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors />
          <Routes>
            <Route path="/" element={<DefaultRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/webmail" element={<ClientLogin />} />
            <Route path="/webmail/login" element={<ClientLogin />} />

            <Route path="/mail" element={<Protected><Webmail /></Protected>} />

            <Route
              path="/admin"
              element={
                <Protected roles={["superadmin", "empresa_admin"]}>
                  <AdminLayout />
                </Protected>
              }
            >
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="empresas" element={<AdminEmpresas />} />
              <Route path="servidores" element={<AdminServers />} />
              <Route path="dominios" element={<AdminDomains />} />
              <Route path="contas" element={<AdminAccounts />} />
              <Route path="usuarios" element={<AdminUsers />} />
              <Route path="monitoramento" element={<AdminMonitoring />} />
              <Route path="antispam" element={<AdminAntispam />} />
              <Route path="logs" element={<AdminLogs />} />
            </Route>

            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </BrowserRouter>
      </PrefsProvider>
    </AuthProvider>
  );
}
