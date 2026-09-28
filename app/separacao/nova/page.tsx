"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import * as XLSX from "xlsx";

type Preview = {
  fileName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
};

export default function NovaSeparacaoPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");

  async function handleFile(file?: File) {
    if (!file) return;
    setError("");
    setPreview(null);

    const valid = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!valid) {
      setError("Selecione uma planilha XLSX, XLS ou CSV.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
      const headers = rows.length ? Object.keys(rows[0]) : XLSX.utils.sheet_to_json(firstSheet, { header: 1 })[0]?.map(String) ?? [];

      if (!rows.length) {
        setError("A planilha não possui linhas de dados.");
        return;
      }

      setPreview({ fileName: file.name, headers, rows: rows.slice(0, 5), totalRows: rows.length });
    } catch {
      setError("Não foi possível ler a planilha. Verifique o arquivo e tente novamente.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <Link className="back-link" href="/separacao">← Voltar</Link>
          <h1>Nova separação</h1>
        </div>
        <FileSpreadsheet size={26} />
      </header>

      <section className="import-card">
        <div className="upload-icon"><Upload size={30} /></div>
        <p className="eyebrow">ETAPA 1</p>
        <h2>Importe a planilha do pedido</h2>
        <p className="muted">O arquivo será lido pelo aplicativo e os dados serão apresentados para conferência antes de criar a lista.</p>

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
            <strong>Próxima etapa</strong>
            <span>Após a conferência, vamos identificar pedido, cliente, produtos e quantidades para criar a lista de separação.</span>
          </div>

          <button className="primary-button full-width" type="button" disabled>
            Criar lista de separação — próxima etapa
          </button>
        </section>
      )}
    </main>
  );
}