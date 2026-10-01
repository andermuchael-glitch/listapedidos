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
  // Modelo de orçamento com distribuição por modelo:
  // # | Código | Produto | Qtde.
  // A linha seguinte contém os códigos/modelos (ex.: 1057 127 175...)
  // e a próxima linha contém a quantidade de cada modelo (ex.: 6 6 6...).
  // Para a separação, cada par código + quantidade vira um item independente.
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
    const pageContent = await page.getTextContent();

    const items = (pageContent.items as unknown[])
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
        (currentLine) => Math.abs(currentLine.y - item.y) <= 2
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
  let numero = "";
  let cliente = "";

  const normalizedLines = visualLines.map((line) =>
    line.items.map((item) => item.text).filter(Boolean)
  );

  // Nome Fantasia é a identificação comercial que deve aparecer como cliente.
  for (const parts of normalizedLines) {
    const textLine = parts.join(" ").replace(/\s+/g, " ").trim();
    const fantasiaMatch = textLine.match(/^Nome\s+Fantasia\s*:\s*(.+)$/i);
    if (fantasiaMatch) {
      cliente = fantasiaMatch[1].trim();
      break;
    }
  }

  // Só tratamos "Venda 12345" como número de pedido.
  // "Orçamento Nº ..." não é convertido automaticamente em pedido.
  for (const parts of normalizedLines) {
    const textLine = parts.join(" ").replace(/\s+/g, " ").trim();
    const vendaMatch = textLine.match(/\bVenda\s+(?:N[ºo]\s*)?(\d+)\b/i);
    if (vendaMatch) {
      numero = vendaMatch[1];
      break;
    }
  }

  const isNumberToken = (value: string) => /^\d+$/.test(value.trim());

  // Localiza blocos pela sequência visual:
  // linha do produto -> linha dos códigos/modelos -> linha das quantidades.
  for (let i = 0; i < normalizedLines.length; i++) {
    const parts = normalizedLines[i];
    const textLine = parts.join(" ").replace(/\s+/g, " ").trim();

    if (!textLine) continue;

    // Cabeçalho/fim da tabela.
    if (/^#\s+Código\s+Produto\s+Qtde/i.test(textLine)) continue;
    if (/^Qtde\.\s+Total:/i.test(textLine)) break;
    if (/^Valor\s+total:/i.test(textLine)) break;
    if (/^Condição\s+de\s+Pagamento:/i.test(textLine)) break;
    if (/^Forma\s+de\s+Pagamento:/i.test(textLine)) break;

    // Produto principal: número do item, nome do produto e quantidade total.
    // Ex.: "1 MOEDEIRO 54"
    // O PDF pode trazer preço/subtotal na mesma linha, por exemplo:
    // "1 MOEDEIRO 54 ----- R$ 10,90 R$ 588,60".
    // Por isso capturamos a primeira quantidade numérica depois do nome
    // e não exigimos que ela seja o último token da linha.
    const productMatch = textLine.match(/^(\d+)\s+(.+?)\s+(\d+)(?=\s|$)/);
    if (!productMatch) continue;

    let productName = productMatch[2].trim();
    const totalQuantity = Number(productMatch[3]);

    // Remove separadores comerciais que eventualmente ficaram no nome.
    productName = productName.replace(/[-–—|]+\s*$/, "").trim();

    if (!productName || !Number.isFinite(totalQuantity) || totalQuantity <= 0) {
      continue;
    }

    // As linhas de códigos e quantidades podem ter linhas visuais vazias ou
    // separadores entre elas. Procuramos as duas próximas linhas numéricas.
    let codeLineIndex = -1;
    let quantityLineIndex = -1;

    for (let lookahead = 1; lookahead <= 4; lookahead++) {
      const candidate = normalizedLines[i + lookahead] ?? [];
      const candidateCodes = candidate.filter(isNumberToken);
      if (candidateCodes.length >= 2) {
        codeLineIndex = i + lookahead;
        break;
      }
    }

    if (codeLineIndex < 0) continue;

    for (let lookahead = 1; lookahead <= 4; lookahead++) {
      const candidateIndex = codeLineIndex + lookahead;
      const candidate = normalizedLines[candidateIndex] ?? [];
      const candidateQuantities = candidate
        .filter(isNumberToken)
        .map((value) => Number(value));

      if (
        candidateQuantities.length === normalizedLines[codeLineIndex].filter(isNumberToken).length &&
        candidateQuantities.length >= 2
      ) {
        quantityLineIndex = candidateIndex;
        break;
      }
    }

    if (quantityLineIndex < 0) continue;

    const codeParts = normalizedLines[codeLineIndex] ?? [];
    const quantityParts = normalizedLines[quantityLineIndex] ?? [];

    const codes = codeParts.filter(isNumberToken);
    const quantities = quantityParts
      .filter(isNumberToken)
      .map((value) => Number(value));

    if (!codes.length || codes.length !== quantities.length) continue;

    const distributedTotal = quantities.reduce((sum, value) => sum + value, 0);

    // A distribuição deve bater com a Qtde. do produto.
    // Se houver diferença, ainda usamos os pares encontrados, mas não
    // inventamos quantidade nem agrupamos os modelos.
    if (distributedTotal !== totalQuantity) {
      console.warn(
        "Distribuição diferente do total para " +
          productName +
          ": " +
          distributedTotal +
          " != " +
          totalQuantity
      );
    }

    for (let modelIndex = 0; modelIndex < codes.length; modelIndex++) {
      const quantity = quantities[modelIndex];
      const code = codes[modelIndex];

      if (quantity <= 0) continue;

      rows.push([quantity, code, productName]);
    }

    // Pula até a última linha consumida pelo bloco.
    i = quantityLineIndex;
  }

  if (!rows.length) {
    throw new Error(
      "Não encontrei a distribuição por modelos neste orçamento PDF. O modelo esperado possui produto/quantidade e, logo abaixo, códigos e quantidades de cada modelo."
    );
  }

  return { rows, numero, cliente };
}

