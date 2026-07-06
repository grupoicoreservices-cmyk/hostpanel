# Voxyra Mail - Credenciais de Teste

## Superadmin (padrão do sistema)
- **URL Login:** `/login`
- **E-mail:** `admin@voxyra.com`
- **Senha:** `Voxyra@2026`
- **Perfil:** `superadmin`

## Endpoints de autenticação
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET  /api/auth/me`
- `POST /api/auth/refresh`

## Rotas principais
- Admin SaaS: `/admin/dashboard`, `/admin/empresas`, `/admin/servidores`, `/admin/dominios`, `/admin/contas`, `/admin/logs`
- Webmail: `/mail`

## Observações
- IMAP/SMTP e DirectAdmin requerem que o superadmin cadastre um servidor DirectAdmin, um domínio associado, uma conta de e-mail e um usuário `usuario_final` vinculado à conta antes que o webmail funcione com dados reais.
- Enquanto o servidor DirectAdmin não estiver cadastrado, todas as telas SaaS e o layout do webmail permanecem funcionais em modo visual (o webmail retornará erro amigável ao tentar listar mensagens).
