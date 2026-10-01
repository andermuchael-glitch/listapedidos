"use client";

import Link from "next/link";
import { ClipboardList, FileSpreadsheet, History, Plus, LogIn, LogOut } from "lucide-react";
import { getCurrentUser, logout } from "../lib/api";
import { useEffect, useState } from "react";

export default function Home() {\n  const [user, setUser] = useState<{ nome: string; email: string } | null>(null);\n\n  useEffect(() => {\n    getCurrentUser()\n      .then((result) => {\n        if (result.authenticated && result.user) setUser(result.user);\n      })\n      .catch(() => setUser(null));\n  }, []);
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LISTAPEDIDOS</span>
          <h1>Separação</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>\n          {user ? (\n            <button className="filter" type="button" onClick={async () => { await logout().catch(() => undefined); window.location.reload(); }} title="Sair">\n              <LogOut size={17} /> Sair\n            </button>\n          ) : (\n            <Link className="filter" href="/login"><LogIn size={17} /> Entrar</Link>\n          )}\n          <div className="brand-mark">LP</div>\n        </div>
      </header>

      <section className="hero-card">
        <div>
          <span className="status-dot" />
          <p className="eyebrow">CENTRAL DE SEPARAÇÃO</p>
          <h2>Transforme sua planilha em uma lista de separação.</h2>
          <p className="muted">Importe o pedido, confira os dados e acompanhe a quantidade separada em tempo real.</p>\n          {user && <p className="muted">Sincronizado na nuvem como <strong>{user.nome || user.email}</strong>.</p>}
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