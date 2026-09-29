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
  numero?: string;
  cliente?: string;
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
  // Orçamentos deste modelo usam colunas:
  // Qt. | Produto/Serviço | Detalhe do item | Valor unitário | Subtotal.
  // Para a separação usamos somente Qt. + Código + Descrição.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");

  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  type PdfTextItem = { str: string; transform: number[] };
  type VisualItem = { text: string; x: number; y: number };
  type VisualLine = { y: number; items: VisualItem[] };

  const visualLines: VisualLine[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

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
      .map((item) => ({
        text: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5]
      }))
      .filter((item) => item.text);

    items.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 2) return b.y - a.y;
      return a.x - b.x;
    });

    for (const item of items) {
      const line = visualLines.find(
        (current) => Math.abs(current.y - item.y) <= 2
      );

      if (line) {
        line.items.push(item);
      } else {
        visualLines.push({ y: item.y, items: [item] });
      }
    }
  }

  visualLines.forEach((line) => line.items.sort((a, b) => a.x - b.x));

  const rows: SheetMatrix = [];
  let current: { q: number; code: string; description: string } | null = null;
  let numero = "";
  let cliente = "";

  const finishCurrent = () => {
    if (!current) return;

    const description = current.description
      .replace(/\s+/g, " ")
      .replace(/^[ -]+|[ -]+$/g, "")
      .trim();

    if (current.q > 0 && description) {
      rows.push([
        current.q,
        current.code || `ITEM-${String(rows.length + 1).padStart(3, "0")}`,
        description
      ]);
    }

    current = null;
  };

  const isMoney = (text: string) =>
    /^-?\d{1,3}(?:[.]\d{3})*,\d{2}$/.test(text) ||
    /^-?\d+,\d{2}$/.test(text);

  const isPageOrFooter = (line: string) =>
    /produto\/servi[cç]o|detalhe do item|valor unit[aá]rio|subtotal/i.test(line) ||
    /continua na pr[oó]xima p[aá]gina|p[aá]gina\s+\d+\s+de\s+\d+/i.test(line) ||
    /^valor l[ií]quido|^total(?:\s|$)|^condi[cç][aã]o de pagamento|^forma de pagamento|^n[ºo]\s+vencimento/i.test(line);

  let productSectionEnded = false;

  for (const line of visualLines) {
    const parts = line.items.map((item) => item.text).filter(Boolean);
    const textLine = parts.join(" ").replace(/\s+/g, " ").trim();

    if (!textLine || productSectionEnded) continue;

    // Metadados do pedido ficam no cabeçalho do PDF.
    const vendaMatch = textLine.match(/\bVenda\s+(\d+)\b/i);
    if (vendaMatch && !numero) numero = vendaMatch[1];

    if (!cliente) {
      // O nome do cliente é a linha que começa com "GIGANTE DA COLINA".
      // Ignoramos telefone, CNPJ e demais dados comerciais do cabeçalho.
      const clienteMatch = textLine.match(/^(GIGANTE DA COLINA(?:\s*-\s*[^0-9]+)?)/i);
      if (clienteMatch) cliente = clienteMatch[1].replace(/\s+/g, " ").trim();
      else if (/^GIGANTE DA COLINA$/i.test(textLine)) cliente = "GIGANTE DA COLINA";
    }

    // Depois de "Total", "Valor líquido" ou "Condição de pagamento",
    // não existem mais produtos. O que vem abaixo são parcelas/pagamento
    // e nunca deve entrar na separação.
    if (/^total(?:\s|$)/i.test(textLine) ||
        /^valor\s+l[ií]quido/i.test(textLine) ||
        /^condi[cç][aã]o\s+de\s+pagamento/i.test(textLine) ||
        /^forma\s+de\s+pagamento/i.test(textLine)) {
      finishCurrent();
      productSectionEnded = true;
      continue;
    }

    if (isPageOrFooter(textLine)) continue;

    // A linha de produto começa com a quantidade na primeira coluna.
    // O restante pode conter duas colunas de texto e, no final, dois valores.
    const first = parts[0];
    const qMatch = first.match(/^(\d+)$/);

    if (qMatch) {
      const q = Number(qMatch[1]);

      if (Number.isFinite(q) && q > 0) {
        finishCurrent();

        const textParts = parts
          .slice(1)
          .filter((part) => !isMoney(part));

        // Neste modelo a primeira coluna textual é "Produto/Serviço",
        // por exemplo: "CTF MOD 27 - VASCO - CARTEIRA".
        // O código é a parte até " - VASCO"; a descrição vem do
        // "Detalhe do item" e, se necessário, do restante da linha.
        const productService = textParts[0] || "";
        const detailParts = textParts.slice(1);

        const codeMatch = productService.match(
          /^([A-Za-z0-9]+(?:\s+MOD\s+\d+)?(?:\s*-\s*[A-Za-z0-9]+)?)\s*-\s*(.+)$/i
        );

        let code = "";
        let shortDescription = productService;

        if (codeMatch) {
          code = codeMatch[1].trim();
          shortDescription = codeMatch[2].trim();
        }

        const detail = detailParts.join(" ").trim();

        // Preferimos o detalhe, pois é a descrição completa do item.
        // Se o PDF não tiver detalhe separado, usamos o texto da coluna
        // Produto/Serviço depois do código.
        const description = detail || shortDescription;

        current = {
          q,
          code,
          description
        };
        continue;
      }
    }

    // Linhas seguintes sem quantidade são continuação da descrição.
    if (current) {
      const continuation = parts
        .filter((part) => !isMoney(part))
        .join(" ")
        .trim();

      if (continuation && !isPageOrFooter(continuation)) {
        current.description += ` ${continuation}`;
      }
    }
  }

  finishCurrent();

  if (!rows.length) {
    throw new Error(
      "Não encontrei produtos no orçamento PDF. O PDF precisa conter quantidade, produto/serviço e descrição."
    );
  }

  return { rows, numero, cliente };
}

