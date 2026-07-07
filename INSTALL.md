# Instalação — Voxyra Mail (Hostpanel) em Ubuntu 24 LTS

Este guia instala o Voxyra Mail (repositório `grupoicoreservices-cmyk/hostpanel`) em um container/VM **Ubuntu 24.04 LTS** servindo em **https://mailweb-br01.voxyra.net.br**.

Componentes que serão configurados:

- MongoDB 7 (local)
- Python 3.12 + venv com FastAPI/uvicorn
- Node.js 20 + Yarn para build do React
- Nginx com HTTPS via Let's Encrypt
- systemd unit (`hostpanel-backend.service`)
- UFW liberando somente 22, 80 e 443

---

## 0. Pré-requisitos

1. CT/VM Ubuntu 24 acessível via SSH como root (ou sudo).
2. Registro **A/AAAA** de `mailweb-br01.voxyra.net.br` apontando para o IP público do CT (aguarde a propagação DNS antes do certbot).
3. Portas **80** e **443** liberadas no firewall externo do provedor.
4. Repositório GitHub `grupoicoreservices-cmyk/hostpanel` público **ou** com token/deploy key configurado.

---

## 1. Publicar o código no GitHub

No seu ambiente Emergent (`/app`):

```bash
cd /app
git init
git add .
git commit -m "chore: Voxyra Mail — initial commit"
git branch -M main
git remote add origin https://github.com/grupoicoreservices-cmyk/hostpanel.git
git push -u origin main
```

> Se preferir, use o botão **Save to GitHub** da plataforma Emergent — o repositório de destino é `grupoicoreservices-cmyk/hostpanel`.

O `.gitignore` já garante que `backend/.env` e `frontend/.env` **não** vão para o GitHub — apenas os `.env.example`.

---

## 2. Instalar no servidor Ubuntu 24 (modo automático)

> **⚠️ Ubuntu 24 minimal (LXC/CT) não vem com `curl` instalado por padrão.** Instale-o primeiro:

```bash
ssh root@mailweb-br01.voxyra.net.br

# 1) pré-requisitos mínimos para baixar o script
apt update
apt install -y curl ca-certificates

# 2) baixa e roda o instalador
curl -fsSL https://raw.githubusercontent.com/grupoicoreservices-cmyk/hostpanel/main/deploy/install.sh -o /tmp/install.sh
bash /tmp/install.sh
```

**Alternativa 100% via git** (se você preferir clonar o repositório antes de rodar):

```bash
apt update && apt install -y git
git clone https://github.com/grupoicoreservices-cmyk/hostpanel.git /tmp/hostpanel
bash /tmp/hostpanel/deploy/install.sh
```

> Se o repositório for **privado**, use um Personal Access Token: `git clone https://TOKEN@github.com/grupoicoreservices-cmyk/hostpanel.git /tmp/hostpanel`

O script executa 9 etapas:

1. `apt update / upgrade`
2. Instala Python, build tools, Nginx, Certbot, UFW
3. Instala Node.js 20 e Yarn
4. Instala e habilita MongoDB 7
5. Cria usuário `hostpanel` e diretório `/opt/hostpanel`
6. Clona `grupoicoreservices-cmyk/hostpanel`
7. Cria venv, instala `backend/requirements.txt`, gera `.env` com `JWT_SECRET`, `ENCRYPTION_KEY` e **senha aleatória do superadmin** (será impressa no terminal — anote!)
8. Faz build do frontend com `REACT_APP_BACKEND_URL=https://mailweb-br01.voxyra.net.br`
9. Configura systemd + Nginx + UFW

No fim, o script pede para você emitir o SSL. Você tem 2 opções:

**Opção rápida (uma linha)** — use o script `enable-ssl.sh` que já vem no repo:

```bash
sudo bash /opt/hostpanel/deploy/enable-ssl.sh
```

Ele valida DNS/HTTP, emite o certificado via certbot, aplica o vhost definitivo (HSTS + rate-limit + cache) e testa o HTTPS ao final.

**Opção manual** (3 passos, se preferir fazer com controle):

```bash
# 1) emite o cert (certbot edita o vhost HTTP e adiciona o server block SSL)
sudo certbot --nginx -d mailweb-br01.voxyra.net.br \
     --agree-tos -m admin@voxyra.com --redirect --non-interactive

# 2) substitui o vhost temporário pelo definitivo (com HSTS/security headers)
sudo install -m 644 /opt/hostpanel/deploy/nginx/mailweb-br01.voxyra.net.br.conf \
     /etc/nginx/sites-available/mailweb-br01.voxyra.net.br.conf

# 3) reload
sudo nginx -t && sudo systemctl reload nginx
```

> ⚠️ **Ordem é obrigatória**: nunca copie o vhost definitivo antes do certbot rodar — ele referencia arquivos de certificado que ainda não existem e o `nginx -t` falha.

