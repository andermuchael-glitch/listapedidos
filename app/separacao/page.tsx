import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";

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
        </div>
      </section>
    </main>
  );
}