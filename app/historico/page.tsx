"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { History, Download, Upload, Trash2, FolderOpen } from "lucide-react";
import { deleteAllOrders, deleteOrder, getOrder, listOrders, saveOrder } from "../../lib/api";

type Item = { id: string; codigo: string; descricao: string; quantidade: number; separado: number };
type Separation = { id: string; fileName: string; numero?: string; cliente?: string; items: Item[]; createdAt: string; status?: string; finishedAt?: string; archivedAt?: string; totalUnidades?: number; totalSeparado?: number };

export default function HistoricoPage() {
  const [history, setHistory] = useState<Separation[]>([]);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const restoreGeneration = useRef(0);

  useEffect(() => {
    const localHistory = JSON.parse(localStorage.getItem("listapedidos:historico") || "[]");
    setHistory(localHistory);

    const generationAtStart = restoreGeneration.current;

    listOrders()
      .then((orders) => {
        // Se um backup foi restaurado enquanto a consulta estava em andamento,
        // não deixe a resposta antiga da nuvem sobrescrever o backup recém-restaurado.
        if (restoreGeneration.current !== generationAtStart) return;

        const cloudHistory: Separation[] = orders.map((order) => ({
          id: order.id,
          fileName: order.arquivoNome,
          numero: order.numero || "",
          cliente: order.cliente || "",
          items: [],
          createdAt: order.criadoEm || new Date().toISOString(),
          status: order.status,
          totalUnidades: order.totalUnidades,
          totalSeparado: order.totalSeparado
        })) as Separation[];

        setHistory(cloudHistory);
        localStorage.setItem("listapedidos:historico", JSON.stringify(cloudHistory));
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

        const restoredHistory = payload.history as Separation[];
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
            setMessage(
              "Backup restaurado localmente. A sincronização com a nuvem será tentada novamente quando houver conexão."
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
      const full: Separation = {
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
        createdAt: cloud.criadoEm || entry.createdAt,
        status: cloud.status
      };
      localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(full));
    } catch {
      // Se estiver offline, só usamos a cópia local quando ela realmente contém itens.
      if (!entry.items.length) {
        setMessage("Não foi possível abrir este pedido agora. Conecte-se à internet para carregar os itens salvos na nuvem.");
        return;
      }
      localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(entry));
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
          const total = entry.totalUnidades ?? entry.items.reduce((s, i) => s + i.quantidade, 0);
          const separated = entry.totalSeparado ?? entry.items.reduce((s, i) => s + i.separado, 0);
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