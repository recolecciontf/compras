import JSZip from "jszip";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { MaterialItem, PurchaseForm } from "../types";
import { PRODUCT_CATALOG, emptyMaterial, materialSummary } from "./catalog";

type BuyerCompany = PurchaseForm["contractDetails"]["buyerCompany"];

type ExtractedDocument = {
  text: string;
  tables: string[][][];
  usedOcr?: boolean;
};

export type ContractImportProgress = {
  message: string;
  progress: number;
};

export type ContractImportReport = {
  purchase: PurchaseForm;
  detectedFields: string[];
  warnings: string[];
  detectedBuyerCompany: BuyerCompany;
  usedOcr: boolean;
};

type OcrLoggerMessage = {
  status?: string;
  progress?: number;
};

type OcrWorker = {
  recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  setParameters: (parameters: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

type TesseractBrowserApi = {
  createWorker: (languages: string, oem: number, options: {
    workerPath: string;
    logger: (message: OcrLoggerMessage) => void;
  }) => Promise<OcrWorker>;
  PSM: { AUTO: string };
};

declare global {
  interface Window {
    Tesseract?: TesseractBrowserApi;
  }
}

let tesseractScriptPromise: Promise<TesseractBrowserApi> | null = null;

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const SPECIES_ALIASES: Array<[string, string[]]> = [
  ["Limón", ["limon", "limones"]],
  ["Lima", ["lima", "limas"]],
  ["Naranja", ["naranja", "naranjas"]],
  ["Clementina", ["clementina", "clementinas"]],
  ["Mandarina", ["mandarina", "mandarinas"]],
  ["Pomelo", ["pomelo", "pomelos"]],
  ["Granada", ["granada", "granadas"]],
  ["Uva", ["uva", "uvas"]],
  ["Paraguayo", ["paraguayo", "paraguayos"]],
  ["Nectarina", ["nectarina", "nectarinas"]],
  ["Melocotón", ["melocoton", "melocotones"]],
  ["Albaricoque", ["albaricoque", "albaricoques"]],
  ["Kumquat", ["kumquat", "kumquats"]],
  ["Caviar cítrico", ["caviar citrico"]],
];

const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function clean(value = "") {
  return value
    .replace(/[□☐☑✓]/g, " ")
    .replace(/_{2,}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .trim();
}

function cleanTaxId(value = "") {
  return value.toLocaleUpperCase("es").replace(/[^A-Z0-9-]/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

function isoDate(day: string, month: string, year: string) {
  const numericMonth = /^\d+$/.test(month) ? Number(month) : SPANISH_MONTHS[fold(month)];
  if (!numericMonth) return "";
  const numericDay = Number(day);
  const numericYear = Number(year.length === 2 ? `20${year}` : year);
  if (!numericDay || !numericYear) return "";
  return `${numericYear}-${String(numericMonth).padStart(2, "0")}-${String(numericDay).padStart(2, "0")}`;
}

function extractDates(value: string) {
  const dates: string[] = [];
  const numeric = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;
  for (const match of value.matchAll(numeric)) {
    const date = isoDate(match[1], match[2], match[3]);
    if (date) dates.push(date);
  }
  return dates;
}

function spanishNumber(value: string, kilograms = false) {
  let normalized = value.replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!normalized) return "";
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (kilograms && /^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function textFromElement(element: Element) {
  return Array.from(element.getElementsByTagName("w:t"))
    .map((node) => node.textContent || "")
    .join("")
    .trim();
}

async function extractDocx(file: File): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentParts = Object.values(zip.files)
    // Algunos contratos guardan datos en encabezados, pies, notas o cuadros de
    // texto. Leer todas estas partes evita que un Word importado pierda campos.
    .filter((entry) => /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const paragraphs: string[] = [];
  const tables: string[][][] = [];
  for (const part of documentParts) {
    const xml = await part.async("string");
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    if (parsed.querySelector("parsererror")) throw new Error("El archivo Word no tiene una estructura válida.");
    Array.from(parsed.getElementsByTagName("w:p")).forEach((paragraph) => {
      const value = textFromElement(paragraph);
      if (value) paragraphs.push(value);
    });
    Array.from(parsed.getElementsByTagName("w:tbl")).forEach((table) => {
      const rows = Array.from(table.getElementsByTagName("w:tr")).map((row) =>
        Array.from(row.getElementsByTagName("w:tc")).map((cell) => textFromElement(cell)),
      );
      if (rows.length) tables.push(rows);
    });
  }
  return { text: paragraphs.join("\n"), tables };
}

function publicAssetUrl(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}${path.replace(/^\//, "")}`;
}

function loadTesseractBrowser() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractScriptPromise) return tesseractScriptPromise;
  tesseractScriptPromise = new Promise<TesseractBrowserApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-contract-ocr="tesseract"]');
    existing?.remove();
    const script = document.createElement("script");
    const finish = () => window.Tesseract
      ? resolve(window.Tesseract)
      : reject(new Error("No se ha podido iniciar el lector OCR."));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("No se ha podido cargar el lector OCR.")), { once: true });
    script.src = publicAssetUrl("vendor/tesseract-7.0.0.min.js");
    script.async = true;
    script.dataset.contractOcr = "tesseract";
    document.head.appendChild(script);
  }).catch((error) => {
    tesseractScriptPromise = null;
    throw error;
  });
  return tesseractScriptPromise;
}

