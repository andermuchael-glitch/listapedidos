"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { History, Download, Upload, Trash2, FolderOpen } from "lucide-react";

type Item = { id: string; codigo: string; descricao: string; quantidade: number; separado: number };
type Separation = { id: string; fileName: string; items: Item[]; createdAt: string; status?: string; finishedAt?: string; archivedAt?: string };

export default function HistoricoPage() {
  const [history, setHistory] = useState<Separation[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setHistory(JSON.parse(localStorage.getItem("listapedidos:historico") || "[]"));
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

  function restore(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        if (payload?.app !== "ListaPedidos" || !Array.isArray(payload.history)) throw new Error();
        if (payload.current) localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(payload.current));
        localStorage.setItem("listapedidos:historico", JSON.stringify(payload.history));
        setHistory(payload.history);
        setMessage("Backup restaurado. A separação e o histórico foram recuperados.");
      } catch {
        setMessage("Backup inválido. Selecione um arquivo .json do ListaPedidos.");
      }
    };
    reader.readAsText(file);
  }

  function openSeparation(entry: Separation) {
    localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(entry));
    window.location.href = "/listapedidos/separacao/atual/";
  }

  function clearHistory() {
    if (!confirm("Apagar todo o histórico? O backup não será afetado.")) return;
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
        {history.map((entry) => {
          const total = entry.items.reduce((s, i) => s + i.quantidade, 0);
          const separated = entry.items.reduce((s, i) => s + i.separado, 0);
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
                <div><strong>{entry.fileName}</strong><p>{separated} / {total} unidades separadas · {entry.status === "concluida" ? "Concluída" : "Em andamento"}</p></div>
              </div>
              <div className="history-actions">
                <span className="badge">{Math.round((separated / Math.max(total,1))*100)}%</span>
                <button
                  className="icon-button"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSeparation(entry);
                  }}
                  aria-label="Abrir separação"
                  title="Abrir separação"
                >
                  <FolderOpen size={18} />
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