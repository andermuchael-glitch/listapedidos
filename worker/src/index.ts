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
  return env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN || origin || "*";
}

function response(request: Request, env: Env, data: unknown, status = 200, extra: HeadersInit = {}) {
  const headers = new Headers({
    "content-type": "application/json; charset=UTF-8",
    "access-control-allow-origin": corsOrigin(request, env),
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function userId(request: Request, env: Env) {
  const raw = cookie(request, "lp_session");
  if (!raw) return null;
  const tokenHash = await hash(raw);
  const row = await env.DB.prepare(
    "SELECT usuario_id FROM sessoes WHERE token_hash = ? AND expira_em > datetime('now')"
  ).bind(tokenHash).first<{ usuario_id: string }>();
  return row?.usuario_id || null;
}

async function syncOrder(request: Request, env: Env, uid: string) {
  const body = (await request.json()) as PedidoPayload;
  if (!body?.id || !Array.isArray(body.items)) {
    return response(request, env, { error: "Pedido inválido." }, 400);
  }

  const items = body.items.map((item, index) => ({
    id: String(item.id),
    codigo: String(item.codigo || ""),
    descricao: String(item.descricao || ""),
    quantidade: Math.max(0, Math.floor(Number(item.quantidade) || 0)),
    separado: Math.max(0, Math.min(
      Math.floor(Number(item.quantidade) || 0),
      Math.floor(Number(item.separado) || 0)
    )),
    ordem: index
  }));

  const total = items.reduce((sum, item) => sum + item.quantidade, 0);

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
  ).bind(
    body.id, uid, body.numero || "", body.cliente || "", body.arquivoNome || "",
    body.status || "em_andamento", items.length, total
  ).run();

  await env.DB.prepare("DELETE FROM itens_pedido WHERE pedido_id = ?").bind(body.id).run();

  if (items.length) {
    await env.DB.batch(items.map((item) =>
      env.DB.prepare(
        "INSERT INTO itens_pedido (id,pedido_id,codigo,descricao,quantidade,separado,ordem) VALUES (?,?,?,?,?,?,?)"
      ).bind(item.id, body.id, item.codigo, item.descricao, item.quantidade, item.separado, item.ordem)
    ));
  }

  return response(request, env, { ok: true, id: body.id, totalItens: items.length, totalUnidades: total });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return response(request, env, {}, 204);

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return response(request, env, { ok: true, service: "listapedidos-api", database: "d1" });
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
      const body = (await request.json()) as { email?: string; nome?: string };
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return response(request, env, { error: "E-mail obrigatório." }, 400);

      let user = await env.DB.prepare(
        "SELECT id,nome,email FROM usuarios WHERE email = ?"
      ).bind(email).first<{ id: string; nome: string; email: string }>();

      if (!user) {
        const id = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO usuarios (id,nome,email) VALUES (?,?,?)")
          .bind(id, String(body.nome || ""), email).run();
        user = { id, nome: String(body.nome || ""), email };
      }

      const rawToken = token();
      await env.DB.prepare(
        "INSERT INTO sessoes (token_hash,usuario_id,expira_em) VALUES (?,?,datetime('now','+30 days'))"
      ).bind(await hash(rawToken), user.id).run();

      return response(request, env, { ok: true, user }, 200, {
        "set-cookie": `lp_session=${encodeURIComponent(rawToken)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=None`
      });
    }

    const uid = await userId(request, env);
    if (!uid) return response(request, env, { error: "Não autenticado." }, 401);

    if (url.pathname === "/api/pedidos" && request.method === "GET") {
      const result = await env.DB.prepare(
        `SELECT id,numero_pedido AS numero,cliente,arquivo_nome AS arquivoNome,status,
                total_itens AS totalItens,total_unidades AS totalUnidades,
                criado_em AS criadoEm,atualizado_em AS atualizadoEm
         FROM pedidos WHERE usuario_id=? ORDER BY atualizado_em DESC LIMIT 100`
      ).bind(uid).all();
      return response(request, env, result.results);
    }

    if (url.pathname === "/api/pedidos" && request.method === "POST") {
      return syncOrder(request, env, uid);
    }

    if (url.pathname.startsWith("/api/pedidos/") && request.method === "GET") {
      const id = decodeURIComponent(url.pathname.slice("/api/pedidos/".length));
      const order = await env.DB.prepare(
        `SELECT id,numero_pedido AS numero,cliente,arquivo_nome AS arquivoNome,status,
                total_itens AS totalItens,total_unidades AS totalUnidades,
                criado_em AS criadoEm,atualizado_em AS atualizadoEm
         FROM pedidos WHERE id=? AND usuario_id=?`
      ).bind(id, uid).first();

      if (!order) return response(request, env, { error: "Pedido não encontrado." }, 404);

      const items = await env.DB.prepare(
        "SELECT id,codigo,descricao,quantidade,separado,ordem FROM itens_pedido WHERE pedido_id=? ORDER BY ordem"
      ).bind(id).all();

      return response(request, env, { ...order, items: items.results });
    }

    return response(request, env, { error: "Rota não encontrada." }, 404);
  }
};
