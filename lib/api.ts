export const API_URL =
  process.env.NEXT_PUBLIC_LISTAPEDIDOS_API ||
  "https://listapedidos-api.andermuchael.workers.dev";

export type ApiUser = {
  id: string;
  nome: string;
  email: string;
};

export type ApiItem = {
  id: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  separado: number;
};

export type ApiOrder = {
  id: string;
  numero: string;
  cliente: string;
  arquivoNome: string;
  status: string;
  totalItens: number;
  totalUnidades: number;
  totalSeparado?: number;
  criadoEm?: string;
  atualizadoEm?: string;
  items?: ApiItem[];
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session =
    typeof window !== "undefined"
      ? localStorage.getItem("listapedidos:session-token") || ""
      : "";

  const response = await fetch(API_URL + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(session ? { "X-LP-Session": session } : {}),
      ...(init.headers || {})
    },
    cache: "no-store"
  });

  const text = await response.text();
  let data: unknown = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || "Resposta inválida da API." };
  }

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Erro HTTP ${response.status}`;

    throw new Error(message);
  }

  return data as T;
}

export async function apiHealth() {
  return request<{ ok: boolean; service: string; database: string; dbTest?: { ok: number } }>(
    "/health"
  );
}

export async function getCurrentUser() {
  return request<{ authenticated: boolean; user?: ApiUser }>("/api/auth/me");
}

export async function login(email: string, senha: string) {
  const result = await request<{ ok: boolean; user: ApiUser; sessionToken?: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, senha })
  });
  if (typeof window !== "undefined" && result.sessionToken) {
    localStorage.setItem("listapedidos:session-token", result.sessionToken);
  }
  return result;
}

export async function register(nome: string, email: string, senha: string) {
  const result = await request<{ ok: boolean; user: ApiUser; sessionToken?: string }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ nome, email, senha })
  });
  if (typeof window !== "undefined" && result.sessionToken) {
    localStorage.setItem("listapedidos:session-token", result.sessionToken);
  }
  return result;
}

export async function logout() {
  const result = await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  if (typeof window !== "undefined") localStorage.removeItem("listapedidos:session-token");
  return result;
}

export async function listOrders() {
  return request<ApiOrder[]>("/api/pedidos");
}

export async function getOrder(id: string) {
  return request<ApiOrder & { items: ApiItem[] }>(
    `/api/pedidos/${encodeURIComponent(id)}`
  );
}

export async function saveOrder(order: {
  id: string;
  numero?: string;
  cliente?: string;
  arquivoNome?: string;
  status?: string;
  items: ApiItem[];
}) {
  return request<{
    ok: boolean;
    id: string;
    status: string;
    totalItens: number;
    totalUnidades: number;
  }>("/api/pedidos", {
    method: "POST",
    body: JSON.stringify(order)
  });
}

export async function deleteAllOrders() {
  return request<{ ok: boolean }>("/api/pedidos", { method: "DELETE" });
}

export async function deleteOrder(id: string) {
  return request<{ ok: boolean; id: string }>(
    `/api/pedidos/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export async function updateItemSeparated(
  orderId: string,
  itemId: string,
  separado: number
) {
  return request<{
    ok: boolean;
    itemId: string;
    separado: number;
    status: string;
  }>(
    `/api/pedidos/${encodeURIComponent(orderId)}/itens/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ separado })
    }
  );
}