function locateProductTables(matrix: SheetMatrix) {
  // Localiza TODAS as tabelas de produtos da aba. Não paramos na primeira.
  // Isso evita perder itens quando uma pasta possui várias abas ou mais de
  // um bloco de lançamento.
  const tables: Array<{
    headerRow: number;
    quantityCol: number;
    codeCol: number;
    productCol: number;
    rows: SheetMatrix;
    launchRow: number;
  }> = [];

  let launchRow = -1;
  for (let r = 0; r < matrix.length; r++) {
    const rowText = (matrix[r] ?? []).map(norm).join(" ");
    if (rowText.includes("lancamento de pedido")) {
      launchRow = r;
      break;
    }
  }

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

    if (quantityCol < 0 || productCol < 0) continue;

    const rows: SheetMatrix = [];
    let itemNumber = 1;
    let emptyRows = 0;

    for (let i = r + 1; i < matrix.length; i++) {
      const line = matrix[i] ?? [];
      const q = numberValue(line[quantityCol]);
      const code = codeCol >= 0 ? cell(line[codeCol]) : "";
      const product = cell(line[productCol]);
      const lineText = norm(line.map(cell).join(" "));

      // Não encerramos ao primeiro espaço vazio. Algumas planilhas deixam
      // linhas em branco entre blocos. Só paramos após várias linhas vazias.
      if (!q && !code && !product) {
        emptyRows++;
        if (rows.length && emptyRows >= 5) break;
        continue;
      }
      emptyRows = 0;

      const isTotal = /(^|\s)(total|subtotal|sub-total|totais)(\s|$)/i.test(lineText);
      if (isTotal) {
        // Um total encerra este bloco, mas não impede a procura de outra tabela.
        break;
      }

      if (q > 0 && product) {
        const validCode = code && !/^#(?:REF|VALUE|N\/A|NAME|DIV\/0|NUM|NULL)!?$/i.test(code) && code !== "-";
        const finalCode = validCode ? code : `ITEM-${String(itemNumber).padStart(3, "0")}`;
        rows.push([q, finalCode, product]);
        itemNumber++;
      }
    }

    if (rows.length) {
      tables.push({ headerRow: r, quantityCol, codeCol, productCol, rows, launchRow });
      // A próxima procura começa depois do bloco encontrado.
      r += rows.length;
    }
  }

  return tables;
}