function ocrStatus(status = "") {
  const normalized = status.toLowerCase();
  if (normalized.includes("language")) return "Cargando el idioma español para el OCR";
  if (normalized.includes("core")) return "Preparando el motor OCR";
  if (normalized.includes("initializ")) return "Inicializando el lector OCR";
  if (normalized.includes("recogniz")) return "Leyendo el contrato escaneado";
  return "Preparando la lectura del contrato escaneado";
}

async function ocrPdfPages(
  pdf: PDFDocumentProxy,
  pageTexts: string[],
  sparsePageNumbers: number[],
  onProgress?: (progress: ContractImportProgress) => void,
) {
  onProgress?.({ message: "El PDF está escaneado. Iniciando OCR…", progress: 0.01 });
  const tesseract = await loadTesseractBrowser();
  let activePage = 0;
  let worker: OcrWorker | null = null;
  try {
    worker = await tesseract.createWorker("spa", 1, {
      workerPath: publicAssetUrl("vendor/tesseract-worker-7.0.0.min.js"),
      logger: (message) => {
        const pageProgress = Math.max(0, Math.min(1, message.progress || 0));
        const overallProgress = activePage
          ? 0.08 + (((activePage - 1) + pageProgress) / sparsePageNumbers.length) * 0.9
          : Math.min(0.08, pageProgress * 0.08);
        onProgress?.({
          message: activePage
            ? `${ocrStatus(message.status)} · página ${sparsePageNumbers[activePage - 1]} de ${pdf.numPages}`
            : ocrStatus(message.status),
          progress: overallProgress,
        });
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM.AUTO,
      preserve_interword_spaces: "1",
      user_defined_dpi: "220",
    });
    for (let index = 0; index < sparsePageNumbers.length; index += 1) {
      activePage = index + 1;
      const pageNumber = sparsePageNumbers[index];
      onProgress?.({
        message: `Preparando página ${pageNumber} de ${pdf.numPages}`,
        progress: 0.08 + (index / sparsePageNumbers.length) * 0.9,
      });
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2.8, Math.max(1.8, 1800 / baseViewport.width));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("El dispositivo no ha podido preparar la página para OCR.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      const selectableText = pageTexts[pageNumber - 1].trim();
      const recognizedText = result.data.text.trim();
      // Los PDF híbridos pueden contener solo una parte del texto seleccionable
      // y el resto como imagen. Se conservan ambos resultados.
      pageTexts[pageNumber - 1] = [selectableText, recognizedText].filter(Boolean).join("\n");
      page.cleanup();
      canvas.width = 1;
      canvas.height = 1;
    }
    onProgress?.({ message: "OCR completado. Identificando los datos…", progress: 0.99 });
  } catch (error) {
    if (error instanceof Error && /dispositivo no ha podido/i.test(error.message)) throw error;
    throw new Error("No se ha podido completar el OCR. Comprueba la conexión e inténtalo de nuevo.");
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
}

async function extractPdf(
  file: File,
  onProgress?: (progress: ContractImportProgress) => void,
): Promise<ExtractedDocument> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  const tables: string[][][] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lineMap = new Map<number, Array<{ x: number; value: string }>>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim() || !("transform" in item)) continue;
        const y = Math.round(item.transform[5] / 2) * 2;
        const line = lineMap.get(y) || [];
        line.push({ x: item.transform[4], value: item.str.trim() });
        lineMap.set(y, line);
      }
      const positionedLines = [...lineMap.entries()]
        .sort((left, right) => right[0] - left[0])
        .map(([y, items]) => ({ y, items: items.sort((left, right) => left.x - right.x) }));
      const lines = positionedLines.map(({ items }) => items.map((item) => item.value).join(" "));
      positionedLines.forEach((headerLine, headerIndex) => {
        const headerText = fold(headerLine.items.map((item) => item.value).join(" "));
        const isParcelHeader = headerText.includes("variedad") && headerText.includes("paraje") && headerText.includes("parcela") && headerText.includes("kg");
        const isCutsHeader = headerText.includes("cortes") && headerText.includes("inicio") && (headerText.includes("terminacion") || headerText.includes("finalizacion"));
        if (!isParcelHeader && !isCutsHeader) return;
        const headerItems = headerLine.items.filter((item) => item.value.trim());
        if (headerItems.length < 3) return;
        const rows: string[][] = [headerItems.map((item) => item.value)];
        const columnStarts = headerItems.map((item) => item.x);
        for (const line of positionedLines.slice(headerIndex + 1)) {
          const lineText = fold(line.items.map((item) => item.value).join(" "));
          if (headerLine.y - line.y > (isParcelHeader ? 150 : 125)) break;
          if (/identificacion exacta|se minoran|se minorara|precio|recoleccion modalidad/.test(lineText)) break;
          const cells = Array.from({ length: columnStarts.length }, () => "");
          for (const item of line.items) {
            let column = 0;
            for (let index = 1; index < columnStarts.length; index += 1) {
              const boundary = (columnStarts[index - 1] + columnStarts[index]) / 2;
              if (item.x >= boundary) column = index;
            }
            cells[column] = clean(`${cells[column]} ${item.value}`);
          }
          if (!cells.some(Boolean)) continue;
          const startsNewRow = Boolean(cells[0]) || Boolean(cells[cells.length - 1]) || rows.length === 1;
          if (startsNewRow) rows.push(cells);
          else {
            const previous = rows[rows.length - 1];
            cells.forEach((cell, index) => {
              if (cell) previous[index] = clean(`${previous[index]} ${cell}`);
            });
          }
        }
        if (rows.length > 1) tables.push(rows);
      });
      pages.push(lines.join("\n"));
      page.cleanup();
    }
    const sparsePageNumbers = pages
      .map((text, index) => ({ index, length: fold(text).length }))
      // Detecta también páginas híbridas con una capa de texto parcial.
      .filter(({ length }) => length < 350)
      .map(({ index }) => index + 1);
    if (sparsePageNumbers.length) {
      await ocrPdfPages(pdf, pages, sparsePageNumbers, onProgress);
    }
    const extractedText = pages.join("\n\n");
    if (fold(extractedText).length < 80) {
      throw new Error("El OCR no ha encontrado texto suficiente en el contrato. Prueba con una copia más nítida.");
    }
    return { text: extractedText, tables, usedOcr: sparsePageNumbers.length > 0 };
  } finally {
    await pdf.destroy();
  }
}

