import Link from "next/link";
import { ClipboardList, FileSpreadsheet, History, Plus } from "lucide-react";

export default function Home() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LISTAPEDIDOS</span>
          <h1>Separação</h1>
        </div>
        <div className="brand-mark">LP</div>
      </header>

      <section className="hero-card">
        <div>
          <span className="status-dot" />
          <p className="eyebrow">CENTRAL DE SEPARAÇÃO</p>
          <h2>Transforme sua planilha em uma lista de separação.</h2>
          <p className="muted">Importe o pedido, confira os dados e acompanhe a quantidade separada em tempo real.</p>
        </div>
        <Link className="primary-button" href="/separacao/nova">
          <Plus size={20} /> Nova separação
        </Link>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PEDIDOS</p>
            <h2>Comece uma nova separação</h2>
          </div>
        </div>
        <div className="empty-card">
          <FileSpreadsheet size={34} />
          <h3>Nenhuma separação em andamento</h3>
          <p>Importe a primeira planilha para criar automaticamente sua lista.</p>
          <Link className="secondary-button" href="/separacao/nova">Importar planilha</Link>
        </div>
      </section>

      <nav className="bottom-nav">
        <Link className="active" href="/"><ClipboardList size={19} /><span>Separação</span></Link>
        <Link href="/historico"><History size={19} /><span>Histórico</span></Link>
      </nav>
    </main>
  );
}