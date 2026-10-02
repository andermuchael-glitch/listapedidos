"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Minus, Plus, Search } from "lucide-react";
import { getOrder, listOrders, saveOrder } from "../../../lib/api";

type Item = { id: string; codigo: string; descricao: string; quantidade: number; separado: number };
type Separation = { id: string; fileName: string; numero: string; cliente: string; items: Item[]; createdAt: string; status?: string; finishedAt?: string };
type PendingOrder = Separation;
const PENDING_ORDERS_KEY = "listapedidos:pedidos-pendentes-nuvem";
const syncChains = new Map<string, Promise<boolean>>();

function readPendingOrders(): PendingOrder[] {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_ORDERS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function queuePendingOrder(order: PendingOrder) {
  const pending = readPendingOrders().filter((item) => item.id !== order.id);
  pending.push(order);
  localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(pending.slice(-100)));
}

function removePendingOrder(orderId: string, expectedSerialized?: string) {
  const pending = readPendingOrders();
  const next = expectedSerialized
    ? pending.filter((item) => item.id !== orderId || JSON.stringify(item) !== expectedSerialized)
    : pending.filter((item) => item.id !== orderId);
  localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(next));
}

function syncFullOrder(order: Separation): Promise<boolean> {
  queuePendingOrder(order);

  const previous = syncChains.get(order.id) || Promise.resolve(true);
  const current = previous
    .catch(() => false)
    .then(async () => {
      const snapshot = JSON.stringify(order);
      try {
        await saveOrder({
          id: order.id,
          numero: order.numero,
          cliente: order.cliente,
          arquivoNome: order.fileName,
          status: order.status || "em_andamento",
          items: order.items
        });
        removePendingOrder(order.id, snapshot);
        return true;
      } catch {
        // A cópia permanece na fila. Uma alteração mais nova para o mesmo
        // pedido nunca será apagada por uma resposta antiga.
        return false;
      }
    });

  syncChains.set(order.id, current);
  current.finally(() => {
    if (syncChains.get(order.id) === current) {
      syncChains.delete(order.id);
    }
  });
  return current;
}

async function retryPendingOrders(orderId?: string) {
  const pending = readPendingOrders().filter((item) => !orderId || item.id === orderId);
  for (const order of pending) {
    await syncFullOrder(order);
  }
}