Pronto — abra **https://mailweb-br01.voxyra.net.br/login**.

---

## 3. Instalação manual (passo a passo, se preferir)

```bash
# --- 3.1. pacotes base
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl python3 python3-venv python3-pip build-essential \
                    nginx certbot python3-certbot-nginx ufw

# --- 3.2. Node 20 + Yarn
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
sudo corepack enable && sudo corepack prepare yarn@stable --activate

# --- 3.3. MongoDB 7
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod

# --- 3.4. usuário + clone
sudo useradd -r -m -d /opt/hostpanel -s /usr/sbin/nologin hostpanel
sudo -u hostpanel git clone https://github.com/grupoicoreservices-cmyk/hostpanel.git /opt/hostpanel

# --- 3.5. backend
sudo -u hostpanel python3 -m venv /opt/hostpanel/venv
sudo -u hostpanel /opt/hostpanel/venv/bin/pip install -r /opt/hostpanel/backend/requirements.txt

sudo -u hostpanel tee /opt/hostpanel/backend/.env >/dev/null <<'ENV'
MONGO_URL="mongodb://127.0.0.1:27017"
DB_NAME="voxyra_mail"
CORS_ORIGINS="https://mailweb-br01.voxyra.net.br"
JWT_SECRET="TROQUE-POR-64-CHAR-HEX"
ADMIN_EMAIL="admin@voxyra.com"
ADMIN_PASSWORD="TrocarNaPrimeiraLogin@2026"
ENCRYPTION_KEY="TROQUE-POR-32-CARACTERES"
ENV
sudo chmod 600 /opt/hostpanel/backend/.env

# --- 3.6. frontend
sudo -u hostpanel tee /opt/hostpanel/frontend/.env >/dev/null <<'ENV'
REACT_APP_BACKEND_URL=https://mailweb-br01.voxyra.net.br
WDS_SOCKET_PORT=443
ENABLE_HEALTH_CHECK=false
GENERATE_SOURCEMAP=false
ENV
sudo -u hostpanel bash -c "cd /opt/hostpanel/frontend && yarn install --frozen-lockfile && yarn build"

# --- 3.7. systemd
sudo install -m 644 /opt/hostpanel/deploy/systemd/hostpanel-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hostpanel-backend

# --- 3.8. Nginx (com SSL via certbot)
sudo install -m 644 /opt/hostpanel/deploy/nginx/mailweb-br01.voxyra.net.br.conf \
                    /etc/nginx/sites-available/mailweb-br01.voxyra.net.br.conf
sudo ln -sf /etc/nginx/sites-available/mailweb-br01.voxyra.net.br.conf \
            /etc/nginx/sites-enabled/mailweb-br01.voxyra.net.br.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo certbot --nginx -d mailweb-br01.voxyra.net.br \
     --agree-tos -m admin@voxyra.com --redirect
sudo nginx -t && sudo systemctl reload nginx

# --- 3.9. firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

---

## 4. Atualizações futuras (git pull)

```bash
sudo bash /opt/hostpanel/deploy/update.sh
```

Ele faz `git pull`, atualiza deps, rebuilda o frontend e reinicia o serviço.

---

## 5. Comandos operacionais

```bash
# status
sudo systemctl status hostpanel-backend
sudo systemctl status nginx mongod

# logs
sudo journalctl -u hostpanel-backend -f
sudo tail -f /var/log/nginx/voxyra_error.log

# restart / reload
sudo systemctl restart hostpanel-backend
sudo systemctl reload nginx

# backup do banco (rodar em cron diário)
mongodump --db voxyra_mail --out /var/backups/voxyra/$(date +%F)

# renovação automática do SSL (certbot já cria timer)
sudo systemctl status certbot.timer
```

---

## 6. Primeiro login

- URL: **https://mailweb-br01.voxyra.net.br/login**
- Usuário: `admin@voxyra.com`
- Senha: gerada pelo `install.sh` (impressa no terminal) ou valor de `ADMIN_PASSWORD` no `.env`
- Após o primeiro login: crie um `empresa_admin` e troque a senha do superadmin nas configurações.

---

## 7. Troubleshooting

| Sintoma | Ação |
|---|---|
| `502 Bad Gateway` | `sudo systemctl status hostpanel-backend` — veja os logs |
| Login falha com "network error" | `CORS_ORIGINS` no `.env` do backend precisa bater exatamente com `https://mailweb-br01.voxyra.net.br` |
| Certbot falha | Confirme DNS A record e que a porta 80 está aberta no firewall externo |
| Frontend em branco | Refaça `yarn build`; verifique `/opt/hostpanel/frontend/build/index.html` |
| MongoDB não conecta | `sudo systemctl status mongod`; `MONGO_URL` deve ser `mongodb://127.0.0.1:27017` |
| Reset da senha do superadmin | Altere `ADMIN_PASSWORD` no `.env` e reinicie o backend — a senha é re-hashada no startup |
