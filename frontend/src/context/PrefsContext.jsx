import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const PrefsCtx = createContext(null);

const DEFAULTS = {
  theme: "light",
  view_mode: "horizontal",
  density: "comfortable",
  signature: "",
};

export function PrefsProvider({ children }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(() => {
    try {
      const raw = localStorage.getItem("voxyra_prefs");
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
    } catch {
      return DEFAULTS;
    }
  });

  // Load server prefs when authenticated
  useEffect(() => {
    if (!user || user === false) return;
    api.get("/preferences").then(({ data }) => {
      setPrefs((p) => ({ ...p, ...data }));
    }).catch(() => {});
  }, [user]);

  // Apply theme to html
  useEffect(() => {
    const html = document.documentElement;
    if (prefs.theme === "dark") html.classList.add("dark");
    else html.classList.remove("dark");
    localStorage.setItem("voxyra_prefs", JSON.stringify(prefs));
  }, [prefs]);

  const update = useCallback(async (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (user && user !== false) {
      try { await api.put("/preferences", next); } catch {}
    }
  }, [prefs, user]);

  return (
    <PrefsCtx.Provider value={{ prefs, update }}>
      {children}
    </PrefsCtx.Provider>
  );
}

export function usePrefs() {
  return useContext(PrefsCtx);
}
