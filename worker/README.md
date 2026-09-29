# ListaPedidos + Cloudflare D1

A arquitetura fica dividida em duas partes:

- **GitHub Pages:** PWA/interface.
- **Cloudflare Worker:** API segura.
- **Cloudflare D1:** banco SQLite na nuvem.
- **localStorage:** cache e funcionamento offline.
- **JSON:** backup manual.

## Configuração do D1

Na pasta `worker/`:

1. `npm install`
2. `npx wrangler login`
3. `npm run db:create`
4. Copie o `database_id` retornado para `wrangler.toml`.
5. Crie/aplique a estrutura SQL:
   `npx wrangler d1 execute listapedidos-db --remote --file=./schema.sql`
6. Publique:
   `npm run deploy`

O Worker terá uma URL semelhante a `https://listapedidos-api.<conta>.workers.dev`.

## Segurança

O navegador nunca recebe credenciais do D1. A API usa sessão em cookie HttpOnly/Secure e o D1 fica somente no Worker.

A autenticação inicial usa cadastro/login por e-mail e senha. A senha é armazenada como hash PBKDF2; o navegador recebe apenas uma sessão HttpOnly/Secure.

## Frontend

Depois que o Worker estiver publicado, a interface poderá usar `NEXT_PUBLIC_API_URL` para sincronizar pedidos e quantidades com D1. Enquanto essa variável não existir, o aplicativo continua usando o armazenamento local atual.
