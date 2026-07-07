#!/usr/bin/env bash
#
# Voxyra Mail (Hostpanel) — instalador Ubuntu 24.04 LTS
#
# ⚠️ Ubuntu 24 minimal (LXC/CT) NÃO vem com `curl` instalado.
# Antes de rodar este script, execute:
#     apt update && apt install -y curl ca-certificates
#
# Uso (como root):
#   curl -fsSL https://raw.githubusercontent.com/grupoicoreservices-cmyk/hostpanel/main/deploy/install.sh -o /tmp/install.sh
#   bash /tmp/install.sh
#
# Alternativa via git:
#   apt update && apt install -y git
#   git clone https://github.com/grupoicoreservices-cmyk/hostpanel.git /tmp/hostpanel
#   bash /tmp/hostpanel/deploy/install.sh
#
# Alvo: CT/VM Ubuntu 24 · Domínio: mailweb-br01.voxyra.net.br
# ------------------------------------------------------------------------

set -euo pipefail

APP_DIR="/opt/hostpanel"
APP_USER="hostpanel"
DOMAIN="mailweb-br01.voxyra.net.br"
REPO_URL="https://github.com/grupoicoreservices-cmyk/hostpanel.git"
BRANCH="${BRANCH:-main}"

log() { printf "\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✔ %s\033[0m\n" "$*"; }
warn(){ printf "\033[1;33m⚠ %s\033[0m\n" "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Execute como root (sudo)." >&2
  exit 1
fi

log "0/9 · Verificando ferramentas de bootstrap"
if ! command -v curl >/dev/null 2>&1; then
  log "curl não encontrado — instalando…"
  apt-get update -y
  apt-get install -y curl ca-certificates
fi

log "1/9 · Atualizando pacotes"
apt-get update -y
apt-get upgrade -y

log "2/9 · Instalando dependências do sistema"
apt-get install -y \
  git curl gnupg2 ca-certificates lsb-release ufw \
  python3 python3-venv python3-pip python3-dev build-essential \
  nginx certbot python3-certbot-nginx \
  gnupg

log "3/9 · Instalando Node.js 20 LTS"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1)" != "v20" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare yarn@stable --activate

log "4/9 · Instalando MongoDB 7"
if ! command -v mongod >/dev/null 2>&1; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
    gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update -y
  apt-get install -y mongodb-org
fi
systemctl enable --now mongod

log "5/9 · Criando usuário de aplicação e diretórios"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -r -m -d "$APP_DIR" -s /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" /var/log/hostpanel /var/www/certbot
chown -R "$APP_USER:$APP_USER" "$APP_DIR" /var/log/hostpanel

log "6/9 · Clonando repositório grupoicoreservices-cmyk/hostpanel"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  # limpar dir antes do clone (não deve ter arquivos além do skeleton)
  find "$APP_DIR" -mindepth 1 -maxdepth 1 -not -name '.env' -exec rm -rf {} +
  sudo -u "$APP_USER" git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

log "7/9 · Configurando backend (venv + .env)"
sudo -u "$APP_USER" python3 -m venv "$APP_DIR/venv"
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install --upgrade pip
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/backend/requirements.txt"

if [[ ! -f "$APP_DIR/backend/.env" ]]; then
  JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  ENC_KEY=$(python3 -c "import secrets; print(secrets.token_hex(16))")
  ADMIN_PWD=$(python3 -c "import secrets, string; alphabet=string.ascii_letters+string.digits+'@#!'; print(''.join(secrets.choice(alphabet) for _ in range(16)))")
  cat > "$APP_DIR/backend/.env" <<ENV
MONGO_URL="mongodb://127.0.0.1:27017"
DB_NAME="voxyra_mail"
CORS_ORIGINS="https://$DOMAIN"
JWT_SECRET="$JWT_SECRET"
ADMIN_EMAIL="admin@voxyra.com"
ADMIN_PASSWORD="$ADMIN_PWD"
ENCRYPTION_KEY="$ENC_KEY"
ENV
  chown "$APP_USER:$APP_USER" "$APP_DIR/backend/.env"
  chmod 600 "$APP_DIR/backend/.env"
  echo
  ok "backend/.env gerado. Guarde a senha do superadmin:"
  echo "  admin@voxyra.com  /  $ADMIN_PWD"
  echo
fi

log "8/9 · Build do frontend"
cat > "$APP_DIR/frontend/.env" <<ENV
REACT_APP_BACKEND_URL=https://$DOMAIN
WDS_SOCKET_PORT=443
ENABLE_HEALTH_CHECK=false
GENERATE_SOURCEMAP=false
ENV
chown "$APP_USER:$APP_USER" "$APP_DIR/frontend/.env"

sudo -u "$APP_USER" bash -c "cd '$APP_DIR/frontend' && yarn install --frozen-lockfile && yarn build"

log "9/9 · Configurando systemd + Nginx"
install -m 644 "$APP_DIR/deploy/systemd/hostpanel-backend.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hostpanel-backend

mkdir -p /var/www/certbot
[[ -e /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default

# IMPORTANTE: nunca instale o vhost com SSL antes do certificado existir,
# senão o `nginx -t` falha e o certbot não consegue rodar.
if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  # Certificado já existe — usa o vhost definitivo (HTTPS + HSTS + rate limit)
  install -m 644 "$APP_DIR/deploy/nginx/mailweb-br01.voxyra.net.br.conf" \
                 /etc/nginx/sites-available/$DOMAIN.conf
  ln -sf /etc/nginx/sites-available/$DOMAIN.conf /etc/nginx/sites-enabled/$DOMAIN.conf
  nginx -t
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
  ok "Nginx configurado com HTTPS em https://$DOMAIN"
else
  # Sem certificado — instala vhost HTTP-only para o certbot completar o desafio
  warn "Certificado SSL ainda não existe. Servindo em HTTP temporariamente…"
  cat > /etc/nginx/sites-available/$DOMAIN.conf <<TMP
server {
    listen 80;
    server_name $DOMAIN;
    root $APP_DIR/frontend/build;
    index index.html;
    client_max_body_size 25M;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / { try_files \$uri /index.html; }
}
TMP
  ln -sf /etc/nginx/sites-available/$DOMAIN.conf /etc/nginx/sites-enabled/$DOMAIN.conf
  nginx -t
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
  systemctl enable nginx
  ok "Nginx respondendo em http://$DOMAIN"
  echo
  warn "AGORA execute estes 3 comandos EM ORDEM para ativar o HTTPS:"
  echo "  1) sudo certbot --nginx -d $DOMAIN --agree-tos -m admin@voxyra.com --redirect --non-interactive"
  echo "  2) sudo install -m 644 $APP_DIR/deploy/nginx/mailweb-br01.voxyra.net.br.conf /etc/nginx/sites-available/$DOMAIN.conf"
  echo "  3) sudo nginx -t && sudo systemctl reload nginx"
  echo
fi

# ---- Firewall ----
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH || true
  ufw allow 'Nginx Full' || true
  echo "y" | ufw enable || true
fi

ok "Instalação concluída."
echo
echo "  URL: https://$DOMAIN/login"
echo "  Backend log: journalctl -u hostpanel-backend -f"
echo "  Nginx log:   tail -f /var/log/nginx/voxyra_error.log"
