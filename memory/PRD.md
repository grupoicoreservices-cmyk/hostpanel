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
- ✅ **Fix EXAMINE Invalid arguments + Splash Carregando (07/07/2026)**: bug crítico de produção onde Dovecot rejeitava EXAMINE `BAD Invalid arguments` toda vez que o webmail carregava. Corrigido com nova função `_safe_folder(name)` em `services/mail.py` que aplica strip + quoting duplo em TODOS os `m.select()` (9 chamadas atualizadas), fallback INBOX para vazios, preserva quotes existentes. Frontend: pastas virtuais `Starred`/`Snoozed` deixaram de disparar chamada backend (fetcher retorna `[]`). Adicionado splash `data-testid="webmail-loading-splash"` na entrada do webmail com "Carregando conteúdo…" + 3 pontinhos animados. `MessageList` agora mostra skeleton com 6 linhas `animate-pulse` durante loading (`keepPreviousData: true` do SWR REMOVIDO — troca de pasta não trava mais com dados antigos). Banner de erro agora tem botão dismiss (`mail-error-dismiss`). Testing_agent iteração 11: **100% pass** backend + frontend.
- ✅ **Paginação + Contador de não lidas no Webmail (07/07/2026)**:
   - Backend: `services/mail.py::list_messages` agora aceita `page` (1-based) + `page_size` e retorna envelope `{items, total, page, page_size, unread}`. Fatia a lista IMAP para pegar mensagens mais novas primeiro. Compat retroativa: se `page_size` for None retorna a lista simples (usado por `spam.py` e `routers/webmail.py` legado).
   - Novo método `MailClient.unread_counts(folders)` que usa IMAP `STATUS folder (MESSAGES UNSEEN)` — leve, sem SELECT — para ler `{folder: {total, unread}}`.
   - Novo endpoint `GET /api/webmail/folder-counts?folders=INBOX,Sent,...` retornando o dict de contagens em uma única conexão IMAP.
   - Frontend `Webmail.jsx`: novo estado `page` + `pageSize` (persistido em localStorage `voxyra:mail-page-size`, default 20). SWR duplo: uma key para mensagens paginadas (`[mail-messages, folder, search, page, pageSize]`) e outra para contadores (`[mail-folder-counts]`, revalida a cada 90s). Ao trocar pasta ou busca, `page` volta para 1.
   - Frontend `Sidebar.jsx`: aceita `folderCounts` prop, renderiza badge azul com o número de não lidas ao lado de cada pasta (testid `folder-unread-<folder>`). Zero-count esconde o badge para não poluir.
   - Frontend `MessageList.jsx`: novo rodapé fixo (`mail-pagination`) com dropdown `mail-page-size` (10/20/30/50/100), texto "X-Y de Z", e controles `pagination-first/prev/next/last` + botões `pagination-page-N` com janela compacta (`1 … p-1 p p+1 … total`). Total badge no header (`mail-total-count`).
   - Regressão: `routers/spam.py` (2 chamadas) atualizado para desembrulhar `result["items"]` do novo retorno.
   - Testes: 5 pytest unit tests em `/app/backend/tests/test_mail_pagination.py` cobrindo envelope, segunda página, out-of-range, unread_counts e flag por mensagem — 100% pass. Testing_agent iteração 12: **100% pass** (backend 6/6, frontend surface visível ok).

## Backlog priorizado (P1)
- Upload / download de anexos reais (multipart) no compose e reading pane.
- Filtros e regras antispam (persistidas por usuário).
- Assinatura por usuário (armazenamento e injeção no compose).
- Vacation/autoresponder wired na UI usando `CMD_API_EMAIL_VACATION`.
- SSE/IDLE para notificações em tempo real de novas mensagens.
- Threading de conversas.
- Export CSV das listas admin.

## Backlog (P2)
- 2FA (TOTP) para admins.
- WebSocket para notificações de nova mensagem.
- App PWA offline básica.
- Métricas Prometheus / logs estruturados JSON.

## Notas
- Enquanto não houver servidor DirectAdmin cadastrado, o webmail exibe dados de demonstração para preservar a experiência visual.
- Todos os tokens DA e senhas IMAP salvos vão criptografados via Fernet (`ENCRYPTION_KEY`).
