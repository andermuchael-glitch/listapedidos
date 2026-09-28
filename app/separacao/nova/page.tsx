"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, FileSpreadsheet, FileText, Upload } from "lucide-react";
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
  launchRow: number;
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
  return row.findIndex((v) => {
    const value = norm(v);
    if (!value) return false;
    return names.some((name) => {
      const target = norm(name);
      return value === target || value.includes(target) || target.includes(value);
    });
  });
}

async function extractPdfRows(file: File) {
  // PDFs de orçamento têm uma estrutura diferente das planilhas:
  // Quantidade + Valor unitário + Subtotal + Código/Descrição.
  // Para a separação, somente Quantidade + Código + Descrição são aproveitados.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  const buffer = await file.arrayBuffer();
  const pdf = await (pdfjs.getDocument as unknown as (options: { data: Uint8Array; disableWorker?: boolean }) => { promise: Promise<any> })({
    data: new Uint8Array(buffer),
    disableWorker: true
  }).promise;

  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    type PdfTextItem = { str: string; transform: number[] };

    const items = (content.items as unknown[])
      .filter((item): item is PdfTextItem => {
        if (typeof item !== "object" || item === null) return false;
        const candidate = item as { str?: unknown; transform?: unknown };
        return (
          typeof candidate.str === "string" &&
          Array.isArray(candidate.transform) &&
          candidate.transform.length >= 6 &&
          candidate.transform.every((value) => typeof value === "number")
        );
      })
      .map((item: PdfTextItem) => ({
        text: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5]
      }))
      .filter((item: { text: string }) => item.text);

    items.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 2) return b.y - a.y;
      return a.x - b.x;
    });

    const pageLines: { y: number; text: string }[] = [];
    for (const item of items) {
      const line = pageLines.find((current) => Math.abs(current.y - item.y) <= 2);
      if (line) {
        line.text += (line.text.endsWith(" ") ? "" : " ") + item.text;
      } else {
        pageLines.push({ y: item.y, text: item.text });
      }
    }

    pageLines
      .sort((a, b) => b.y - a.y)
      .forEach((line) => lines.push(line.text.replace(/\s+/g, " ").trim()));

    lines.push("__PAGE_BREAK__");
  }

  const rows: SheetMatrix = [];
  let current: { q: number; code: string; description: string } | null = null;

  const ignored = (line: string) =>
    !line ||
    line === "__PAGE_BREAK__" ||
    /produto\/servico|produto\/servi[cç]o|detalhe do item|valor unit[aá]rio|subtotal/i.test(line) ||
    /continua na pr[oó]xima p[aá]gina|p[aá]gina \d+ de \d+/i.test(line);

  const addCurrent = () => {
    if (!current) return;
    const description = current.description.replace(/\s+/g, " ").trim();
    if (current.q > 0 && description) {
      rows.push([current.q, current.code || `ITEM-${String(rows.length + 1).padStart(3, "0")}`, description]);
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (ignored(line)) continue;

    // Formato comum dos orçamentos: 4 48,90 195,60BP MOD 27 - VASCO - BOLSA
    const itemMatch = line.match(/^(\d+)\s+[\d.,]+\s+[\d.,]+\s*(.+)$/);
    if (itemMatch) {
      addCurrent();

      const q = Number(itemMatch[1]);
      const rest = itemMatch[2].trim();
      const codeMatch = rest.match(/^([A-Za-z0-9]+(?:\s+MOD\s+\d+)?)\s*-\s*(.+)$/i);

      if (Number.isFinite(q) && q > 0) {
        current = {
          q,
          code: codeMatch ? codeMatch[1].trim() : "",
          description: codeMatch ? codeMatch[2].trim() : rest
        };
      }
      continue;
    }

    if (/^valor l[ií]quido|^total(?:\s|$)|^condi[cç][aã]o de pagamento|^forma de pagamento|^n[ºo]\s+vencimento/i.test(line)) {
      addCurrent();
      continue;
    }

    // As descrições podem continuar na linha seguinte.
    if (current) {
      current.description += ` ${line}`;
    }
  }

  addCurrent();

  if (!rows.length) {
    throw new Error("Não encontrei produtos no orçamento PDF. O PDF precisa conter quantidade e descrição dos produtos.");
  }

  return rows;
}

