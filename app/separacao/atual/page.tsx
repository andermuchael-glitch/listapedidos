"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Minus, Plus, Search } from "lucide-react";
import { getOrder, listOrders, saveOrder, updateItemSeparated } from "../../../lib/api";

type Item = { id: string; codigo: string; descricao: string; quantidade: number; separado: number };
type Separation = { id: string; fileName: string; numero: string; cliente: string; items: Item[]; createdAt: string; status?: string; finishedAt?: string };
type PendingSync = { orderId: string; itemId: string; separado: number };
const PENDING_SYNC_KEY = "listapedidos:sync-pendente";

function readPendingSync(): PendingSync[] {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writePendingSync(value: PendingSync[]) {
  localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(value));
}

function queuePendingSync(entry: PendingSync) {
  const pending = readPendingSync().filter(
    (item) => !(item.orderId === entry.orderId && item.itemId === entry.itemId)
  );
  pending.push(entry);
  writePendingSync(pending);
}

function removePendingSync(orderId: string, itemId: string) {
  writePendingSync(
    readPendingSync().filter(
      (item) => !(item.orderId === orderId && item.itemId === itemId)
    )
  );
}

async function retryPendingSync(orderId: string) {
  const pending = readPendingSync().filter((item) => item.orderId === orderId);
  for (const item of pending) {
    try {
      await updateItemSeparated(item.orderId, item.itemId, item.separado);
      removePendingSync(item.orderId, item.itemId);
    } catch {
      // Continua tentando os demais itens. Os que falharem permanecem na fila.
    }
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
          const cloud = await getOrder(localData.id);
          if (!cancelled) {
            const localById = new Map(
              (localData.items || []).map((item) => [String(item.id), item])
            );

            const merged: Separation = {
              id: cloud.id,
              fileName: cloud.arquivoNome || localData.fileName,
              numero: cloud.numero || localData.numero || "",
              cliente: cloud.cliente || localData.cliente || "",
              items: cloud.items.map((item) => {
                const local = localById.get(String(item.id));
                return {
                  id: String(item.id),
                  codigo: item.codigo || local?.codigo || "",
                  descricao: item.descricao || local?.descricao || "",
                  quantidade:
                    Number(item.quantidade) ||
                    Number(local?.quantidade) ||
                    0,
                  // Nunca reduz o progresso local por causa de uma resposta
                  // antiga da nuvem.
                  separado: Math.max(
                    Number(item.separado) || 0,
                    Number(local?.separado) || 0
                  )
                };
              }),
              createdAt: cloud.criadoEm || localData.createdAt,
              status:
                cloud.status === "concluida" || localData.status === "concluida"
                  ? "concluida"
                  : cloud.status || localData.status
            };
            setData(merged);
            localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(merged));
            await retryPendingSync(merged.id);
            try {
              const refreshed = await getOrder(merged.id);
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
        // Sem internet/login, usamos o cache local.
      }

      if (!cancelled && localData) setData(localData);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function save(next: Separation) {
    const total = next.items.reduce((sum, item) => sum + item.quantidade, 0);
    const separated = next.items.reduce((sum, item) => sum + item.separado, 0);
    const status = total > 0 && separated >= total ? "concluida" : "em_andamento";
    const normalized = { ...next, status };

    setData(normalized);
    localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(normalized));

    // Mantém também a cópia do histórico sincronizada com a alteração.
    // Assim, ao sair e reabrir uma separação, ela volta exatamente ao último estado salvo.
    try {
      const history = JSON.parse(localStorage.getItem("listapedidos:historico") || "[]");
      const updatedHistory = history.map((entry: Separation) =>
        entry.id === normalized.id ? { ...entry, ...normalized } : entry
      );
      localStorage.setItem("listapedidos:historico", JSON.stringify(updatedHistory));
    } catch {
      // O estado atual continua salvo mesmo se houver problema no histórico.
    }
  }

  function syncItem(id: string, separado: number) {
    if (!data) return;
    updateItemSeparated(data.id, id, separado)
      .then(() => {
        removePendingSync(data.id, id);
        setSyncError("");
      })
      .catch((error) => {
        queuePendingSync({ orderId: data.id, itemId: id, separado });
        setSyncError(error instanceof Error ? error.message : "Não foi possível sincronizar com a nuvem.");
      });
  }

  function changeQuantity(id: string, delta: number) {
    if (!data) return;
    const current = data.items.find((item) => item.id === id);
    if (!current) return;

    const nextValue = Math.max(0, Math.min(current.quantidade, current.separado + delta));
    const items = data.items.map((item) =>
      item.id === id ? { ...item, separado: nextValue } : item
    );
    save({ ...data, items });
    syncItem(id, nextValue);
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
    save({ ...data, items });
    syncItem(id, nextValue);
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
            try {
              await saveOrder({
                id: finished.id,
                numero: finished.numero,
                cliente: finished.cliente,
                arquivoNome: finished.fileName,
                status: "concluida",
                items: finished.items
              });
              const history = JSON.parse(localStorage.getItem("listapedidos:historico") || "[]");
              const withoutCurrent = history.filter((entry: Separation) => entry.id !== finished.id);
              withoutCurrent.unshift(finished);
              localStorage.setItem("listapedidos:historico", JSON.stringify(withoutCurrent.slice(0, 100)));
              localStorage.setItem("listapedidos:separacao-concluida", JSON.stringify(finished));
              localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(finished));
              setData(finished);
              setSyncError("");
              alert("Separação finalizada e salva no histórico e na nuvem.");
            } catch (error) {
              setSyncError(error instanceof Error ? error.message : "Não foi possível finalizar na nuvem.");
            }
          }}>Finalizar</button>
        </section>
      )}
    </main>
  );
}
