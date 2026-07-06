# Voxyra Mail — SaaS Webmail Platform

Plataforma completa de webmail multiempresa/multidomínio integrada a servidores DirectAdmin, com painel Admin SaaS e webmail parecido com Gmail/Outlook (identidade Voxyra).

- **Stack**: FastAPI · React 19 · MongoDB · JWT auth · IMAP/SMTP · DirectAdmin API
- **Perfis**: `superadmin` · `empresa_admin` · `usuario_final`
- **Recursos**: multi-empresa, multi-domínio, quota, suspensão, tema claro/escuro, modo horizontal/vertical.

---

## 🚀 Início rápido (dev)

### 1. Backend

```bash
cd backend
cp .env.example .env         # ajuste JWT_SECRET, ADMIN_PASSWORD, ENCRYPTION_KEY
pip install -r requirements.txt
# em desenvolvimento o supervisor já sobe o serviço automaticamente
sudo supervisorctl restart backend
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env         # ajuste REACT_APP_BACKEND_URL
yarn install
sudo supervisorctl restart frontend
```

O superadmin inicial é semeado automaticamente na primeira execução.

- **URL**: `/login`
- **E-mail**: `admin@voxyra.com`
- **Senha**: valor de `ADMIN_PASSWORD` (default `Voxyra@2026`)

---

## 🧭 Fluxo de configuração

1. Faça login como superadmin.
2. **Servidores DA** → cadastre a URL, porta (padrão 2222), usuário e token da API DirectAdmin. Use o botão ⚡ para validar a conexão.
3. **Empresas** → crie a empresa cliente.
4. **Domínios** → vincule o domínio à empresa e ao servidor DirectAdmin.
5. **Contas de e-mail** → provisione a conta (chama a API DirectAdmin automaticamente).
6. **Usuários** → crie um `usuario_final` vinculado à conta de e-mail — este acessa o webmail em `/mail`.

---

## 📦 Estrutura

```
backend/
  server.py             # entrypoint FastAPI
  auth.py               # JWT, bcrypt, seed superadmin, brute force
  models.py             # Pydantic models (empresas, domínios, contas…)
  crypto_utils.py       # Fernet — cripto de tokens DA / senhas IMAP
  database.py           # conexão MongoDB (motor)
  routers/
    saas.py             # empresas, domínios, contas, servidores, users, logs, prefs
    webmail.py          # IMAP/SMTP endpoints
  services/
    directadmin.py      # cliente DirectAdmin API
    mail.py             # cliente IMAP + SMTP

frontend/src/
  App.js                # rotas
  context/              # Auth + Preferências (tema/view)
  pages/
    Login.jsx
    Webmail.jsx         # UI principal (parecida com o mock)
    admin/              # Dashboard, Empresas, Servers, Domains, Accounts, Users, Logs
  components/mail/      # Sidebar, StatsBar, MessageList, ReadingPane, ComposeModal, SaaSPanel
  components/admin/     # AdminLayout
  lib/                  # api.js (axios), testIds.js
```

---

## 🔌 Endpoints principais

### Auth
- `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/refresh`

### SaaS Admin
- `GET /api/dashboard/stats`
- `GET|POST|PATCH|DELETE /api/empresas`
- `GET|POST|PATCH|DELETE /api/servers` + `POST /api/servers/{id}/test`
- `GET|POST|DELETE /api/dominios`
- `GET|POST|PATCH|DELETE /api/contas`
- `GET|POST /api/users`
- `GET /api/admin-logs` · `GET /api/login-logs`
- `GET|PUT /api/preferences`

### Webmail (IMAP/SMTP)
- `GET /api/webmail/folders`
- `GET /api/webmail/messages?folder=INBOX&search=…`
- `GET /api/webmail/messages/{uid}?folder=INBOX`
- `POST /api/webmail/send`
- `POST /api/webmail/messages/{uid}/move?src_folder=INBOX&dst_folder=Archive`
- `DELETE /api/webmail/messages/{uid}?folder=INBOX`
- `POST /api/webmail/messages/{uid}/flag?folder=INBOX&flag=\Seen&add=true`

---

## 🔒 Segurança

- Senhas **bcrypt** (nunca em texto puro).
- Tokens DirectAdmin e senhas IMAP **criptografados** com Fernet (`ENCRYPTION_KEY`).
- Cookies JWT httpOnly + samesite=lax; refresh de 7 dias.
- Rate limit: bloqueio de 15 min após 5 tentativas de login falhas.
- Log de todas as tentativas em `login_logs` e das ações administrativas em `admin_logs`.
- RBAC em todas as rotas (`superadmin`, `empresa_admin`, `usuario_final`).

---

## 🎨 UI / UX

- Fontes **Manrope** (corpo) + **Outfit** (títulos).
- Paleta azul (`#2563EB`), tema claro/escuro persistidos por usuário (localStorage + backend).
- Toggle horizontal/vertical: `LayoutPanelLeft` × `LayoutPanelTop` no topbar do webmail.
- Modal de composição estilo Gmail (bottom-right, minimize/close).

---

## 🧪 Testes

Superadmin já semeado. Rotas para validar:

```bash
API=https://seu-backend
curl -c cookies.txt -X POST $API/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@voxyra.com","password":"Voxyra@2026"}'
curl -b cookies.txt $API/api/auth/me
curl -b cookies.txt $API/api/dashboard/stats
```

---

## 📤 Publicar no GitHub

1. Inicialize o repositório:

```bash
cd /app
git init
git add .
git commit -m "chore: initial commit — Voxyra Mail SaaS"
```

2. Crie um repositório em `github.com/<seu-usuario>/voxyra-mail` (privado ou público).
3. Envie:

```bash
git remote add origin git@github.com:<seu-usuario>/voxyra-mail.git
git branch -M main
git push -u origin main
```

Ou use o botão **Save to GitHub** da plataforma Emergent — ele executa o push do workspace atual (`/app`) mantendo o `.gitignore` deste repositório.

> Nunca comite os arquivos `.env` reais — apenas os `*.env.example`. O `.gitignore` já garante isso.

---

## 🛠️ Comandos úteis

```bash
sudo supervisorctl restart backend       # após mudar .env / dependências
sudo supervisorctl restart frontend
tail -f /var/log/supervisor/backend.err.log
cd frontend && yarn build                # build de produção
```

---

## 📄 Licença
Uso interno / cliente. Ajuste conforme sua necessidade antes de publicar em produção.
