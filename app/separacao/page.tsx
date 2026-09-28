import Link from "next/link";
import { ArrowLeft, Plus, Download, Upload } from "lucide-react";

export default function SeparacaoPage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <Link className="back-link" href="/">← Voltar</Link>
          <h1>Separação</h1>
        </div>
        <Link className="icon-button" href="/separacao/nova" aria-label="Nova separação"><Plus size={22} /></Link>
      </header>

      <section className="section">
        <div className="empty-card">
          <h2>Suas separações</h2>
          <p className="muted">As ordens importadas aparecerão aqui.</p>
          <Link className="primary-button" href="/separacao/nova">Nova separação</Link>
          <div className="filter-row" style={{marginTop: 12}}>
            <Link className="filter" href="/historico">Histórico e backup</Link>
          </div>
        </div>
      </section>
    </main>
  );
}