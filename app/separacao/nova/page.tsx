"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import * as XLSX from "xlsx";

type SheetRow = Record<string, unknown>;
type Preview = {
  fileName: string;
  headers: string[];
  rows: SheetRow[];
  totalRows: number;
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

function findColumn(headers: string[], terms: string[]) {
  return headers.find((header) => terms.some((term) => normalize(header).includes(normalize(term))));
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").replace(/\./g, "").replace(",", ".");
  const number = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

export default function NovaSeparacaoPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleFile(file?: File) {
    if (!file) return;
    setError("");
    setPreview(null);

    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError("Selecione uma planilha XLSX, XLS ou CSV.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<SheetRow>(firstSheet, { defval: "" });
      if (!rows.length) {
        setError("A planilha não possui linhas de dados.");
        return;
      }

      const headers = Object.keys(rows[0]);
      setPreview({ fileName: file.name, headers, rows: rows.slice(0, 8), totalRows: rows.length });
    } catch {
      setError("Não foi possível ler a planilha. Verifique o arquivo e tente novamente.");
    }
  }

  function createList() {
    if (!preview) return;
    setCreating(true);

    const codigo = findColumn(preview.headers, ["codigo", "cod", "sku", "ref"]);
    const descricao = findColumn(preview.headers, ["descricao", "produto", "item", "nome"]);
    const quantidade = findColumn(preview.headers, ["quantidade", "qtd", "qtde", "quant"]);
    const pedido = findColumn(preview.headers, ["venda", "pedido", "ordem"]);
    const cliente = findColumn(preview.headers, ["cliente", "razao", "destinatario"]);

    const items = preview.rows.map((row, index) => ({
      id: String(index + 1),
      codigo: codigo ? String(row[codigo] ?? "") : "",
      descricao: descricao ? String(row[descricao] ?? "") : "",
      quantidade: quantidade ? toNumber(row[quantidade]) : 0,
      separado: 0
    }));

    const totalRows = preview.totalRows;
    const data = {
      id: `sep-${Date.now()}`,
      fileName: preview.fileName,
      numero: pedido ? String(preview.rows[0]?.[pedido] ?? "") : "",
      cliente: cliente ? String(preview.rows[0]?.[cliente] ?? "") : "",
      items,
      totalRows,
      createdAt: new Date().toISOString()
    };

    localStorage.setItem("listapedidos:separacao-atual", JSON.stringify(data));
    setTimeout(() => {
      window.location.href = "/listapedidos/separacao/atual/";
    }, 100);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <Link className="back-link" href="/separacao/">← Voltar</Link>
          <h1>Nova separação</h1>
        </div>
        <FileSpreadsheet size={26} />
      </header>

      <section className="import-card">
        <div className="upload-icon"><Upload size={30} /></div>
        <p className="eyebrow">ETAPA 1</p>
        <h2>Importe a planilha do pedido</h2>
        <p className="muted">O aplicativo lê a primeira aba e prepara os dados para conferência. A planilha original nunca é alterada.</p>

        <label className="upload-button">
          <FileSpreadsheet size={20} />
          Selecionar planilha
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
        <small>Formatos aceitos: XLSX, XLS e CSV</small>

        {error && <div className="error-box">{error}</div>}
      </section>

      {preview && (
        <section className="preview-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ETAPA 2</p>
              <h2>Conferir arquivo</h2>
            </div>
            <CheckCircle2 className="success-icon" />
          </div>

          <div className="file-summary">
            <strong>{preview.fileName}</strong>
            <span>{preview.totalRows} linhas encontradas</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={index}>{preview.headers.map((header) => <td key={header}>{String(row[header] ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="notice">
            <strong>Pronto para criar a lista</strong>
            <span>O sistema tentará identificar automaticamente código, produto, quantidade, pedido e cliente.</span>
          </div>

          <button className="primary-button full-width" type="button" onClick={createList} disabled={creating}>
            {creating ? "Criando lista..." : "Criar lista de separação"}
          </button>
        </section>
      )}
    </main>
  );
}
