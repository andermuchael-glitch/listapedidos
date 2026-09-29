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

A sessão do MVP é criada a partir do e-mail informado. Não há senha nessa primeira etapa; a autenticação completa pode ser adicionada depois sem trocar o banco.

## Frontend

Depois que o Worker estiver publicado, a interface poderá usar `NEXT_PUBLIC_API_URL` para sincronizar pedidos e quantidades com D1. Enquanto essa variável não existir, o aplicativo continua usando o armazenamento local atual.
