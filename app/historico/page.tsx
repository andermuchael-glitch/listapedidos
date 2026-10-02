"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { History, Download, Upload, Trash2, FolderOpen } from "lucide-react";
import { deleteAllOrders, deleteOrder, getOrder, listOrders, saveOrder } from "../../lib/api";

type Item = { id: string; codigo: string; descricao: string; quantidade: number; separado: number };
type Separation = { id: string; fileName: string; numero?: string; cliente?: string; items: Item[]; createdAt: string; status?: string; finishedAt?: string; archivedAt?: string; totalUnidades?: number; totalSeparado?: number };
const PENDING_ORDERS_KEY = "listapedidos:pedidos-pendentes-nuvem";

function orderIdentity(entry: Pick<Separation, "numero" | "fileName">) {
  const numero = String(entry.numero || "").trim();
  if (numero) return `numero:${numero}`;
  return `arquivo:${String(entry.fileName || "").trim().toLowerCase()}`;
}

function mergeHistory(entries: Separation[]) {
  const map = new Map<string, Separation>();

  for (const entry of entries) {
    const key = orderIdentity(entry);
    const previous = map.get(key);

    if (!previous) {
      map.set(key, entry);
      continue;
    }

    const byId = new Map(previous.items.map((item) => [String(item.id), item]));
    for (const item of entry.items) {
      const old = byId.get(String(item.id));
      if (!old) {
        byId.set(String(item.id), item);
      } else {
        byId.set(String(item.id), {
          ...old,
          ...item,
          quantidade: Math.max(Number(old.quantidade) || 0, Number(item.quantidade) || 0),
          separado: Math.max(Number(old.separado) || 0, Number(item.separado) || 0)
        });
      }
    }

    const items = Array.from(byId.values());
    map.set(key, {
      ...previous,
      ...entry,
      id: previous.items.length > 0 ? previous.id : entry.id,
      fileName: previous.fileName || entry.fileName,
      numero: previous.numero || entry.numero,
      cliente: previous.cliente || entry.cliente,
      items,
      status:
        previous.status === "concluida" || entry.status === "concluida"
          ? "concluida"
          : entry.status || previous.status,
      totalUnidades: items.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0),
      totalSeparado: items.reduce((sum, item) => sum + (Number(item.separado) || 0), 0)
    });
  }

  return Array.from(map.values());
}

function queuePendingOrder(entry: Separation) {
  try {
    const current = JSON.parse(localStorage.getItem(PENDING_ORDERS_KEY) || "[]");
    const pending = Array.isArray(current) ? current.filter((item: Separation) => item.id !== entry.id) : [];
    pending.push(entry);
    localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(pending));
  } catch {
    // A restauração local continua válida mesmo se a fila não puder ser gravada.
  }
}

