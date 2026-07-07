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
- ✅ **Branding customizado por domínio no webmail login (07/07/2026)**: campos `logo_url` e `hero_image_url` no cadastro de domínio (`/app/frontend/src/pages/admin/Domains.jsx`); endpoint público `GET /api/public/domains/{domain_name}/branding` (`/app/backend/routers/public.py`); `ClientLogin.jsx` faz fetch no blur do e-mail e troca logo + imagem hero + nome da empresa dinamicamente. Testado ponta-a-ponta com screenshot.
- ✅ **Sanitização XSS + resiliência do deploy (07/07/2026)**: `ReadingPane.jsx` agora sanitiza HTML de e-mail com DOMPurify (config restritiva: bloqueia `script`, `iframe`, `on*`, força `target=_blank rel=noopener` em links). `deploy/update.sh` com fallback automático quando `yarn.lock` está defasado.
- ✅ **Quarentena de Spam — módulo completo (07/07/2026)**:
   - Backend `routers/spam.py`: 13 endpoints (usuário final: folder, messages, get_message, not-spam, report, delete, whitelist, blacklist, stats; admin: overview, account_messages, account_not_spam, account_delete). Integra IMAP (lista/move/exclui) + DirectAdmin CMD_API_EMAIL_SPAMASSASSIN_BLACKLIST/WHITELIST. Overview usa `asyncio.to_thread` para não bloquear event loop.
   - `services/mail.py` reforçado: `_parse_spam_headers` (extrai X-Spam-Flag/Score/Status), `resolve_spam_folder` (autodetect Junk/Spam/INBOX.Spam), `bulk_move`, `bulk_delete`, `folder_count`. `list_messages` e `get_message` agora incluem `spam_flag`, `spam_score`, `spam_status`.
   - Frontend webmail: `ReadingPane.jsx` com barra de ações dinâmica (na pasta Spam mostra "Não é spam" e "Não é spam + Whitelist"; nas outras pastas mostra "Marcar spam" e "Spam + Bloquear remetente"), banner de score do SpamAssassin acima do corpo. `MessageList.jsx` com badge de score inline. `Webmail.jsx` roteia listagem para `/api/spam/messages` quando na pasta Junk/Spam.
   - Frontend admin: nova página `/admin/quarentena` (`SpamQuarantine.jsx`) com overview agregado (4 cards de KPI), busca de contas, drill-down com tabela de mensagens + checkbox multi-seleção + ações em lote (Não é spam, +Whitelist, Excluir). Nav sidebar `Quarentena Spam` com ícone `ShieldX`.
   - Testes: 24 pytest passando em `/app/backend/tests/test_spam_quarantine.py` (autenticação, 401/404/400 corretos, estrutura do overview, regressões).

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