async function extractDocument(
  file: File,
  onProgress?: (progress: ContractImportProgress) => void,
) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.size > 10 * 1024 * 1024) throw new Error("El contrato supera el límite de 10 MB.");
  if (!ACCEPTED_TYPES.has(file.type) && extension !== "pdf" && extension !== "docx") {
    throw new Error("Selecciona un contrato en formato PDF o Word (.docx).");
  }
  if (extension === "docx" || file.type.includes("wordprocessingml")) return extractDocx(file);
  return extractPdf(file, onProgress);
}

function detectBuyerCompany(text: string): BuyerCompany {
  const comparable = fold(text);
  if (/\btonifruit\b/.test(comparable)) return "TOÑIFRUIT, S.L.";
  if (/\bmr\.?\s*organica\b/.test(comparable)) return "MR. ORGÁNICA, S.L.";
  return "";
}

function detectSpecies(text: string) {
  const comparable = fold(text);
  const titleMatch = comparable.match(/contrato[^\n]{0,180}?(?:de|del)\s+(limones?|limas?|naranjas?|mandarinas?|pomelos?|granadas?|uvas?|paraguayos?|nectarinas?|melocotones?|albaricoques?|kumquats?|caviar citrico)\b/i)
    || comparable.match(/propietario\s+de\s+los?\s+(limones?|limas?|naranjas?|mandarinas?|pomelos?|granadas?|uvas?|paraguayos?|nectarinas?|melocotones?|albaricoques?|kumquats?|caviar citrico)\b/i);
  if (titleMatch) {
    const titleSpecies = titleMatch[1];
    const matched = SPECIES_ALIASES.find(([, aliases]) => aliases.includes(titleSpecies));
    if (matched) return matched[0];
  }
  for (const [species, aliases] of SPECIES_ALIASES) {
    if (aliases.some((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(comparable))) return species;
  }
  return "";
}

function detectKnownVarieties(text: string, crop: string) {
  const comparable = ` ${fold(text)} `;
  const varieties = PRODUCT_CATALOG[crop] || [];
  return varieties
    .filter((variety) => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(fold(variety))}(?:$|[^a-z0-9])`, "i").test(comparable))
    .sort((left, right) => right.length - left.length)
    .filter((variety, index, all) => !all.slice(0, index).some((longer) => fold(longer).includes(fold(variety))));
}

function tableMaterials(tables: string[][][], fallbackCrop: string) {
  const materials: MaterialItem[] = [];
  for (const rows of tables) {
    const headerIndex = rows.findIndex((row) => {
      const joined = fold(row.join(" "));
      return joined.includes("variedad") && joined.includes("paraje") && joined.includes("parcela") && joined.includes("kg");
    });
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(fold);
    const indexOf = (label: string) => headers.findIndex((header) => header === label || header.includes(label));
    const columns = {
      variety: indexOf("variedad"),
      situation: indexOf("situacion"),
      municipality: indexOf("termino"),
      paraje: indexOf("paraje"),
      polygon: indexOf("poligono"),
      plot: indexOf("parcela"),
      hectares: indexOf("ha"),
      kg: indexOf("kg"),
    };
    for (const row of rows.slice(headerIndex + 1)) {
      const at = (index: number) => index >= 0 ? clean(row[index] || "") : "";
      const variety = at(columns.variety);
      const kg = spanishNumber(at(columns.kg), true);
      const meaningful = variety || kg || at(columns.paraje) || at(columns.plot);
      if (!meaningful || fold(row.join(" ")).includes("identificacion exacta")) continue;
      materials.push(emptyMaterial({
        crop: fallbackCrop,
        variety,
        expectedKg: kg,
        situation: at(columns.situation),
        municipality: at(columns.municipality),
        paraje: at(columns.paraje),
        polygon: at(columns.polygon),
        plot: at(columns.plot),
        hectares: spanishNumber(at(columns.hectares)),
      }));
    }
  }
  return materials;
}

function detectKg(text: string) {
  const patterns = [
    /OPCI[ÓO]N\s*2\s*:\s*(?:X\s*)?([\d.]+(?:,\d+)?)\s*kilogramos/i,
    /cantidad\s+total[^\d]{0,80}([\d.]+(?:,\d+)?)\s*(?:kg|kilogramos)/i,
    /([\d.]+(?:,\d+)?)\s*(?:kg|kilogramos)\b/i,
  ];
  const value = findMatch(text, patterns);
  return spanishNumber(value, true);
}

function detectSignatureDate(text: string) {
  const written = text.match(/\ba\s+(\d{1,2})\s+de\s+([a-záéíóúüñ]+)\s+de\s+(\d{4})\b/i);
  if (written) return isoDate(written[1], written[2], written[3]);
  const labelled = text.match(/(?:fecha(?:\s+de\s+firma)?|firmado[^\d]{0,20})\s*:?\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/i);
  return labelled ? isoDate(labelled[1], labelled[2], labelled[3]) : "";
}

function detectCutDates(tables: string[][][], text: string) {
  for (const rows of tables) {
    const headerIndex = rows.findIndex((row) => {
      const joined = fold(row.join(" "));
      return joined.includes("cortes") && joined.includes("inicio") && (joined.includes("terminacion") || joined.includes("finalizacion"));
    });
    if (headerIndex < 0) continue;
    for (const row of rows.slice(headerIndex + 1)) {
      const dates = extractDates(row.join(" "));
      if (dates.length >= 2) return { start: dates[0], end: dates[1] };
    }
  }
  const labelled = text.match(/INICIO\s*:?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})[\s\S]{0,100}?(?:TERMINACI[ÓO]N|FINALIZACI[ÓO]N)\s*:?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
  if (labelled) {
    const start = extractDates(labelled[1])[0] || "";
    const end = extractDates(labelled[2])[0] || "";
    return { start, end };
  }
  return { start: "", end: "" };
}

function detectPrice(text: string) {
  const priceSection = text.match(/(?:4\s*[.º°o]?\s*PRECIO|PRECIO\s*:)([\s\S]{0,1400}?)(?=5\s*[.º°o]?\s*(?:FORMA\s+DE\s+PAGO|PAGO)|$)/i)?.[1] || text;
  if (/\bA\s+RESULTAS\b/i.test(priceSection)) return { priceAgreement: "A RESULTAS" as const, pricePerKg: "", totalPrice: "" };
  const perKg = findMatch(priceSection, [
    /(?:precio[^\d]{0,80})?([\d]+(?:[.,]\d{1,3})?)\s*(?:€|euros?)\s*(?:\/\s*(?:kg|kilo)|por\s+(?:kg|kilo))/i,
    /([\d]+(?:[.,]\d{1,3})?)\s*€\s*\/\s*kg/i,
  ]);
  if (perKg) return { priceAgreement: "IMPORTE" as const, pricePerKg: spanishNumber(perKg), totalPrice: "" };
  const total = findMatch(priceSection, [/(?:precio\s+total|por\s+la\s+totalidad)[^\d]{0,80}([\d.]+(?:,\d{1,2})?)\s*(?:€|euros?)/i]);
  return { priceAgreement: "IMPORTE" as const, pricePerKg: "", totalPrice: spanishNumber(total) };
}

function detectPartyBlock(text: string) {
  const start = text.search(/VENDEDOR\s*:/i);
  if (start < 0) return "";
  const remainder = text.slice(start);
  const end = remainder.search(/\n?\s*COMPRADOR\s*:/i);
  return end > 0 ? remainder.slice(0, end) : remainder.slice(0, 1600);
}

function detectOtherAgreements(text: string) {
  const match = text.match(/(?:OTROS\s+ACUERDOS|ACUERDOS\s+ADICIONALES)\s*:?\s*([\s\S]{0,900}?)(?=\n\s*(?:OTROS\s*:|FIRMAS?|EL\s+VENDEDOR|EL\s+COMPRADOR|\d+\s*[.º°o]\s*[A-ZÁÉÍÓÚÑ])|$)/i);
  if (!match) return "";
  const value = clean(match[1]);
  if (/^cualquier acuerdo entre las partes/i.test(value)) return "";
  return value;
}

function detectSelections(text: string) {
  const modality: "" | "A KILOS" | "POR TANTO" = /(?:x|☒|☑)\s*[“\"']?A\s+KILOS/i.test(text)
    ? "A KILOS"
    : /(?:x|☒|☑)\s*[“\"']?POR\s+TANTO/i.test(text) ? "POR TANTO" : "";
  const selectedParty = (section: "Vendedor" | "Comprador"): "" | "Vendedor" | "Comprador" => {
    if (new RegExp(`(?:x|☒|☑)\\s*${section}`, "i").test(text)) return section as "Vendedor" | "Comprador";
    return "";
  };
  return {
    modality,
    collectionBy: selectedParty("Comprador") || selectedParty("Vendedor"),
  };
}

export async function importPurchaseFromContract(
  file: File,
  selectedBuyerCompany: Exclude<BuyerCompany, "">,
  basePurchase: PurchaseForm,
  onProgress?: (progress: ContractImportProgress) => void,
): Promise<ContractImportReport> {
  const { text, tables, usedOcr = false } = await extractDocument(file, onProgress);
  const warnings: string[] = [];
  const detectedFields: string[] = [];
  const next = structuredClone(basePurchase);
  const detectedBuyerCompany = detectBuyerCompany(text);
  if (usedOcr) {
    warnings.push("El documento se ha leído mediante OCR. Comprueba especialmente nombres, cifras, fechas y datos de las parcelas.");
  }
  next.contractDetails.buyerCompany = selectedBuyerCompany;
  detectedFields.push("Empresa compradora");
  if (detectedBuyerCompany && detectedBuyerCompany !== selectedBuyerCompany) {
    warnings.push(`El documento parece corresponder a ${detectedBuyerCompany}; se mantiene la empresa seleccionada para que la confirmes.`);
  } else if (!detectedBuyerCompany) {
    warnings.push("No se ha podido confirmar la empresa compradora dentro del documento.");
  }

  const sellerBlock = detectPartyBlock(text);
  const treatmentMatch = sellerBlock.match(/VENDEDOR\s*:\s*(D(?:ON|OÑA|ÑA)?[.ªº]?)/i)?.[1] || "";
  const representative = findMatch(sellerBlock, [
    /VENDEDOR\s*:\s*(?:D(?:ON|OÑA|ÑA)?[.ªº]?\s*)?(.+?)(?=,?\s*(?:con\s+)?(?:DNI|NIF|CIF)\b)/i,
  ]);
  const representativeDni = cleanTaxId(findMatch(sellerBlock, [/(?:DNI|NIF|CIF)\s*[.:]?\s*(?:n[º°o]?\s*)?([A-Z]?[-\s]?\d[\d.\s]{5,12}-?[A-Z0-9]?)/i]));
  const representedCompany = findMatch(sellerBlock, [
    /poderes\s+suficientes(?:\s+de|\s+del|\s+de\s+la)\s+(.+?)(?=,\s*con\s+(?:NIF|CIF)\b)/i,
    /en\s+representaci[óo]n(?:\s+de|\s+del|\s+de\s+la)\s+(.+?)(?=,\s*con\s+(?:NIF|CIF)\b)/i,
  ]);
  const representedBlock = representedCompany
    ? sellerBlock.slice(Math.max(0, sellerBlock.indexOf(representedCompany)))
    : "";
  const companyTaxId = representedCompany
    ? cleanTaxId(findMatch(representedBlock, [/(?:NIF|CIF)\s*[.:]?\s*(?:n[º°o]?\s*)?([A-Z]?[-\s]?\d[\d.\s]{5,12}-?[A-Z0-9]?)/i]))
    : "";
  next.provider = representedCompany || representative;
  next.taxId = companyTaxId || representativeDni;
  next.contractDetails.sellerTreatment = representedCompany
    ? (/OÑA|ÑA|ª/i.test(treatmentMatch) ? "Dña." : treatmentMatch ? "D." : "")
    : "";
  next.contractDetails.sellerRepresentative = representedCompany ? representative : "";
  next.contractDetails.sellerDni = representedCompany ? representativeDni : "";
  next.contractDetails.sellerRepresentativeAddress = representedCompany
    ? findMatch(sellerBlock.slice(0, Math.max(0, sellerBlock.indexOf(representedCompany))), [
      /domicilio\s+en\s+(.+?)(?=,\s*en\s+representaci[óo]n)/i,
    ])
    : "";
  next.contractDetails.sellerAddress = representedCompany
    ? findMatch(representedBlock, [
      /domiciliad[ao]\s+en\s+(.+?)(?=,\s*en\s+adelante|\.\s*(?:Con\s+n[úu]mero|$))/i,
    ])
    : findMatch(sellerBlock, [
      /domicilio\s+en\s+(.+?)(?=,\s*(?:en\s+representaci[óo]n|en\s+adelante|con\s+n[úu]mero)|\.\s*(?:Con\s+n[úu]mero|$))/i,
    ]);
  next.contractDetails.sellerEmail = findMatch(sellerBlock, [/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i]);
  if (next.provider) detectedFields.push("Agricultor / razón social");
  else warnings.push("No se ha reconocido el agricultor o la razón social.");
  if (next.taxId) detectedFields.push("NIF / CIF");
  else warnings.push("No se ha reconocido el NIF o CIF del vendedor.");
  if (next.contractDetails.sellerRepresentative) detectedFields.push("Representante");
  if (next.contractDetails.sellerRepresentativeAddress) detectedFields.push("Domicilio del representante");
  if (next.contractDetails.sellerAddress) detectedFields.push("Domicilio");
  if (next.contractDetails.sellerEmail) detectedFields.push("Correo del agricultor");

  next.contractDetails.organicOperatorCode = findMatch(sellerBlock || text, [
    /(?:n[úu]mero|c[óo]digo)\s+de\s+operador\s+ecol[óo]gico\s*:?\s*([A-Z0-9\-\/.]+)/i,
  ]);
  next.contractDetails.certifierCode = findMatch(sellerBlock || text, [
    /(?:autoridad|organismo)\s+de\s+control\s+con\s+c[óo]digo\s*:?\s*([A-Z0-9\-\/.]+)/i,
  ]);
  next.contractDetails.ailimpoRegepaCode = findMatch(sellerBlock || text, [
    /(?:AILIMPO\s*\/\s*REGEPA|registro\s*\/\s*REGEPA|REGEPA)\s*:?\s*([A-Z0-9\-\/.]+)/i,
  ]);
  if (next.contractDetails.organicOperatorCode) detectedFields.push("Operador ecológico");
  if (next.contractDetails.certifierCode) detectedFields.push("Certificadora");
  if (next.contractDetails.ailimpoRegepaCode) detectedFields.push("AILIMPO / REGEPA");

  next.contractDetails.contractNumber = findMatch(text, [
    /N[.º°o]*\s*CONTRATO\s*:?\s*([A-Z]{2,5}-\d+)/i,
    /\b((?:MRO|TON)-\d{1,5})\b/i,
  ]);
  next.contractDetails.signatureDate = detectSignatureDate(text) || next.contractDetails.signatureDate;
  if (next.contractDetails.contractNumber) detectedFields.push("N.º de contrato");
  if (detectSignatureDate(text)) detectedFields.push("Fecha de firma");

  const crop = detectSpecies(text);
  let materials = tableMaterials(tables, crop);
  const detectedKg = detectKg(text);
  if (!materials.length && crop) {
    const varieties = detectKnownVarieties(text, crop);
    materials = (varieties.length ? varieties : [""]).map((variety, index) => emptyMaterial({
      crop,
      variety,
      expectedKg: index === 0 ? detectedKg : "",
    }));
  }
  if (materials.length && detectedKg && !materials.some((material) => material.expectedKg)) materials[0].expectedKg = detectedKg;
  if (materials.length) {
    next.materials = materials;
    Object.assign(next, materialSummary(materials));
    next.municipality = materials.find((material) => material.municipality)?.municipality || "";
    next.farm = materials.find((material) => material.paraje)?.paraje || "";
    detectedFields.push("Materia prima");
    if (materials.some((material) => material.expectedKg)) detectedFields.push("Kilogramos");
    if (materials.some((material) => material.paraje || material.polygon || material.plot)) detectedFields.push("Datos de parcelas");
    if (!next.municipality) warnings.push("Revisa el municipio o término de la finca.");
    if (!next.farm) warnings.push("Revisa el nombre o referencia de la finca.");
  } else {
    warnings.push("No se ha reconocido la especie o la tabla de materia prima.");
  }
  if (!next.expectedKg) warnings.push("No se han reconocido los kilogramos contratados.");

  const cutDates = detectCutDates(tables, text);
  next.contractStart = cutDates.start;
  next.contractEnd = cutDates.end;
  if (cutDates.start && cutDates.end) {
    detectedFields.push("Fechas del contrato");
    const startYear = Number(cutDates.start.slice(0, 4));
    next.campaign = `${startYear}/${String(startYear + 1).slice(-2)}`;
  } else {
    warnings.push("Revisa las fechas de inicio y fin: no se han encontrado ambas en el contrato.");
  }

  const price = detectPrice(text);
  next.contractDetails.priceAgreement = price.priceAgreement;
  next.contractDetails.pricePerKg = price.pricePerKg;
  next.contractDetails.totalPrice = price.totalPrice;
  if (price.pricePerKg) {
    next.contractDetails.modality = "A KILOS";
    detectedFields.push("Precio por kg");
  } else if (price.totalPrice) {
    next.contractDetails.modality = "POR TANTO";
    detectedFields.push("Precio total");
  } else if (price.priceAgreement === "A RESULTAS") {
    detectedFields.push("Precio a resultas");
  } else {
    warnings.push("No se ha reconocido el precio; debe comprobarse antes de generar el nuevo contrato.");
  }

  const selections = detectSelections(text);
  if (selections.modality && !price.pricePerKg && !price.totalPrice) next.contractDetails.modality = selections.modality;
  if (selections.collectionBy) next.contractDetails.collectionBy = selections.collectionBy;
  next.otherAgreements = detectOtherAgreements(text);
  if (next.otherAgreements) {
    detectedFields.push("Otros acuerdos");
    if (/destr[ií]o/i.test(next.otherAgreements)) {
      next.contractDetails.applyDestrio = "Sí";
      next.contractDetails.destrioLocation = /almac[eé]n/i.test(next.otherAgreements) ? "Almacén" : /campo/i.test(next.otherAgreements) ? "Campo" : "";
    }
  }

  next.id = "";
  next.contractSigned = "";
  next.registeredIca = "Pendiente";
  next.documentPath = "";
  next.contractDetails.contractOrigin = "";
  next.contractDetails.archiveId = "";
  next.contractDetails.archiveFilename = "";
  next.contractDetails.archivedAt = "";
  next.contractDetails.emailStatus = "";
  next.contractDetails.sellerSignedAt = "";
  next.contractDetails.buyerSignedAt = "";
  next.contractDetails.signatureMethod = "";
  next.contractDetails.archiveHistoryJson = "";
  const importedPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  next.contractDetails.previousContractMode = importedPdf ? "uploaded" : "none";
  next.contractDetails.previousContractPurchaseId = "";
  next.contractDetails.previousContractArchiveId = "";
  next.contractDetails.previousContractSourceArchiveId = "";
  next.contractDetails.previousContractFilename = importedPdf ? file.name : "";
  next.contractDetails.previousContractStoredAt = "";

  return {
    purchase: next,
    detectedFields: [...new Set(detectedFields)],
    warnings,
    detectedBuyerCompany,
    usedOcr,
  };
}
