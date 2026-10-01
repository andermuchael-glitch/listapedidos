export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
}

type Item = {
  id: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  separado: number;
};

type PedidoPayload = {
  id: string;
  numero?: string;
  cliente?: string;
  arquivoNome?: string;
  status?: string;
  items: Item[];
};

function corsOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin") || "";
  return env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN
    ? origin
    : env.ALLOWED_ORIGIN || origin || "*";
}

function response(
  request: Request,
  env: Env,
  data: unknown,
  status = 200,
  extra: HeadersInit = {}
) {
  const headers = new Headers({
    "content-type": "application/json; charset=UTF-8",
    "access-control-allow-origin": corsOrigin(request, env),
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "cache-control": "no-store"
  });

  Object.entries(extra).forEach(([k, v]) => headers.set(k, String(v)));
  return new Response(JSON.stringify(data), { status, headers });
}

function cookie(request: Request, name: string) {
  const value = (request.headers.get("Cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + "="));

  return value ? decodeURIComponent(value.slice(name.length + 1)) : "";
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
}

async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 100_000,
      hash: "SHA-256"
    },
    key,
    256
  );

  return `${salt}:${Array.from(
    new Uint8Array(bits),
    (b) => b.toString(16).padStart(2, "0")
  ).join("")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;

  const actual = await passwordHash(password, salt);
  return actual === `${salt}:${expected}`;
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(
    bytes,
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
}

async function userId(request: Request, env: Env) {
  const raw = cookie(request, "lp_session");
  if (!raw) return null;

  const tokenHash = await hash(raw);
  const row = await env.DB.prepare(
    "SELECT usuario_id FROM sessoes WHERE token_hash = ? AND expira_em > datetime('now')"
  )
    .bind(tokenHash)
    .first<{ usuario_id: string }>();

  return row?.usuario_id || null;
}

async function createSession(env: Env, uid: string) {
  const rawToken = token();

  await env.DB.prepare(
    "INSERT INTO sessoes (token_hash,usuario_id,expira_em) VALUES (?,?,datetime('now','+30 days'))"
  )
    .bind(await hash(rawToken), uid)
    .run();

  return rawToken;
}

function sessionCookie(rawToken: string, maxAge = 2_592_000) {
  return `lp_session=${encodeURIComponent(rawToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

async function getUser(env: Env, uid: string) {
  return env.DB.prepare(
    "SELECT id,nome,email FROM usuarios WHERE id=?"
  )
    .bind(uid)
    .first<{ id: string; nome: string; email: string }>();
}

async function syncOrder(request: Request, env: Env, uid: string) {
  const body = (await request.json()) as PedidoPayload;

  if (!body?.id || !Array.isArray(body.items)) {
    return response(request, env, { error: "Pedido inválido." }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT usuario_id FROM pedidos WHERE id=?"
  )
    .bind(body.id)
    .first<{ usuario_id: string }>();

  if (existing && existing.usuario_id !== uid) {
    return response(request, env, { error: "Pedido não pertence ao usuário autenticado." }, 403);
  }

  const items = body.items.map((item, index) => ({
    id: String(item.id),
    codigo: String(item.codigo || ""),
    descricao: String(item.descricao || ""),
    quantidade: Math.max(
      0,
      Math.floor(Number(item.quantidade) || 0)
    ),
    separado: Math.max(
      0,
      Math.min(
        Math.floor(Number(item.quantidade) || 0),
        Math.floor(Number(item.separado) || 0)
      )
    ),
    ordem: index
  }));

  const total = items.reduce((sum, item) => sum + item.quantidade, 0);
  const separated = items.reduce((sum, item) => sum + item.separado, 0);
  const status =
    body.status === "concluida" || (items.length > 0 && separated === total)
      ? "concluida"
      : "em_andamento";

  await env.DB.prepare(
    `INSERT INTO pedidos
      (id, usuario_id, numero_pedido, cliente, arquivo_nome, status, total_itens, total_unidades, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       numero_pedido=excluded.numero_pedido,
       cliente=excluded.cliente,
       arquivo_nome=excluded.arquivo_nome,
       status=excluded.status,
       total_itens=excluded.total_itens,
       total_unidades=excluded.total_unidades,
       atualizado_em=datetime('now')`
  )
    .bind(
      body.id,
      uid,
      body.numero || "",
      body.cliente || "",
      body.arquivoNome || "",
      status,
      items.length,
      total
    )
    .run();

  await env.DB.prepare(
    "DELETE FROM itens_pedido WHERE pedido_id = ?"
  )
    .bind(body.id)
    .run();

  if (items.length) {
    await env.DB.batch(
      items.map((item) =>
        env.DB.prepare(
          "INSERT INTO itens_pedido (id,pedido_id,codigo,descricao,quantidade,separado,ordem) VALUES (?,?,?,?,?,?,?)"
        ).bind(
          item.id,
          body.id,
          item.codigo,
          item.descricao,
          item.quantidade,
          item.separado,
          item.ordem
        )
      )
    );
  }

  return response(request, env, {
    ok: true,
    id: body.id,
    status,
    totalItens: items.length,
    totalUnidades: total
  });
}

async function updateItem(
  request: Request,
  env: Env,
  uid: string,
  orderId: string,
  itemId: string
) {
  const body = (await request.json()) as { separado?: number };

  const order = await env.DB.prepare(
    "SELECT id FROM pedidos WHERE id=? AND usuario_id=?"
  )
    .bind(orderId, uid)
    .first();

  if (!order) {
    return response(request, env, { error: "Pedido não encontrado." }, 404);
  }

  const item = await env.DB.prepare(
    "SELECT quantidade FROM itens_pedido WHERE id=? AND pedido_id=?"
  )
    .bind(itemId, orderId)
    .first<{ quantidade: number }>();

  if (!item) {
    return response(request, env, { error: "Item não encontrado." }, 404);
  }

  const separado = Math.max(
    0,
    Math.min(
      Number(item.quantidade) || 0,
      Math.floor(Number(body.separado) || 0)
    )
  );

  await env.DB.prepare(
    "UPDATE itens_pedido SET separado=? WHERE id=? AND pedido_id=?"
  )
    .bind(separado, itemId, orderId)
    .run();

  const totals = await env.DB.prepare(
    "SELECT COALESCE(SUM(quantidade),0) AS total, COALESCE(SUM(separado),0) AS separado FROM itens_pedido WHERE pedido_id=?"
  )
    .bind(orderId)
    .first<{ total: number; separado: number }>();

  const status =
    Number(totals?.total || 0) > 0 &&
    Number(totals?.separado || 0) >= Number(totals?.total || 0)
      ? "concluida"
      : "em_andamento";

  await env.DB.prepare(
    "UPDATE pedidos SET status=?, atualizado_em=datetime('now') WHERE id=? AND usuario_id=?"
  )
    .bind(status, orderId, uid)
    .run();

  return response(request, env, {
    ok: true,
    itemId,
    separado,
    status
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") {
        return response(request, env, {}, 204);
      }

      const url = new URL(request.url);

      if (url.pathname === "/health") {
        const dbTest = await env.DB.prepare("SELECT 1 AS ok").first();
        return response(request, env, {
          ok: true,
          service: "listapedidos-api",
          database: "d1",
          dbTest
        });
      }

      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        const body = (await request.json()) as {
          email?: string;
          nome?: string;
          senha?: string;
        };

        const email = String(body.email || "").trim().toLowerCase();
        const senha = String(body.senha || "");

        if (!email || senha.length < 8) {
          return response(
            request,
            env,
            { error: "E-mail e senha com pelo menos 8 caracteres são obrigatórios." },
            400
          );
        }

        const exists = await env.DB.prepare(
          "SELECT id FROM usuarios WHERE email=?"
        )
          .bind(email)
          .first();

        if (exists) {
          return response(
            request,
            env,
            { error: "Este e-mail já está cadastrado." },
            409
          );
        }

        const id = crypto.randomUUID();
        const salt = token();
        const senhaHash = await passwordHash(senha, salt);

        await env.DB.prepare(
          "INSERT INTO usuarios (id,nome,email,senha_hash) VALUES (?,?,?,?)"
        )
          .bind(id, String(body.nome || ""), email, senhaHash)
          .run();

        const rawToken = await createSession(env, id);

        return response(
          request,
          env,
          {
            ok: true,
            user: {
              id,
              nome: String(body.nome || ""),
              email
            }
          },
          201,
          { "set-cookie": sessionCookie(rawToken) }
        );
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = (await request.json()) as {
          email?: string;
          senha?: string;
        };

        const email = String(body.email || "").trim().toLowerCase();
        const senha = String(body.senha || "");

        const user = await env.DB.prepare(
          "SELECT id,nome,email,senha_hash FROM usuarios WHERE email=?"
        )
          .bind(email)
          .first<{
            id: string;
            nome: string;
            email: string;
            senha_hash: string;
          }>();

        if (!user || !(await verifyPassword(senha, user.senha_hash))) {
          return response(
            request,
            env,
            { error: "E-mail ou senha inválidos." },
            401
          );
        }

        const rawToken = await createSession(env, user.id);

        return response(
          request,
          env,
          {
            ok: true,
            user: {
              id: user.id,
              nome: user.nome,
              email: user.email
            }
          },
          200,
          { "set-cookie": sessionCookie(rawToken) }
        );
      }

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const uid = await userId(request, env);

        if (!uid) {
          return response(request, env, { authenticated: false }, 401);
        }

        const user = await getUser(env, uid);
        if (!user) {
          return response(request, env, { authenticated: false }, 401);
        }

        return response(request, env, { authenticated: true, user });
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const raw = cookie(request, "lp_session");

        if (raw) {
          await env.DB.prepare(
            "DELETE FROM sessoes WHERE token_hash=?"
          )
            .bind(await hash(raw))
            .run();
        }

        return response(
          request,
          env,
          { ok: true },
          200,
          { "set-cookie": sessionCookie("", 0) }
        );
      }

      const uid = await userId(request, env);
      if (!uid) {
        return response(request, env, { error: "Não autenticado." }, 401);
      }

      if (url.pathname === "/api/pedidos" && request.method === "GET") {
        const result = await env.DB.prepare(
          `SELECT id,numero_pedido AS numero,cliente,arquivo_nome AS arquivoNome,status,
                  total_itens AS totalItens,total_unidades AS totalUnidades,
                (SELECT COALESCE(SUM(separado),0) FROM itens_pedido ip WHERE ip.pedido_id=pedidos.id) AS totalSeparado,
                criado_em AS criadoEm,atualizado_em AS atualizadoEm
           FROM pedidos WHERE usuario_id=? ORDER BY atualizado_em DESC LIMIT 100`
        )
          .bind(uid)
          .all();

        return response(request, env, result.results);
      }

      if (url.pathname === "/api/pedidos" && request.method === "POST") {
        return syncOrder(request, env, uid);
      }

      const orderDeleteMatch = url.pathname.match(
        /^\\/api\\/pedidos\\/([^/]+)$/
      );

      if (orderDeleteMatch && request.method === "DELETE") {
        const orderId = decodeURIComponent(orderDeleteMatch[1]);
        const deleted = await env.DB.prepare(
          "DELETE FROM pedidos WHERE id=? AND usuario_id=?"
        )
          .bind(orderId, uid)
          .run();

        if (!deleted.meta.changes) {
          return response(request, env, { error: "Pedido não encontrado." }, 404);
        }

        return response(request, env, { ok: true, id: orderId });
      }

      const itemMatch = url.pathname.match(
        /^\/api\/pedidos\/([^/]+)\/itens\/([^/]+)$/
      );

      if (itemMatch && request.method === "PATCH") {
        return updateItem(
          request,
          env,
          uid,
          decodeURIComponent(itemMatch[1]),
          decodeURIComponent(itemMatch[2])
        );
      }

      if (url.pathname.startsWith("/api/pedidos/") && request.method === "GET") {
        const id = decodeURIComponent(
          url.pathname.slice("/api/pedidos/".length)
        );

        const order = await env.DB.prepare(
          `SELECT id,numero_pedido AS numero,cliente,arquivo_nome AS arquivoNome,status,
                  total_itens AS totalItens,total_unidades AS totalUnidades,
                  criado_em AS criadoEm,atualizado_em AS atualizadoEm
           FROM pedidos WHERE id=? AND usuario_id=?`
        )
          .bind(id, uid)
          .first();

        if (!order) {
          return response(
            request,
            env,
            { error: "Pedido não encontrado." },
            404
          );
        }

        const items = await env.DB.prepare(
          "SELECT id,codigo,descricao,quantidade,separado,ordem FROM itens_pedido WHERE pedido_id=? ORDER BY ordem"
        )
          .bind(id)
          .all();

        return response(request, env, {
          ...order,
          items: items.results
        });
      }

      return response(request, env, { error: "Rota não encontrada." }, 404);
    } catch (error) {
      console.error("Erro no Worker:", error);

      return response(
        request,
        env,
        {
          error: "Erro interno do servidor.",
          detail: error instanceof Error ? error.message : String(error)
        },
        500
      );
    }
  }
};
