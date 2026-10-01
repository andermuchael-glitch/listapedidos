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
  criadoEm?: string;
  atualizadoEm?: string;
  items?: ApiItem[];
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
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
  return request<{ ok: boolean; user: ApiUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, senha })
  });
}

export async function register(nome: string, email: string, senha: string) {
  return request<{ ok: boolean; user: ApiUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ nome, email, senha })
  });
}

export async function logout() {
  return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
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