export default function HistoricoPage() {
  const [history, setHistory] = useState<Separation[]>([]);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const restoreGeneration = useRef(0);

  useEffect(() => {
    const localHistory = JSON.parse(localStorage.getItem("listapedidos:historico") || "[]");
    const normalizedLocal = mergeHistory(localHistory);
    setHistory(normalizedLocal);
    localStorage.setItem("listapedidos:historico", JSON.stringify(normalizedLocal));

    const generationAtStart = restoreGeneration.current;

    listOrders()
      .then(async (orders) => {
        if (restoreGeneration.current !== generationAtStart) return;

        const currentLocal = JSON.parse(
          localStorage.getItem("listapedidos:historico") || "[]"
        ) as Separation[];

        const localMap = new Map(
          currentLocal.map((entry) => [entry.id, entry])
        );

        // A lista /pedidos traz o resumo. Para não perder os produtos ao
        // atualizar o celular, buscamos também a versão completa de cada pedido.
        const fullOrders = await Promise.all(
          orders.map(async (order) => {
            try {
              return await getOrder(order.id);
            } catch {
              return null;
            }
          })
        );

        const cloudHistory: Separation[] = orders.map((order, index) => {
          const local = localMap.get(order.id);
          const full = fullOrders[index];
          const cloudItems = Array.isArray(full?.items) ? full.items : [];
          const localItems = Array.isArray(local?.items) ? local.items : [];
          const localById = new Map(
            localItems.map((item) => [String(item.id), item])
          );

          const items = cloudItems.length
            ? cloudItems.map((item) => {
                const localItem = localById.get(String(item.id));
                return {
                  id: String(item.id),
                  codigo: item.codigo || localItem?.codigo || "",
                  descricao: item.descricao || localItem?.descricao || "",
                  quantidade:
                    Number(item.quantidade) ||
                    Number(localItem?.quantidade) ||
                    0,
                  separado: Math.max(
                    Number(item.separado) || 0,
                    Number(localItem?.separado) || 0
                  )
                };
              })
            : localItems;

          return {
            id: order.id,
            fileName: local?.fileName || full?.arquivoNome || order.arquivoNome,
            numero: local?.numero || full?.numero || order.numero || "",
            cliente: local?.cliente || full?.cliente || order.cliente || "",
            items,
            createdAt:
              local?.createdAt ||
              full?.criadoEm ||
              order.criadoEm ||
              new Date().toISOString(),
            status:
              local?.status ||
              full?.status ||
              order.status,
            totalUnidades:
              items.length
                ? items.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0)
                : local?.totalUnidades ?? order.totalUnidades,
            totalSeparado:
              items.length
                ? items.reduce((sum, item) => sum + (Number(item.separado) || 0), 0)
                : local?.totalSeparado ?? order.totalSeparado ?? 0
          };
        });

        if (restoreGeneration.current !== generationAtStart) return;

        for (const local of currentLocal) {
          if (!cloudHistory.some((entry) => entry.id === local.id)) {
            cloudHistory.push(local);
          }
        }

        const mergedHistory = mergeHistory(cloudHistory);
        setHistory(mergedHistory);
        localStorage.setItem(
          "listapedidos:historico",
          JSON.stringify(mergedHistory)
        );
      })
      .catch(() => {
        // Sem sessão ou internet: mantém o histórico local.
      });
  }, []);

  function backup() {
    const payload = {
      app: "ListaPedidos",
      version: 1,
      exportedAt: new Date().toISOString(),
      current: JSON.parse(localStorage.getItem("listapedidos:separacao-atual") || "null"),
      history: JSON.parse(localStorage.getItem("listapedidos:historico") || "[]")
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `listapedidos-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage("Backup baixado com sucesso.");
  }

  async function restore(file?: File) {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const payload = JSON.parse(String(reader.result));

        if (
          payload?.app !== "ListaPedidos" ||
          !Array.isArray(payload.history)
        ) {
          throw new Error();
        }

        // Invalida qualquer consulta de nuvem iniciada antes da restauração.
        restoreGeneration.current += 1;

        const restoredHistory = mergeHistory(payload.history as Separation[]);
        const restoredCurrent = payload.current as Separation | null;

        if (restoredCurrent) {
          localStorage.setItem(
            "listapedidos:separacao-atual",
            JSON.stringify(restoredCurrent)
          );
        }

        localStorage.setItem(
          "listapedidos:historico",
          JSON.stringify(restoredHistory)
        );

        // Atualiza a tela imediatamente e mantém o backup mesmo que a nuvem
        // esteja indisponível.
        setHistory(restoredHistory);
        setMessage(
          "Backup restaurado. A separação e o histórico foram recuperados."
        );

        // Se houver sessão, tenta reconstruir também a cópia na nuvem.
        // Falha aqui não apaga a restauração local.
        const ordersToSync = [...restoredHistory];

        if (
          restoredCurrent &&
          !ordersToSync.some(
            (entry) => entry.id === restoredCurrent.id
          )
        ) {
          ordersToSync.unshift(restoredCurrent);
        }

        const syncable = ordersToSync.filter(
          (entry) =>
            Array.isArray(entry.items) &&
            entry.items.length > 0
        );

        if (syncable.length > 0) {
          try {
            await Promise.all(
              syncable.map((entry) =>
                saveOrder({
                  id: entry.id,
                  numero: entry.numero || "",
                  cliente: entry.cliente || "",
                  arquivoNome: entry.fileName || "",
                  status:
                    entry.status ||
                    "em_andamento",
                  items: entry.items.map((item) => ({
                    id: String(item.id),
                    codigo: item.codigo || "",
                    descricao: item.descricao || "",
                    quantidade: Number(item.quantidade) || 0,
                    separado: Number(item.separado) || 0
                  }))
                })
              )
            );

            setMessage(
              "Backup restaurado e sincronizado com a nuvem."
            );
          } catch {
            // Guarda cada pedido completo que não conseguiu chegar ao D1.
            // Assim a restauração não depende de uma única tentativa de rede.
            for (const entry of syncable) queuePendingOrder(entry);
            setMessage(
              "Backup restaurado localmente. A nuvem falhou nesta tentativa; os pedidos ficaram na fila para sincronização automática."
            );
          }
        }
      } catch {
        setMessage(
          "Backup inválido. Selecione um arquivo .json do ListaPedidos."
        );
      }
    };

    reader.readAsText(file);
  }

  async function openSeparation(entry: Separation) {
    try {
      const cloud = await getOrder(entry.id);
      const cloudItems = Array.isArray(cloud.items) ? cloud.items : [];

      // Uma restauração de backup pode ter todos os produtos localmente,
      // enquanto a nuvem ainda possui apenas o resumo do pedido.
      // Nunca substituímos uma cópia completa por uma resposta sem itens.
      const localById = new Map(entry.items.map((item) => [String(item.id), item]));
      const cloudById = new Map(cloudItems.map((item) => [String(item.id), item]));
      const ids = new Set([
        ...entry.items.map((item) => String(item.id)),
        ...cloudItems.map((item) => String(item.id))
      ]);

      // O histórico local e o D1 são mesclados. A nuvem nunca pode eliminar
      // produtos que ainda existem no celular.
      const mergedItems = Array.from(ids).map((id) => {
        const local = localById.get(id);
        const cloudItem = cloudById.get(id);
        return {
          id,
          codigo: cloudItem?.codigo || local?.codigo || "",
          descricao: cloudItem?.descricao || local?.descricao || "",
          quantidade:
            Math.max(
              Number(cloudItem?.quantidade) || 0,
              Number(local?.quantidade) || 0
            ),
          separado:
            Math.max(
              Number(cloudItem?.separado) || 0,
              Number(local?.separado) || 0
            )
        };
      });

      const full: Separation = {
        id: entry.id,
        fileName: cloud.arquivoNome || entry.fileName,
        numero: cloud.numero || entry.numero || "",
        cliente: cloud.cliente || entry.cliente || "",
        items: mergedItems,
        createdAt: cloud.criadoEm || entry.createdAt,
        status:
          cloud.status === "concluida" || entry.status === "concluida"
            ? "concluida"
            : cloud.status || entry.status,
        totalUnidades: mergedItems.reduce((s, i) => s + i.quantidade, 0),
        totalSeparado: mergedItems.reduce((s, i) => s + i.separado, 0)
      };

      localStorage.setItem(
        "listapedidos:separacao-atual",
        JSON.stringify(full)
      );

      // Se a nuvem estava vazia ou incompleta, reenvia a cópia completa.
      // Isso corrige pedidos que chegaram ao D1 apenas com o cabeçalho.
      if (entry.items.length > cloudItems.length) {
        try {
          await saveOrder({
            id: full.id,
            numero: full.numero || "",
            cliente: full.cliente || "",
            arquivoNome: full.fileName || "",
            status: full.status || "em_andamento",
            items: full.items
          });
        } catch {
          queuePendingOrder(full);
        }
      }
    } catch {
      // Offline: a cópia local continua sendo usada e fica marcada para
      // sincronização automática assim que a conexão voltar.
      if (!entry.items.length) {
        setMessage(
          "Não foi possível abrir este pedido agora. Conecte-se à internet para carregar os itens salvos na nuvem."
        );
        return;
      }
      localStorage.setItem(
        "listapedidos:separacao-atual",
        JSON.stringify(entry)
      );
      queuePendingOrder(entry);
    }

    window.location.href = "/listapedidos/separacao/atual/";
  }

  async function deleteSeparation(id: string) {
    const entry = history.find((item) => item.id === id);
    if (!entry) return;
    if (!confirm(`Excluir a separação "${entry.fileName}" do histórico? Esta ação não apaga o arquivo de backup.`)) return;

    try {
      await deleteOrder(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message !== "Não autenticado.") {
        setMessage(message || "Não foi possível excluir o pedido na nuvem.");
        return;
      }
    }

    const next = history.filter((item) => item.id !== id);
    localStorage.setItem("listapedidos:historico", JSON.stringify(next));
    setHistory(next);
  }

  async function clearHistory() {
    if (!confirm("Apagar todo o histórico? O backup não será afetado.")) return;
    try {
      await deleteAllOrders();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message !== "Não autenticado.") {
        setMessage(message || "Não foi possível limpar o histórico na nuvem.");
        return;
      }
    }

    localStorage.removeItem("listapedidos:historico");
    setHistory([]);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <Link className="back-link" href="/">← Voltar</Link>
          <h1>Histórico</h1>
        </div>
        <History size={25} />
      </header>

      <section className="section">
        <div className="empty-card">
          <h2>Backup manual</h2>
          <p className="muted">Salve suas separações em um arquivo e restaure depois no PWA, mesmo após limpar o navegador.</p>
          <div className="filter-row">
            <button className="primary-button" onClick={backup}><Download size={18} /> Baixar backup</button>
            <label className="filter">
              <Upload size={18} /> Restaurar backup
              <input type="file" accept=".json,application/json" onChange={(e) => restore(e.target.files?.[0])} style={{display:"none"}} />
            </label>
          </div>
          {message && <p className="muted">{message}</p>}
        </div>
      </section>

      <section className="section">
        <div className="section-heading"><div><p className="eyebrow">SEPARAÇÕES SALVAS</p><h2>{history.length ? `${history.length} registro(s)` : "Nenhuma separação salva"}</h2></div></div>
        {history.filter((entry) => {
          const q = query.toLowerCase().trim();
          if (!q) return true;
          return [entry.numero, entry.cliente, entry.fileName].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
        }).map((entry) => {
          // Quando há produtos disponíveis, eles são a fonte de verdade do
          // percentual. Isso evita mostrar 0% quando o resumo antigo do pedido
          // ainda está com totalSeparado=0.
          const totalFromItems = entry.items.reduce((s, i) => s + Number(i.quantidade || 0), 0);
          const separatedFromItems = entry.items.reduce((s, i) => s + Number(i.separado || 0), 0);
          const total = entry.items.length > 0 ? totalFromItems : (entry.totalUnidades ?? 0);
          const separated = entry.items.length > 0 ? separatedFromItems : (entry.totalSeparado ?? 0);
          return (
            <article
              className="item-card history-card"
              key={entry.id}
              role="button"
              tabIndex={0}
              onClick={() => openSeparation(entry)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openSeparation(entry);
                }
              }}
              title="Abrir esta separação"
            >
              <div className="item-main">
                <div className="check-circle">{entry.status === "concluida" ? "✓" : "•"}</div>
                <div>
                  <p className="history-order-number">PEDIDO {entry.numero ? `#${entry.numero}` : "SEM NÚMERO"}</p>
                  <strong className="history-client">{entry.cliente || "Cliente não identificado"}</strong>
                  <p>{entry.fileName} · {separated} / {total} unidades separadas · {entry.status === "concluida" ? "Concluída" : "Em andamento"}</p>
                </div>
              </div>
              <div className="history-actions">
                <span className="badge">{Math.round((separated / Math.max(total,1))*100)}%</span>
                <FolderOpen size={20} aria-hidden="true" />
                <button
                  className="delete-history-button"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSeparation(entry.id);
                  }}
                  aria-label={`Excluir ${entry.fileName}`}
                  title="Excluir pedido"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </article>
          );
        })}
        {history.length > 0 && <button className="filter" onClick={clearHistory}><Trash2 size={17}/> Limpar histórico</button>}
      </section>
    </main>
  );
}