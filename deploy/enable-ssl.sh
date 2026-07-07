#!/usr/bin/env bash
#
# Voxyra Mail — ativa HTTPS (Let's Encrypt) em UMA linha
# Uso (como root):
#   sudo bash /opt/hostpanel/deploy/enable-ssl.sh
#
# Requer que o install.sh já tenha rodado e o site esteja respondendo em HTTP.

set -euo pipefail

DOMAIN="${DOMAIN:-mailweb-br01.voxyra.net.br}"
EMAIL="${SSL_EMAIL:-admin@voxyra.com}"
APP_DIR="${APP_DIR:-/opt/hostpanel}"
VHOST_SRC="$APP_DIR/deploy/nginx/mailweb-br01.voxyra.net.br.conf"
VHOST_DST="/etc/nginx/sites-available/${DOMAIN}.conf"

log() { printf "\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✔ %s\033[0m\n" "$*"; }
err() { printf "\033[1;31m✘ %s\033[0m\n" "$*" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "Execute como root (sudo)."
  exit 1
fi

log "1/4 · Verificando DNS e HTTP"
CT_IP="$(curl -4 -s ifconfig.me || echo '')"
DNS_IP="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || echo '')"
if [[ -z "$DNS_IP" ]]; then
  err "DNS de $DOMAIN não resolve. Ajuste o registro A antes de continuar."
  exit 1
fi
if [[ -n "$CT_IP" && "$DNS_IP" != "$CT_IP" ]]; then
  err "DNS ($DNS_IP) não bate com o IP público do servidor ($CT_IP)."
  err "Ajuste o registro A do domínio antes de continuar."
  exit 1
fi
if ! curl -sf -o /dev/null "http://$DOMAIN/"; then
  err "HTTP em http://$DOMAIN/ não está respondendo. Rode primeiro o install.sh."
  exit 1
fi
ok "DNS ok · HTTP respondendo"

log "2/4 · Emitindo certificado via certbot"
mkdir -p /var/www/certbot
certbot --nginx \
        -d "$DOMAIN" \
        --agree-tos \
        -m "$EMAIL" \
        --redirect \
        --non-interactive

log "3/4 · Aplicando vhost definitivo (HSTS, rate-limit, cache)"
if [[ ! -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  err "Certificado não encontrado em /etc/letsencrypt/live/$DOMAIN — abortando."
  exit 1
fi
install -m 644 "$VHOST_SRC" "$VHOST_DST"
ln -sf "$VHOST_DST" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t
systemctl reload nginx 2>/dev/null || systemctl restart nginx

log "4/4 · Testando HTTPS"
if curl -sf -o /dev/null "https://$DOMAIN/"; then
  ok "HTTPS ativo em https://$DOMAIN/"
  ok "Login em https://$DOMAIN/login"
else
  err "https://$DOMAIN/ ainda não responde — verifique 'nginx -t' e o firewall (porta 443)."
  exit 1
fi
