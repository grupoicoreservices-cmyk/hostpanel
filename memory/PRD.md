# Voxyra Mail — PRD

## Problema
Construir um Webmail Host SaaS multiempresa/multidomínio integrado a servidores DirectAdmin, com visual moderno (Gmail/Outlook) e identidade "Voxyra Mail".

## Personas
- **Superadmin (Voxyra)**: gerencia servidores DA, empresas, planos, logs globais.
- **Admin da empresa**: gerencia domínios, contas e usuários dentro da sua empresa.
- **Usuário final**: usa o webmail (IMAP/SMTP) via `/mail`.

## Requisitos essenciais
- Autenticação JWT com cookies httpOnly, RBAC 3 níveis.
- Painel Admin SaaS (dashboard, empresas, servidores DA, domínios, contas, usuários, logs).
- Integração DirectAdmin (listar domínios, CRUD de contas, senha, quota, suspensão).
- Webmail com IMAP (listar pastas, mensagens, abrir), SMTP (enviar/responder), busca, mover, apagar.
- Layout parecido com o mock: sidebar azul, stats bar, lista + reading pane + painel SaaS lateral, compose modal.
- Tema claro/escuro + toggle horizontal/vertical, persistido em user_preferences.
- Fontes Manrope + Outfit; paleta azul; cripto Fernet para tokens/senhas.

## Implementado (07/2026)
- ✅ Backend: `auth`, `crypto_utils`, `models`, `database`, `services/directadmin.py`, `services/mail.py`, `routers/saas.py`, `routers/webmail.py`, `server.py`, seed superadmin, brute force, indexes.
- ✅ Frontend: Login, Webmail (com modo demo quando IMAP não configurado), Admin (Dashboard, Empresas, Servers, Domains, Accounts, Users, Logs), AdminLayout, contexts (Auth, Prefs), tema/view toggles, compose modal.
- ✅ .env.example para backend e frontend, README de deploy, .gitignore para GitHub.
- ✅ **Branding customizado por domínio no webmail login (07/07/2026)**
- ✅ **Sanitização XSS + resiliência do deploy (07/07/2026)**
- ✅ **Quarentena de Spam — módulo completo (07/07/2026)**
- ✅ **Emblema "Made with Emergent" + PostHog removidos do build de produção (07/07/2026)**
- ✅ **Melhorias UX Webmail (07/07/2026)**: título "Voxyra Webmail" na aba, remoção das tabs falsas (Principal/Social/Promoções/Sistema), painéis redimensionáveis via react-resizable-panels, cache SWR com revalidação em foco, botão "Abrir em nova aba" + rota `/mail/message/:uid`, colunas configuráveis no MessageList (Prévia/Destinatário/Tamanho) via localStorage.
- ✅ **Usuários & Perfis Nível 1 (07/07/2026)**: labels em PT (Super Admin, Gerente, Usuário), badges coloridos, stat cards clicáveis como filtros, filtros por perfil/empresa/busca, modais para editar/reset-senha/excluir/toggle-ativo. Backend: endpoints PATCH `/api/users/{id}`, POST `/api/users/{id}/reset-password`, DELETE `/api/users/{id}` com salvaguardas (não pode desativar/excluir a si mesmo, gerente não altera superadmin).
- ✅ **Bug fix: senha da conta de e-mail (07/07/2026)**: substituído `window.prompt` por modais proper com validação (senha ≥ 6 chars + confirmação). Backend agora retorna 502 se DirectAdmin recusar a nova senha, evitando dessincronia entre cache local e IMAP real.
- ✅ **Retenção & Backup SFTP — Fase 1 (07/07/2026)**: nova página `/admin/backup` com CRUD de servidores SFTP/FTP/FTPS. Endpoints `/api/backup/servers` (GET/POST/PATCH/DELETE) e `/api/backup/servers/{id}/test` (validação de conexão real via paramiko/ftplib). Modelo `BackupServer` com auth password ou chave privada PEM, `base_path`, `retention_days`, `poll_interval_min`, `empresa_id` opcional. Menu "Retenção & Backup" com ícone HardDrive no sidebar admin. Scheduler de coleta + UI de restore ficam para Fase 2.
- ✅ **Limpeza de dados fake (07/07/2026)**: removidos `DEMO_MESSAGES` do Webmail.jsx (Bellanapoli, grupoicore, Sistema Antispam), badges hardcoded do sidebar (238/6), bloco de storage fake (68% / 34.2 GB / 50 GB), "Business Pro" hardcoded no SaasPanel, `spam_blocked_7d: 4821` placeholder no backend (substituído por contagem real de audit logs). Fallback `demoMode` também removido — agora quando IMAP falha, mostra banner amarelo com erro real e empty state honesto.

## Backlog priorizado (P1)
- Upload / download de anexos reais (multipart) no compose e reading pane.
- Filtros e regras antispam (persistidas por usuário).
- Assinatura por usuário (armazenamento e injeção no compose).
- Vacation/autoresponder wired na UI usando `CMD_API_EMAIL_VACATION`.
- Paginação IMAP + threading de conversas.
- Export CSV das listas admin.

## Backlog (P2)
- 2FA (TOTP) para admins.
- WebSocket para notificações de nova mensagem.
- App PWA offline básica.
- Métricas Prometheus / logs estruturados JSON.

## Notas
- Enquanto não houver servidor DirectAdmin cadastrado, o webmail exibe dados de demonstração para preservar a experiência visual.
- Todos os tokens DA e senhas IMAP salvos vão criptografados via Fernet (`ENCRYPTION_KEY`).