function locateMatrixProductTable(matrix: SheetMatrix) {
  // Modelo "matriz de pedidos": produto na primeira coluna, destinos/clientes
  // nas colunas seguintes e uma coluna final "Total". Ex.: Canga | 0 | 100 | ... | 124.
  // Nesse formato não existe uma coluna chamada Quantidade; a quantidade correta
  // para a separação é o valor da coluna Total.
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const totalCol = findColumn(row, ["Total"]);
    if (totalCol <= 0) continue;

    const productCol = 0;
    const headerLooksLikeMatrix =
      totalCol >= 2 &&
      row.slice(1, totalCol).some((value) => cell(value));

    if (!headerLooksLikeMatrix) continue;

    const rows: SheetMatrix = [];
    let itemNumber = 1;

    for (let i = r + 1; i < matrix.length; i++) {
      const line = matrix[i] ?? [];
      const product = cell(line[productCol]);
      const lineText = norm(line.map(cell).join(" "));

      if (!product) continue;
      if (/^(total|subtotal|totais)$/i.test(product) || /^total(?:\\s|$)/i.test(lineText)) break;

      const quantity = numberValue(line[totalCol]);
      if (quantity > 0) {
        rows.push([
          quantity,
          `ITEM-${String(itemNumber).padStart(3, "0")}`,
          product
        ]);
        itemNumber++;
      }
    }

    if (rows.length) {
      return {
        headerRow: r,
        quantityCol: totalCol,
        codeCol: -1,
        productCol,
        rows,
        launchRow: -1
      };
    }
  }

  return null;
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
  const [manualNumero, setManualNumero] = useState("");

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
        // Segundo formato de planilha: matriz com produtos na primeira coluna
        // e uma coluna "Total" no final.
        for (const file of files) {
          if (file.name.toLowerCase().endsWith(".pdf")) continue;
          const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
          for (const sheetName of workbook.SheetNames) {
            const matrix = XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[sheetName], {
              header: 1,
              defval: "",
              raw: true
            });
            const table = locateMatrixProductTable(matrix);
            if (table) {
              allRows.push(...table.rows);
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
        }
      }

      if (!allRows.length) {
        throw new Error("Não encontrei nenhuma tabela de produtos reconhecível. Posso analisar este modelo e adaptar o leitor.");
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
        numero: manualNumero.trim() || preview.numero || "",
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

          {!preview.numero && (
            <div className="notice">
              <strong>Número do pedido</strong>
              <span>Este arquivo não possui um número de pedido identificado. Informe-o manualmente antes de usar a tabela.</span>
              <input
                className="quantity-input"
                style={{ width: "180px", marginTop: "8px", textAlign: "left" }}
                type="text"
                inputMode="numeric"
                value={manualNumero}
                onChange={(e) => setManualNumero(e.target.value)}
                placeholder="Ex.: 11239"
                aria-label="Número do pedido"
              />
            </div>
          )}

          {preview.sheetName === "PDF" && preview.cliente && (
            <div className="notice">
              <strong>Nome fantasia identificado</strong>
              <span>{preview.cliente}</span>
            </div>
          )}

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

          <button className="primary-button full-width" type="button" onClick={createList} disabled={creating || !manualNumero.trim()}>
            {creating ? "Criando lista..." : !manualNumero.trim() ? "Informe o número do pedido" : "Usar esta tabela e criar separação"}
          </button>
        </section>
      )}
    </main>
  );
}
