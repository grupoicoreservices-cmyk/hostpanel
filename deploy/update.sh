#!/usr/bin/env bash
# Voxyra Mail — atualização/deploy incremental (rodar quando fizer git pull)
set -euo pipefail

APP_DIR="/opt/hostpanel"
APP_USER="hostpanel"

cd "$APP_DIR"

echo "▶ Pull de mudanças"
sudo -u "$APP_USER" git pull --ff-only

echo "▶ Dependências do backend"
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -r backend/requirements.txt

echo "▶ Build do frontend"
# Tenta build determinístico com --frozen-lockfile.
# Se o lockfile estiver defasado em relação ao package.json (nova dependência
# adicionada sem yarn.lock atualizado), faz fallback para yarn install regular
# e continua o build — evita quebrar o deploy por lock desatualizado.
sudo -u "$APP_USER" bash -c "
  cd '$APP_DIR/frontend'
  if ! yarn install --frozen-lockfile; then
    echo '⚠ yarn.lock desatualizado — refazendo com yarn install (atualiza lockfile)'
    yarn install
  fi
  yarn build
"

echo "▶ Restart do backend"
systemctl restart hostpanel-backend

echo "▶ Reload do Nginx"
nginx -t && (systemctl reload nginx 2>/dev/null || systemctl restart nginx)

echo "✔ Deploy concluído — verifique com: journalctl -u hostpanel-backend -f"