export default function NovaSeparacaoPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleFiles(fileList?: FileList | null) {
    if (!fileList?.length) return;
    setError("");
    setPreview(null);

    try {
      const files = Array.from(fileList);
      const allRows: SheetMatrix = [];
      let firstSheet = "";
      let firstHeader = -1;
      let firstQuantity = 0;
      let firstCode = 1;
      let firstProduct = 2;
      let firstLaunch = -1;
      let numero = "";
      let cliente = "";
      let pdfOnly = true;
      const sources: string[] = [];

      for (const file of files) {
        const isPdf = file.name.toLowerCase().endsWith(".pdf");
        pdfOnly = pdfOnly && isPdf;

        if (isPdf) {
          const pdfResult = await extractPdfRows(file);
          allRows.push(...pdfResult.rows);
          numero ||= pdfResult.numero;
          cliente ||= pdfResult.cliente;
          sources.push(file.name);
          continue;
        }

        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        let fileFound = 0;

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json<Cell[]>(sheet, {
            header: 1,
            defval: "",
            raw: true
          });

          const tables = locateProductTables(matrix);
          for (const table of tables) {
            allRows.push(...table.rows);
            fileFound += table.rows.length;
            if (!firstSheet) {
              firstSheet = sheetName;
              firstHeader = table.headerRow;
              firstQuantity = table.quantityCol;
              firstCode = table.codeCol;
              firstProduct = table.productCol;
              firstLaunch = table.launchRow;
            }
          }
        }

        if (fileFound) sources.push(`${file.name} (${fileFound} itens)`);
      }

      if (!allRows.length) {
        throw new Error("Não encontrei nenhuma tabela com Quantidade e Descrição do produto.");
      }

      // Remove apenas duplicatas idênticas. Itens com códigos diferentes ou
      // quantidades diferentes continuam sendo preservados.
      const uniqueRows: SheetMatrix = [];
      const seen = new Set<string>();
      for (const row of allRows) {
        const key = [row[0], norm(row[1]), norm(row[2])].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueRows.push(row);
      }

      setSelectedFiles(sources);
      setPreview({
        fileName: files.length === 1 ? files[0].name : `${files.length} arquivos selecionados`,
        numero,
        cliente,
        sheetName: pdfOnly ? "PDF" : (firstSheet || "Várias abas"),
        headerRow: firstHeader,
        quantityCol: firstQuantity,
        codeCol: firstCode,
        productCol: firstProduct,
        launchRow: firstLaunch,
        rows: uniqueRows.slice(0, 8),
        allRows: uniqueRows
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ler os arquivos.");
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
        numero: preview.numero || "",
        cliente: preview.cliente || "",
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
          <input type="file" multiple accept=".xlsx,.xls,.csv,.pdf" onChange={(e) => handleFiles(e.target.files)} />
        </label>
        <small>Você pode selecionar um ou vários arquivos. Formatos: XLSX, XLS, CSV e PDF.</small>
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
              {selectedFiles.length > 0 && selectedFiles.length <= 6
                ? `Fontes: ${selectedFiles.join(" · ")} · `
                : ""}
              {preview.sheetName === "PDF"
                ? `Orçamento PDF · ${preview.allRows.length} produtos encontrados`
                : `Todas as abas/blocos encontrados · ${preview.allRows.length} produtos`}
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
