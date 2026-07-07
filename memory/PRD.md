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
- ✅ **Rotas reorganizadas (07/07/2026)**: `/` → login do cliente (webmail), `/console` → landing de escolha (webmail × console admin), `/webmail/login` → redirect legado.
- ✅ **Deploy bug fix (07/07/2026)**: removidos `emergentintegrations` e `litellm @ customer-assets.emergent` do `requirements.txt` (vazamento do `pip freeze`).
- ✅ **White-label por Host header (07/07/2026)**: endpoint `GET /api/public/host-branding` que detecta o Host da requisição, faz match inteligente (strip `mail.`/`webmail.` e sobe labels), retorna branding automaticamente. `ClientLogin.jsx` chama no mount, carrega logo+hero antes do usuário digitar.
- ✅ **Backup Fase 2 — Scheduler + Run + Restore (07/07/2026)**:
   - `services/backup_service.py`: coleta IMAP INBOX → upload `.eml` no SFTP (`/base/{empresa}/{dominio}/{email}/{YYYY-MM}/{uid}.eml`), checkpoint UIDVALIDITY+last_uid por conta, indexação em `backup_index`, retenção nightly via purge.
   - `services/backup_scheduler.py`: APScheduler async — job por servidor (interval `poll_interval_min`), job global `_flush_scheduled_sends` (30s), purge cron nightly 3h30.
   - Endpoints novos: `POST /api/backup/servers/{id}/run`, `GET /api/backup/archive`, `POST /api/backup/servers/{id}/restore`.
   - CRUD dispara `reload_jobs()` automaticamente. `next_run_at` incluído na resposta.
- ✅ **Fixes UX Reading + Agendamento + Encaminhar (07/07/2026)**:
   - **Bug scrollbar**: nova classe `.voxyra-scroll-visible` no `index.css` com scrollbar 12px sempre visível; ReadingPane usa `overflow-y-scroll voxyra-scroll-visible`.
   - **Bug 3-pontos**: dropdown funcional com 4 itens (Encaminhar, Marcar não lida, Imprimir com janela pop-up sanitizada, Mostrar cabeçalhos técnicos).
   - **Encaminhar**: botão dedicado na action bar + rodapé (`reading-forward-btn`, `reading-quick-forward-btn`), handler `doForward` no Webmail.jsx que abre ComposeModal com título "Encaminhar mensagem", subject "Fwd:", body com cabeçalho "---------- Mensagem encaminhada ----------".
   - **Agendar envio**: split button "Enviar | ▼" no ComposeModal, painel `compose-schedule-panel` com datetime-local + 3 presets rápidos (+1h, amanhã 9h, seg 9h). Backend `POST /api/webmail/schedule` grava em `scheduled_messages`; APScheduler roda `_flush_scheduled_sends` a cada 30s (envia pendentes vencidos via SMTP e marca sent/failed).
   - **Marcar não lida**: `POST /api/webmail/messages/{uid}/mark-unread` remove flag `\\Seen` do IMAP.
   - Testing agent iteração 10: **100% pass** (backend 9/9, frontend 100%, retest_needed: False).
- ✅ **Cleanup (07/07/2026)**: método duplicado `mark_flag` removido de `services/mail.py` (mantido apenas `flag()`).

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
