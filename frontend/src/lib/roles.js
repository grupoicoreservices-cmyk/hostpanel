/**
 * Mapa central de perfis (roles) do sistema.
 * Todas as UIs devem usar essas funções para exibir labels/cores consistentes.
 */

export const ROLE_LABELS = {
  superadmin: "Super Admin",
  empresa_admin: "Gerente",
  usuario_final: "Usuário",
};

export const ROLE_DESCRIPTIONS = {
  superadmin: "Acesso total à plataforma. Gerencia servidores, empresas, domínios e todos os usuários.",
  empresa_admin: "Administra domínios, contas de e-mail e usuários da própria empresa.",
  usuario_final: "Acessa o webmail da própria caixa postal.",
};

export const ROLE_TONE = {
  superadmin:   { badge: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
                  dot: "bg-purple-500" },
  empresa_admin:{ badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
                  dot: "bg-blue-500" },
  usuario_final:{ badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
                  dot: "bg-emerald-500" },
};

export const ROLE_ORDER = ["superadmin", "empresa_admin", "usuario_final"];

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "—";
}

export function roleBadgeClass(role) {
  return ROLE_TONE[role]?.badge || "bg-gray-100 text-gray-700";
}

export function roleDot(role) {
  return ROLE_TONE[role]?.dot || "bg-gray-400";
}

/** Retorna opções de perfil que o actor pode atribuir. */
export function allowedRolesFor(actorRole) {
  if (actorRole === "superadmin") return ROLE_ORDER;
  return ["empresa_admin", "usuario_final"];
}