export default function SeparacaoAtualPage() {
  const [data, setData] = useState<Separation | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"todos" | "pendentes" | "separados">("todos");
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let localData: Separation | null = null;

      try {
        const raw = localStorage.getItem("listapedidos:separacao-atual");
        if (raw) localData = JSON.parse(raw);
      } catch {
        localData = null;
      }

      try {
        if (localData?.id) {
          // Primeiro tenta enviar uma cópia completa pendente. Isso é importante
          // quando o último PATCH ou o botão Finalizar falhou por conexão.
          await retryPendingOrders(localData.id);
          const cloud = await getOrder(localData.id);
          if (!cancelled) {
            // Se a nuvem ainda não possui os itens, o backup/local é a fonte
            // de verdade. Nunca transformamos uma separação válida em 0/0.
            if ((!cloud.items || cloud.items.length === 0) && (localData.items || []).length > 0) {
              // A nuvem pode estar apenas com o cabeçalho do pedido. Nesse caso
              // o celular continua sendo a fonte de verdade e REENVIA o pedido
              // completo para reconstruir os itens no D1.
              setData(localData);
              syncFullOrder(localData).then((ok) => {
                if (!cancelled) {
                  setSyncError(ok ? "" : "Não foi possível sincronizar agora.");
                }
              });
              return;
            }

            const localById = new Map(
              (localData.items || []).map((item) => [String(item.id), item])
            );

            const cloudItems = Array.isArray(cloud.items) ? cloud.items : [];
            const cloudById = new Map(
              cloudItems.map((item) => [String(item.id), item])
            );

            // Mantém também itens que existem no dispositivo e ainda não chegaram
            // ao D1. A nuvem nunca pode transformar um pedido válido em 0 itens.
            const itemIds = new Set([
              ...(localData.items || []).map((item) => String(item.id)),
              ...cloudItems.map((item) => String(item.id))
            ]);

            const mergedItems = Array.from(itemIds).map((itemId) => {
              const item = cloudById.get(itemId);
              const local = localById.get(itemId);

              return {
                id: itemId,
                codigo: item?.codigo || local?.codigo || "",
                descricao: item?.descricao || local?.descricao || "",
                quantidade:
                  Number(item?.quantidade) ||
                  Number(local?.quantidade) ||
                  0,
                separado: Math.max(
                  Number(item?.separado) || 0,
                  Number(local?.separado) || 0
                )
              };
            });

            const merged: Separation = {
              id: cloud.id,
              fileName: cloud.arquivoNome || localData.fileName,
              numero: cloud.numero || localData.numero || "",
              cliente: cloud.cliente || localData.cliente || "",
              items: mergedItems,
              createdAt: cloud.criadoEm || localData.createdAt,
              status:
                cloud.status === "concluida" || localData.status === "concluida"
                  ? "concluida"
                  : cloud.status || localData.status
            };
            setData(merged);
            localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(merged));

            // Reenvia a separação COMPLETA depois de carregar. Isso recupera
            // automaticamente casos em que a última alteração foi salva localmente
            // mas o PATCH/Finalizar falhou com "Failed to fetch".
            try {
              await saveOrder({
                id: merged.id,
                numero: merged.numero,
                cliente: merged.cliente,
                arquivoNome: merged.fileName,
                status: merged.status || "em_andamento",
                items: merged.items
              });
              removePendingOrder(merged.id);
              setSyncError("");
            } catch {
              queuePendingOrder(merged);
            }

            try {
              const refreshed = await getOrder(merged.id);
              if (!refreshed.items || refreshed.items.length === 0) return;

              const currentLocal = JSON.parse(
                localStorage.getItem("listapedidos:separacao-atual") || "null"
              ) as Separation | null;
              const currentById = new Map(
                (currentLocal?.items || merged.items).map((item) => [
                  String(item.id),
                  item
                ])
              );

              const synced: Separation = {
                id: refreshed.id,
                fileName: refreshed.arquivoNome || merged.fileName,
                numero: refreshed.numero || merged.numero || "",
                cliente: refreshed.cliente || merged.cliente || "",
                items: refreshed.items.map((item) => {
                  const local = currentById.get(String(item.id));
                  return {
                    id: String(item.id),
                    codigo: item.codigo || local?.codigo || "",
                    descricao: item.descricao || local?.descricao || "",
                    quantidade:
                      Number(item.quantidade) ||
                      Number(local?.quantidade) ||
                      0,
                    separado: Math.max(
                      Number(item.separado) || 0,
                      Number(local?.separado) || 0
                    )
                  };
                }),
                createdAt: refreshed.criadoEm || merged.createdAt,
                status:
                  refreshed.status === "concluida" ||
                  currentLocal?.status === "concluida"
                    ? "concluida"
                    : refreshed.status || currentLocal?.status || merged.status
              };
              if (!cancelled) {
                setData(synced);
                localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(synced));
              }
            } catch {
              // A primeira leitura já é válida; mantém o estado local/cloud disponível.
            }
          }
          return;
        }

        await retryPendingOrders();
        const orders = await listOrders();
        if (orders.length) {
          const cloud = await getOrder(orders[0].id);
          if (!cancelled) {
            const fresh: Separation = {
              id: cloud.id,
              fileName: cloud.arquivoNome,
              numero: cloud.numero || "",
              cliente: cloud.cliente || "",
              items: cloud.items.map((item) => ({
                id: String(item.id),
                codigo: item.codigo,
                descricao: item.descricao,
                quantidade: Number(item.quantidade) || 0,
                separado: Number(item.separado) || 0
              })),
              createdAt: cloud.criadoEm || new Date().toISOString(),
              status: cloud.status
            };
            setData(fresh);
            localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(fresh));
          }
          return;
        }
      } catch {
        // Sem internet/login: preserva o pedido no dispositivo e deixa uma
        // cópia completa na fila para o próximo retorno da conexão.
        if (localData?.id) queuePendingOrder(localData);
      }

      if (!cancelled && localData) setData(localData);
    }

    const retry = () => {
      try {
        const raw = localStorage.getItem("listapedidos:separacao-atual");
        const current = raw ? JSON.parse(raw) as Separation : null;
        if (current?.id) {
          retryPendingOrders(current.id).then(() => {
            if (!cancelled) setSyncError("");
          });
        }
      } catch {}
    };

    const onOnline = () => retry();
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };

    load();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function save(next: Separation) {
    const total = next.items.reduce((sum, item) => sum + item.quantidade, 0);
    const separated = next.items.reduce((sum, item) => sum + item.separado, 0);
    const status = total > 0 && separated >= total ? "concluida" : "em_andamento";
    const normalized: Separation = {
      ...next,
      status,
      ...(status === "concluida" && !next.finishedAt
        ? { finishedAt: new Date().toISOString() }
        : {})
    };

    setData(normalized);
    localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(normalized));

    // O pedido passa automaticamente para o histórico assim que chega a 100%.
    // Se ainda estiver em andamento, apenas atualiza uma cópia que já exista no histórico.
    try {
      const history = JSON.parse(localStorage.getItem("listapedidos:historico") || "[]");
      const existingIndex = history.findIndex(
        (entry: Separation) => entry.id === normalized.id
      );

      if (normalized.status === "concluida") {
        const archived = {
          ...normalized,
          archivedAt:
            history[existingIndex]?.archivedAt || new Date().toISOString(),
          totalUnidades: total,
          totalSeparado: separated
        };

        if (existingIndex >= 0) {
          history[existingIndex] = { ...history[existingIndex], ...archived };
        } else {
          history.unshift(archived);
        }

        localStorage.setItem(
          "listapedidos:historico",
          JSON.stringify(history.slice(0, 100))
        );
      } else if (existingIndex >= 0) {
        history[existingIndex] = { ...history[existingIndex], ...normalized };
        localStorage.setItem("listapedidos:historico", JSON.stringify(history));
      }
    } catch {
      // O estado atual continua salvo mesmo se houver problema no histórico.
    }
  }

  function changeQuantity(id: string, delta: number) {
    if (!data) return;
    const current = data.items.find((item) => item.id === id);
    if (!current) return;

    const nextValue = Math.max(0, Math.min(current.quantidade, current.separado + delta));
    const items = data.items.map((item) =>
      item.id === id ? { ...item, separado: nextValue } : item
    );
    const nextData = { ...data, items };
    save(nextData);

    // Uma única fila por pedido garante que duas alterações rápidas no celular
    // nunca sejam gravadas fora de ordem no D1.
    syncFullOrder(nextData).then((ok) => {
      if (ok) setSyncError("");
      else setSyncError("Não foi possível sincronizar agora.");
    });
  }

  function setQuantity(id: string, value: string) {
    if (!data) return;
    const parsed = value === "" ? 0 : Number(value);
    if (!Number.isFinite(parsed)) return;

    const item = data.items.find((current) => current.id === id);
    if (!item) return;

    const nextValue = Math.max(0, Math.min(item.quantidade, Math.floor(parsed)));
    const items = data.items.map((current) =>
      current.id === id ? { ...current, separado: nextValue } : current
    );
    const nextData = { ...data, items };
    save(nextData);

    // A mesma fila serializada é usada para a edição digitada.
    syncFullOrder(nextData).then((ok) => {
      if (ok) setSyncError("");
      else setSyncError("Não foi possível sincronizar agora.");
    });
  }

  const visibleItems = useMemo(() => {
    if (!data) return [];
    const q = query.toLowerCase().trim();
    return data.items.filter((item) => {
      const matchesQuery = !q || item.codigo.toLowerCase().includes(q) || item.descricao.toLowerCase().includes(q);
      const matchesFilter =
        filter === "todos" ||
        (filter === "pendentes" && item.separado < item.quantidade) ||
        (filter === "separados" && item.separado === item.quantidade);
      return matchesQuery && matchesFilter;
    });
  }, [data, query, filter]);

  if (!data) {
    return (
      <main className="app-shell">
        <header className="topbar"><Link className="back-link" href="/separacao/">← Voltar</Link><h1>Separação</h1></header>
        <section className="empty-card">
          <h2>Nenhuma separação carregada</h2>
          <p className="muted">Importe uma planilha para criar a lista.</p>
          <Link className="primary-button" href="/separacao/nova/">Importar planilha</Link>
        </section>
      </main>
    );
  }

  const total = data.items.reduce((sum, item) => sum + item.quantidade, 0);
  const separated = data.items.reduce((sum, item) => sum + item.separado, 0);
  const completed = data.items.filter((item) => item.separado === item.quantidade).length;
  const progress = total ? Math.round((separated / total) * 100) : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <Link className="back-link" href="/separacao/">← Separações</Link>
          <h1>Separação</h1>
        </div>
        <span className="badge">{progress}%</span>
      </header>

      <section className="order-header">
        <div>
          <p className="eyebrow">PEDIDO {data.numero ? `#${data.numero}` : ""}</p>
          <h2>{data.cliente || "Cliente não identificado"}</h2>
          <p className="muted">{data.fileName}</p>
        </div>
        <div className="big-progress"><strong>{separated}</strong><span> / {total} unidades</span></div>
      </section>

      <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>

      {syncError && <div className="error-box">{syncError} O progresso continua salvo neste dispositivo e será sincronizado quando possível.</div>}

      <div className="stats-row">
        <span><strong>{completed}</strong> concluídos</span>
        <span><strong>{data.items.length - completed}</strong> pendentes</span>
        <span><strong>{total - separated}</strong> faltam</span>
      </div>

      <div className="search-box">
        <Search size={19} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar produto ou código" />
      </div>

      <div className="filter-row">
        <button className={filter === "todos" ? "filter active" : "filter"} onClick={() => setFilter("todos")}>Todos</button>
        <button className={filter === "pendentes" ? "filter active" : "filter"} onClick={() => setFilter("pendentes")}>Pendentes</button>
        <button className={filter === "separados" ? "filter active" : "filter"} onClick={() => setFilter("separados")}>Separados</button>
      </div>

      <section className="items-list">
        {visibleItems.map((item) => {
          const complete = item.separado === item.quantidade;
          return (
            <article className={complete ? "item-card complete" : "item-card"} key={item.id}>
              <div className="item-main">
                <div className={complete ? "check-circle done" : "check-circle"}>{complete ? <Check size={18} /> : null}</div>
                <div>
                  <strong>{item.codigo || "Sem código"}</strong>
                  <p>{item.descricao || "Produto sem descrição"}</p>
                </div>
              </div>
              <div className="quantity-area">
                <div className="quantity-value">
                  <span>Separado</span>
                  <div className="quantity-input-row">
                    <input
                      className="quantity-input"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max={item.quantidade}
                      step="1"
                      value={item.separado}
                      onChange={(e) => setQuantity(item.id, e.target.value)}
                      aria-label={`Quantidade separada de ${item.codigo}`}
                    />
                    <strong>/ {item.quantidade}</strong>
                  </div>
                </div>
                <div className="quantity-controls">
                  <button onClick={() => changeQuantity(item.id, -1)} disabled={item.separado === 0} aria-label="Diminuir"><Minus size={17} /></button>
                  <button onClick={() => changeQuantity(item.id, 1)} disabled={complete} aria-label="Aumentar"><Plus size={17} /></button>
                </div>
              </div>
            </article>
          );
        })}
        {!visibleItems.length && <div className="empty-card"><h3>Nenhum item encontrado</h3><p className="muted">Altere a pesquisa ou o filtro.</p></div>}
      </section>

      {progress === 100 && (
        <section className="finish-card">
          <div><strong>Separação completa</strong><span>Todos os {total} itens foram separados.</span></div>
          <button className="primary-button" onClick={async () => {
            const finished = { ...data, finishedAt: new Date().toISOString(), status: "concluida" };
            const history = JSON.parse(localStorage.getItem("listapedidos:historico") || "[]");
            const finishedKey = orderIdentity(finished);
            const withoutCurrent = history.filter((entry: Separation) => orderIdentity(entry) !== finishedKey);
            withoutCurrent.unshift(finished);
            localStorage.setItem("listapedidos:historico", JSON.stringify(withoutCurrent.slice(0, 100)));
            localStorage.setItem("listapedidos:separacao-concluida", JSON.stringify(finished));
            localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(finished));
            setData(finished);

            try {
              await saveOrder({
                id: finished.id,
                numero: finished.numero,
                cliente: finished.cliente,
                arquivoNome: finished.fileName,
                status: "concluida",
                items: finished.items
              });
              removePendingOrder(finished.id);
              setSyncError("");
              alert("Separação finalizada e salva no histórico e na nuvem.");
            } catch (error) {
              // Nunca perde a separação local só porque a nuvem falhou.
              queuePendingOrder(finished);
              setSyncError(
                "Não foi possível sincronizar agora. A separação foi salva neste dispositivo e será reenviada automaticamente."
              );
            }
          }}>Finalizar</button>
        </section>
      )}
    </main>
  );
}
