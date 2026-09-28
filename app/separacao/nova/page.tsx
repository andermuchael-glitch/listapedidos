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
  allRows: SheetRow[];
  totalRows: number;
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").replace(/\./g, "").replace(",", ".");
  const number = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function findHeaderIndex(headers: unknown[], terms: string[]) {
  return headers.findIndex((header) => terms.includes(normalize(header)));
}

function readProductTable(sheet: XLSX.WorkSheet) {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true
  });

  let headerRowIndex = -1;
  let quantityIndex = -1;
  let codeIndex = -1;
  let descriptionIndex = -1;

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const q = findHeaderIndex(row, ["quantidade"]);
    const c = findHeaderIndex(row, ["codigo"]);
    const d = findHeaderIndex(row, ["descricao do produto", "descricao"]);

    if (q >= 0 && c >= 0 && d >= 0) {
      headerRowIndex = i;
      quantityIndex = q;
      codeIndex = c;
      descriptionIndex = d;
      break;
    }
  }

  if (headerRowIndex < 0) {
    throw new Error("Não encontrei a tabela com as colunas Quantidade, Código e Descrição do produto.");
  }

  const rows: SheetRow[] = [];

  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const quantity = row[quantityIndex];
    const code = String(row[codeIndex] ?? "").trim();
    const description = String(row[descriptionIndex] ?? "").trim();

    // A tabela de separação é formada pelas linhas que possuem
    // quantidade, código e descrição. Ignoramos títulos/rodapés
    // e qualquer conteúdo que esteja fora dessa tabela.
    if (!code && !description && String(quantity ?? "").trim() === "") {
      if (rows.length > 0) break;
      continue;
    }

    const numericQuantity = toNumber(quantity);
    if (!code || !description || numericQuantity <= 0) {
      if (rows.length > 0) continue;
      continue;
    }

    rows.push({
      Quantidade: numericQuantity,
      Código: code,
      "Descrição do produto": description
    });
  }

  if (!rows.length) {
    throw new Error("A tabela foi encontrada, mas não há produtos válidos para separar.");
  }

  return rows;
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
      const allRows = readProductTable(firstSheet);

      setPreview({
        fileName: file.name,
        headers: ["Quantidade", "Código", "Descrição do produto"],
        rows: allRows.slice(0, 8),
        allRows,
        totalRows: allRows.length
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível ler a planilha. Verifique o arquivo e tente novamente."
      );
    }
  }

  function createList() {
    if (!preview) return;
    setCreating(true);

    const items = preview.allRows.map((row, index) => ({
      id: String(index + 1),
      codigo: String(row["Código"] ?? ""),
      descricao: String(row["Descrição do produto"] ?? ""),
      quantidade: toNumber(row["Quantidade"]),
      separado: 0
    }));

    const data = {
      id: `sep-${Date.now()}`,
      fileName: preview.fileName,
      numero: "",
      cliente: "",
      items,
      totalRows: preview.allRows.length,
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
        <p className="muted">O aplicativo procura a tabela de produtos e lê somente as colunas Quantidade, Código e Descrição do produto.</p>

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
            <span>{preview.totalRows} produtos encontrados</span>
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
            <strong>Tabela identificada corretamente</strong>
            <span>Serão importados todos os {preview.totalRows} produtos da tabela, não apenas os itens exibidos na prévia.</span>
          </div>

          <button className="primary-button full-width" type="button" onClick={createList} disabled={creating}>
            {creating ? "Criando lista..." : "Criar lista de separação"}
          </button>
        </section>
      )}
    </main>
  );
}