function locateProductTable(matrix: SheetMatrix) {
  // A separação usa somente: QUANTIDADE, CÓDIGO e DESCRIÇÃO.
  // Valores, subtotais, totais e demais informações comerciais são ignorados.
  let launchRow = -1;

  for (let r = 0; r < matrix.length; r++) {
    const rowText = (matrix[r] ?? []).map(norm).join(" ");
    if (rowText.includes("lancamento de pedido")) {
      launchRow = r;
      break;
    }
  }

  // Se houver "LANÇAMENTO DE PEDIDO", ignoramos tudo que estiver acima.
  const firstRow = launchRow >= 0 ? launchRow + 1 : 0;

  for (let r = firstRow; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const quantityCol = findColumn(row, ["Quantidade", "Quant", "Qtd", "Qtde"]);
    const codeCol = findColumn(row, ["Código", "Codigo", "Cod", "SKU", "Referência", "Referencia"]);
    const productCol = findColumn(row, [
      "Descrição do produto",
      "Descricao do produto",
      "Produto",
      "Descrição",
      "Descricao",
      "Produto/Descrição"
    ]);

    // Código é opcional: algumas planilhas possuem apenas Quant + Descrição.
    if (quantityCol >= 0 && productCol >= 0) {
      const rows: SheetMatrix = [];
      let itemNumber = 1;

      for (let i = r + 1; i < matrix.length; i++) {
        const line = matrix[i] ?? [];
        const q = numberValue(line[quantityCol]);
        const code = codeCol >= 0 ? cell(line[codeCol]) : "";
        const product = cell(line[productCol]);
        const lineText = norm(line.map(cell).join(" "));

        // Linhas vazias encerram a tabela depois que já encontramos itens.
        if (!q && !code && !product) {
          if (rows.length) break;
          continue;
        }

        // Totais/subtotais nunca entram na separação.
        const isTotal = /(^|\s)(total|subtotal|sub-total|totais)(\s|$)/i.test(lineText);
        if (isTotal) continue;

        // Só entram produtos com quantidade e descrição.
        if (q > 0 && product) {
          const finalCode = code || `ITEM-${String(itemNumber).padStart(3, "0")}`;
          rows.push([q, finalCode, product]);
          itemNumber++;
        }
      }

      if (rows.length) {
        return {
          headerRow: r,
          quantityCol,
          codeCol,
          productCol,
          rows,
          launchRow
        };
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
      const isPdf = file.name.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        const rows = await extractPdfRows(file);
        setPreview({
          fileName: file.name,
          sheetName: "PDF",
          headerRow: -1,
          quantityCol: 0,
          codeCol: 1,
          productCol: 2,
          launchRow: -1,
          rows: rows.slice(0, 8),
          allRows: rows
        });
        return;
      }

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
        throw new Error("Não encontrei uma tabela com Quantidade e Descrição do produto.");
      }

      setPreview({
        fileName: file.name,
        sheetName: foundSheet,
        headerRow: found.headerRow,
        quantityCol: found.quantityCol,
        codeCol: found.codeCol,
        productCol: found.productCol,
        launchRow: found.launchRow,
        rows: found.rows.slice(0, 8),
        allRows: found.rows
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
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

    // Arquiva automaticamente a separação anterior antes de abrir uma nova.
    const previousRaw = localStorage.getItem("listapedidos:separacao-atual");
    if (previousRaw) {
      try {
        const previous = JSON.parse(previousRaw);
        const history = JSON.parse(localStorage.getItem("listapedidos:historico") || "[]");
        const withoutSameId = history.filter((entry: { id?: string }) => entry.id !== previous.id);
        withoutSameId.unshift({
          ...previous,
          status: previous.status || "em_andamento",
          archivedAt: new Date().toISOString()
        });
        localStorage.setItem("listapedidos:historico", JSON.stringify(withoutSameId.slice(0, 100)));
      } catch {
        // Não impede a criação da nova separação.
      }
    }

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
        <h2>Selecione a planilha ou orçamento</h2>
        <p className="muted">
          O arquivo pode ser uma planilha ou um orçamento em PDF. O ListaPedidos usa somente
          <strong> Quantidade, Código e Descrição</strong>. Valores, subtotais e totais são ignorados.
        </p>

        <label className="upload-button">
          {preview?.fileName.toLowerCase().endsWith(".pdf") ? <FileText size={20} /> : <FileSpreadsheet size={20} />}
          Selecionar arquivo
          <input type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
        <small>Formatos aceitos: XLSX, XLS, CSV e PDF (orçamento)</small>
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
            <span>
              {preview.sheetName === "PDF"
                ? `Orçamento PDF · ${preview.allRows.length} produtos encontrados`
                : `Aba: ${preview.sheetName} · Área: LANÇAMENTO DE PEDIDO · Cabeçalho: linha ${preview.headerRow + 1} · ${preview.allRows.length} produtos`}
            </span>
          </div>

          <div className="notice">
            <strong>Somente esta tabela será usada</strong>
            <span>
              Quantidade → coluna {preview.quantityCol + 1} · Código → {preview.codeCol >= 0 ? `coluna ${preview.codeCol + 1}` : "gerado automaticamente"} ·
              Descrição → coluna {preview.productCol + 1}
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
              A prévia mostra os primeiros {preview.rows.length} itens, mas a separação usará todos os {preview.allRows.length} produtos. Valores, subtotais e totais da planilha não são importados.
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
