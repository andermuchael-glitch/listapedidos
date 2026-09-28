"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import * as XLSX from "xlsx";

type Cell = string | number | boolean;
type SheetMatrix = Cell[][];
type Preview = {
  fileName: string;
  sheetName: string;
  headerRow: number;
  quantityCol: number;
  codeCol: number;
  productCol: number;
  rows: SheetMatrix;
  allRows: SheetMatrix;
};

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const cell = (v: unknown) => String(v ?? "").trim();

function numberValue(v: unknown) {
  if (typeof v === "number") return v;
  const s = cell(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findColumn(row: Cell[], names: string[]) {
  return row.findIndex((v) => names.some((name) => norm(v) === norm(name)));
}

function locateProductTable(matrix: SheetMatrix) {
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const quantityCol = findColumn(row, ["Quantidade", "Qtd", "Qtde"]);
    const codeCol = findColumn(row, ["Código", "Codigo", "Cod", "SKU", "Referência", "Referencia"]);
    const productCol = findColumn(row, [
      "Descrição do produto",
      "Descricao do produto",
      "Produto",
      "Descrição",
      "Descricao"
    ]);

    if (quantityCol >= 0 && codeCol >= 0 && productCol >= 0) {
      const rows: SheetMatrix = [];
      for (let i = r + 1; i < matrix.length; i++) {
        const line = matrix[i] ?? [];
        const q = numberValue(line[quantityCol]);
        const code = cell(line[codeCol]);
        const product = cell(line[productCol]);

        if (!q && !code && !product) {
          if (rows.length) break;
          continue;
        }

        if (q > 0 && code && product) {
          rows.push([q, code, product]);
        }
      }

      if (rows.length) {
        return { headerRow: r, quantityCol, codeCol, productCol, rows };
      }
    }
  }

  return null;
}

export default function NovaSeparacaoPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleFile(file?: File) {
    if (!file) return;
    setError("");
    setPreview(null);

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      let found: ReturnType<typeof locateProductTable> = null;
      let foundSheet = "";

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const matrix = XLSX.utils.sheet_to_json<Cell[]>(sheet, {
          header: 1,
          defval: "",
          raw: true
        });
        found = locateProductTable(matrix);
        if (found) {
          foundSheet = sheetName;
          break;
        }
      }

      if (!found) {
        throw new Error("Não encontrei uma tabela com Quantidade, Código e Produto/Descrição do produto.");
      }

      setPreview({
        fileName: file.name,
        sheetName: foundSheet,
        headerRow: found.headerRow,
        quantityCol: found.quantityCol,
        codeCol: found.codeCol,
        productCol: found.productCol,
        rows: found.rows.slice(0, 8),
        allRows: found.rows
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
    }
  }

  function createList() {
    if (!preview) return;
    setCreating(true);

    const items = preview.allRows.map((row, index) => ({
      id: String(index + 1),
      codigo: cell(row[1]),
      descricao: cell(row[2]),
      quantidade: numberValue(row[0]),
      separado: 0
    }));

    localStorage.setItem(
      "listapedidos:separacao-atual",
      JSON.stringify({
        id: `sep-${Date.now()}`,
        fileName: preview.fileName,
        sheetName: preview.sheetName,
        numero: "",
        cliente: "",
        items,
        totalRows: items.length,
        createdAt: new Date().toISOString()
      })
    );

    window.location.href = "/listapedidos/separacao/atual/";
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
        <h2>Selecione a planilha</h2>
        <p className="muted">
          A planilha pode ter várias informações. O ListaPedidos vai procurar a tabela que contém
          <strong> Quantidade, Código e Produto/Descrição do produto</strong> e usar somente essa parte.
        </p>

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
              <p className="eyebrow">ETAPA 2 — ÁREA SELECIONADA</p>
              <h2>Confira a tabela que será usada</h2>
            </div>
            <CheckCircle2 className="success-icon" />
          </div>

          <div className="file-summary">
            <strong>{preview.fileName}</strong>
            <span>Aba: {preview.sheetName} · Linha do cabeçalho: {preview.headerRow + 1} · {preview.allRows.length} produtos</span>
          </div>

          <div className="notice">
            <strong>Somente esta tabela será usada</strong>
            <span>
              Quantidade → coluna {preview.quantityCol + 1} · Código → coluna {preview.codeCol + 1} ·
              Produto/Descrição → coluna {preview.productCol + 1}
            </span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Quantidade</th><th>Código</th><th>Descrição do produto</th></tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{cell(row[0])}</td>
                    <td>{cell(row[1])}</td>
                    <td>{cell(row[2])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="notice">
            <strong>Pronto para importar</strong>
            <span>
              A prévia mostra os primeiros {preview.rows.length} itens, mas a separação usará todos os {preview.allRows.length} itens encontrados nessa tabela.
            </span>
          </div>

          <button className="primary-button full-width" type="button" onClick={createList} disabled={creating}>
            {creating ? "Criando lista..." : "Usar esta tabela e criar separação"}
          </button>
        </section>
      )}
    </main>
  );
}
