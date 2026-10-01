"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { getCurrentUser, login, register } from "../../lib/api";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then((result) => {
        if (result.authenticated) window.location.href = "/listapedidos/";
      })
      .catch(() => {
        // Usuário não autenticado.
      });
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        if (!nome.trim()) throw new Error("Informe seu nome.");
        await register(nome.trim(), email.trim(), senha);
      } else {
        await login(email.trim(), senha);
      }

      window.location.href = "/listapedidos/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível acessar a conta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <Link className="back-link" href="/">← Voltar</Link>
          <p className="eyebrow">LISTAPEDIDOS</p>
          <h1>{mode === "login" ? "Entrar" : "Criar conta"}</h1>
        </div>
        {mode === "login" ? <LogIn size={26} /> : <UserPlus size={26} />}
      </header>

      <section className="import-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DADOS NA NUVEM</p>
            <h2>{mode === "login" ? "Acesse seus pedidos" : "Crie seu acesso"}</h2>
          </div>
        </div>

        <p className="muted">
          Seus pedidos e o progresso da separação serão salvos no banco de dados para
          você continuar em outro navegador ou dispositivo.
        </p>

        <form onSubmit={submit} style={{ display: "grid", gap: "12px", marginTop: "18px" }}>
          {mode === "register" && (
            <label>
              <span className="eyebrow">NOME</span>
              <input
                className="quantity-input"
                style={{ width: "100%", textAlign: "left" }}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Seu nome"
                autoComplete="name"
              />
            </label>
          )}

          <label>
            <span className="eyebrow">E-MAIL</span>
            <input
              className="quantity-input"
              style={{ width: "100%", textAlign: "left" }}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@exemplo.com"
              autoComplete="email"
              required
            />
          </label>

          <label>
            <span className="eyebrow">SENHA</span>
            <input
              className="quantity-input"
              style={{ width: "100%", textAlign: "left" }}
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Mínimo de 8 caracteres"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </label>

          {error && <div className="error-box">{error}</div>}

          <button className="primary-button full-width" type="submit" disabled={loading}>
            {loading
              ? "Aguarde..."
              : mode === "login"
                ? "Entrar e sincronizar"
                : "Criar conta e sincronizar"}
          </button>
        </form>

        <button
          className="secondary-button full-width"
          type="button"
          style={{ marginTop: "12px" }}
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Ainda não tenho conta" : "Já tenho uma conta"}
        </button>
      </section>
    </main>
  );
}
