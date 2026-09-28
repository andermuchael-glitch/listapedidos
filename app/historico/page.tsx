import Link from "next/link";
import { History } from "lucide-react";

export default function HistoricoPage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <Link className="back-link" href="/">← Voltar</Link>
          <h1>Histórico</h1>
        </div>
        <History size={25} />
      </header>
      <section className="empty-card">
        <h2>Nenhuma separação concluída</h2>
        <p className="muted">Quando uma separação for finalizada, ela aparecerá aqui.</p>
      </section>
    </main>
  );
}