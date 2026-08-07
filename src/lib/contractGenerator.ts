import JSZip from "jszip";
import type { ContractSignatures, MaterialItem, PurchaseForm } from "../types";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const RELATIONSHIP_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

type ContractKind = "limon" | "pomelo" | "naranja" | "mandarina";

const CURRENT_AILIMPO_MODEL_END = "2026-08-31";

type ContractBatch = {
  kind: ContractKind;
  materials: MaterialItem[];
  part: number;
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

function contractKind(crop: string): ContractKind | null {
  const value = normalized(crop);
  if (value === "limon") return "limon";
  if (value === "pomelo") return "pomelo";
  if (value === "naranja") return "naranja";
  if (value.includes("mandarina") || value.includes("clementina")) return "mandarina";
  return null;
}

function templateName(company: PurchaseForm["contractDetails"]["buyerCompany"], kind: ContractKind) {
  const buyer = normalized(company);
  // Los expedientes importados pueden contener pequeñas diferencias de
  // puntuación o acentuación. El modelo se resuelve por empresa y especie,
  // nunca por variedad.
  if (buyer.includes("organica")) return `mro-${kind}.docx`;
  if (buyer.includes("tonifruit") && ["naranja", "mandarina"].includes(kind)) return `tonifruit-${kind}.docx`;
  return "";
}

function batchesFor(purchase: PurchaseForm) {
  const grouped = new Map<ContractKind, MaterialItem[]>();
  const unsupportedSpecies: string[] = [];
  const speciesWithoutCompanyTemplate: string[] = [];
  for (const material of purchase.materials) {
    const kind = contractKind(material.crop);
    if (!kind) {
      unsupportedSpecies.push(material.crop);
      continue;
    }
    if (!templateName(purchase.contractDetails.buyerCompany, kind)) {
      speciesWithoutCompanyTemplate.push(material.crop);
      continue;
    }
    grouped.set(kind, [...(grouped.get(kind) || []), material]);
  }
  if (unsupportedSpecies.length) {
    throw new Error(`No se ha facilitado un modelo contractual para la especie: ${[...new Set(unsupportedSpecies)].join(", ")}.`);
  }
  if (speciesWithoutCompanyTemplate.length) {
    const species = [...new Set(speciesWithoutCompanyTemplate)].join(", ");
    throw new Error(`No hay un modelo de ${species} para ${purchase.contractDetails.buyerCompany}. El modelo se selecciona por especie; la variedad se rellena dentro del contrato.`);
  }
  const batches: ContractBatch[] = [];
  for (const [kind, materials] of grouped) {
    for (let index = 0; index < materials.length; index += 2) {
      batches.push({ kind, materials: materials.slice(index, index + 2), part: Math.floor(index / 2) + 1 });
    }
  }
  return batches;
}

function childElements(element: Element, localName: string) {
  return Array.from(element.children).filter((child) => child.namespaceURI === WORD_NS && child.localName === localName);
}

function paragraphText(paragraph: Element) {
  return Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "t")).map((node) => node.textContent || "").join("");
}

function findParagraph(root: Document | Element, predicate: (text: string) => boolean) {
  return Array.from(root.getElementsByTagNameNS(WORD_NS, "p")).find((paragraph) => predicate(paragraphText(paragraph)));
}

function textElement(document: Document, value: string) {
  const text = document.createElementNS(WORD_NS, "w:t");
  text.setAttributeNS(XML_NS, "xml:space", "preserve");
  text.textContent = value;
  return text;
}

function runElement(document: Document, value: string, bold = false, halfPoints = 14, sourceProperties?: Element | null) {
  const run = document.createElementNS(WORD_NS, "w:r");
  const properties = sourceProperties
    ? document.importNode(sourceProperties, true) as Element
    : document.createElementNS(WORD_NS, "w:rPr");
  for (const child of Array.from(properties.children)) {
    if (child.namespaceURI === WORD_NS && ["sz", "szCs", "strike", "dstrike"].includes(child.localName)) child.remove();
  }
  if (bold && !childElements(properties, "b").length) properties.append(document.createElementNS(WORD_NS, "w:b"));
  const size = document.createElementNS(WORD_NS, "w:sz");
  size.setAttributeNS(WORD_NS, "w:val", String(halfPoints));
  const complexSize = document.createElementNS(WORD_NS, "w:szCs");
  complexSize.setAttributeNS(WORD_NS, "w:val", String(halfPoints));
  properties.append(size, complexSize);
  run.append(properties);
  run.append(textElement(document, value));
  return run;
}

function setParagraph(paragraph: Element, value: string, boldPrefix = "", halfPoints = 14) {
  const document = paragraph.ownerDocument;
  const sourceProperties = paragraph.getElementsByTagNameNS(WORD_NS, "rPr")[0] || null;
  for (const child of Array.from(paragraph.children)) {
    if (!(child.namespaceURI === WORD_NS && child.localName === "pPr")) child.remove();
  }
  if (boldPrefix && value.startsWith(boldPrefix)) {
    paragraph.append(runElement(document, boldPrefix, true, halfPoints, sourceProperties));
    paragraph.append(runElement(document, value.slice(boldPrefix.length), false, halfPoints, sourceProperties));
  } else {
    paragraph.append(runElement(document, value, false, halfPoints, sourceProperties));
  }
}

function replaceInParagraph(paragraph: Element, search: string, replacement: string) {
  const nodes = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "t"));
  const fullText = nodes.map((node) => node.textContent || "").join("");
  const start = fullText.indexOf(search);
  if (start < 0) return false;
  const end = start + search.length;
  let cursor = 0;
  let inserted = false;
  for (const node of nodes) {
    const value = node.textContent || "";
    const nodeStart = cursor;
    const nodeEnd = cursor + value.length;
    cursor = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const prefix = start > nodeStart ? value.slice(0, start - nodeStart) : "";
    const suffix = end < nodeEnd ? value.slice(end - nodeStart) : "";
    node.textContent = `${prefix}${inserted ? "" : replacement}${suffix}`;
    node.setAttributeNS(XML_NS, "xml:space", "preserve");
    inserted = true;
  }
  return true;
}

function replaceNextBlank(paragraph: Element, value: string) {
  const match = paragraphText(paragraph).match(/_{2,}/);
  return match ? replaceInParagraph(paragraph, match[0], value) : false;
}

function setCellText(cell: Element, value: string) {
  const paragraph = childElements(cell, "p")[0];
  if (paragraph) setParagraph(paragraph, value, "", 14);
}

function dataUrlBytes(dataUrl: string) {
  const encoded = dataUrl.split(",")[1] || "";
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function signatureDrawing(document: Document, relationshipId: string, name: string, id: number) {
  const xml = `<w:r xmlns:w="${WORD_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1463040" cy="502920"/><wp:docPr id="${id}" name="${name}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1463040" cy="502920"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing><w:br/></w:r>`;
  const source = new DOMParser().parseFromString(xml, "application/xml").documentElement;
  return document.importNode(source, true);
}

function signatureAuditRun(document: Document, text: string) {
  const run = runElement(document, text, false, 12);
  run.insertBefore(document.createElementNS(WORD_NS, "w:br"), run.lastChild);
  return run;
}

async function addSignatures(zip: JSZip, document: Document, signatures?: ContractSignatures) {
  if (!signatures?.sellerDataUrl) return;
  const relsFile = zip.file("word/_rels/document.xml.rels");
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!relsFile || !contentTypesFile) throw new Error("El modelo no contiene las relaciones necesarias para insertar las firmas.");

  const rels = new DOMParser().parseFromString(await relsFile.async("string"), "application/xml");
  const contentTypes = new DOMParser().parseFromString(await contentTypesFile.async("string"), "application/xml");
  const existingIds = new Set(Array.from(rels.documentElement.children).map((item) => item.getAttribute("Id") || ""));
  const nextRelationshipId = (base: string) => {
    let counter = 1;
    let candidate = base;
    while (existingIds.has(candidate)) candidate = `${base}${counter++}`;
    existingIds.add(candidate);
    return candidate;
  };

  const imageSpecs = [
    { role: "seller", label: "EL VENDEDOR", dataUrl: signatures.sellerDataUrl, signer: signatures.sellerName, id: 9101 },
  ];

  for (const image of imageSpecs) {
    const relationshipId = nextRelationshipId(`rIdContractSignature${image.id}`);
    const filename = `contract-signature-${image.role}.png`;
    zip.file(`word/media/${filename}`, dataUrlBytes(image.dataUrl));
    const relationship = rels.createElementNS(RELATIONSHIP_NS, "Relationship");
    relationship.setAttribute("Id", relationshipId);
    relationship.setAttribute("Type", `${OFFICE_REL_NS}/image`);
    relationship.setAttribute("Target", `media/${filename}`);
    rels.documentElement.append(relationship);

    const paragraph = findParagraph(document, (text) => text.trim() === image.label);
    if (!paragraph) throw new Error(`No se ha encontrado la zona de firma ${image.label}.`);
    let paragraphProperties = childElements(paragraph, "pPr")[0];
    if (!paragraphProperties) {
      paragraphProperties = document.createElementNS(WORD_NS, "w:pPr");
      paragraph.prepend(paragraphProperties);
    }
    let alignment = childElements(paragraphProperties, "jc")[0];
    if (!alignment) {
      alignment = document.createElementNS(WORD_NS, "w:jc");
      paragraphProperties.append(alignment);
    }
    alignment.setAttributeNS(WORD_NS, "w:val", "center");
    for (const child of Array.from(paragraph.children)) {
      if (!(child.namespaceURI === WORD_NS && child.localName === "pPr")) child.remove();
    }
    paragraph.append(signatureDrawing(document, relationshipId, filename, image.id));
    paragraph.append(runElement(document, image.label, true, 13));
    const signedDate = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(signatures.signedAt));
    paragraph.append(signatureAuditRun(document, `Firmado en la aplicación por ${image.signer} · ${signedDate}`));
  }

  const hasPng = Array.from(contentTypes.documentElement.children).some((item) => item.localName === "Default" && item.getAttribute("Extension")?.toLocaleLowerCase() === "png");
  if (!hasPng) {
    const png = contentTypes.createElementNS(CONTENT_TYPES_NS, "Default");
    png.setAttribute("Extension", "png");
    png.setAttribute("ContentType", "image/png");
    contentTypes.documentElement.append(png);
  }
  zip.file("word/_rels/document.xml.rels", new XMLSerializer().serializeToString(rels));
  zip.file("[Content_Types].xml", new XMLSerializer().serializeToString(contentTypes));
}

function topLevelTables(document: Document) {
  const body = document.getElementsByTagNameNS(WORD_NS, "body")[0];
  return childElements(body, "tbl");
}

function wordNumber(element: Element | null | undefined, name: string) {
  if (!element) return 0;
  const value = Number(element.getAttributeNS(WORD_NS, name) || element.getAttribute(`w:${name}`) || "0");
  return Number.isFinite(value) ? value : 0;
}

function setWordNumber(element: Element, name: string, value: number) {
  element.setAttributeNS(WORD_NS, `w:${name}`, String(Math.round(value)));
}

function clampNegativeParagraphIndents(document: Document) {
  const body = document.getElementsByTagNameNS(WORD_NS, "body")[0];
  for (const paragraph of childElements(body, "p")) {
    const properties = childElements(paragraph, "pPr")[0];
    const indent = properties && childElements(properties, "ind")[0];
    if (!indent) continue;

    const hanging = Math.max(0, wordNumber(indent, "hanging"));
    for (const attribute of ["left", "start"]) {
      if (wordNumber(indent, attribute) < 0) setWordNumber(indent, attribute, hanging);
    }
    for (const attribute of ["right", "end"]) {
      if (wordNumber(indent, attribute) < 0) setWordNumber(indent, attribute, 0);
    }
  }
}

function scaleTableToWidth(table: Element, targetWidth: number) {
  const properties = childElements(table, "tblPr")[0];
  if (!properties) return;
  const tableWidth = childElements(properties, "tblW")[0];
  const tableIndent = childElements(properties, "tblInd")[0];
  if (tableIndent && wordNumber(tableIndent, "w") < 0) setWordNumber(tableIndent, "w", 0);

  const grid = childElements(table, "tblGrid")[0];
  const gridColumns = grid ? childElements(grid, "gridCol") : [];
  const gridWidth = gridColumns.reduce((total, column) => total + wordNumber(column, "w"), 0);
  const declaredWidth = tableWidth?.getAttributeNS(WORD_NS, "type") === "dxa" ? wordNumber(tableWidth, "w") : 0;
  const sourceWidth = Math.max(gridWidth, declaredWidth);
  if (!sourceWidth || sourceWidth <= targetWidth) return;

  const ratio = targetWidth / sourceWidth;
  if (tableWidth) {
    tableWidth.setAttributeNS(WORD_NS, "w:type", "dxa");
    setWordNumber(tableWidth, "w", targetWidth);
  }
  gridColumns.forEach((column) => setWordNumber(column, "w", Math.max(1, wordNumber(column, "w") * ratio)));
  for (const row of rows(table)) {
    for (const cell of cells(row)) {
      const cellProperties = childElements(cell, "tcPr")[0];
      const cellWidth = cellProperties && childElements(cellProperties, "tcW")[0];
      if (cellWidth?.getAttributeNS(WORD_NS, "type") === "dxa") {
        setWordNumber(cellWidth, "w", Math.max(1, wordNumber(cellWidth, "w") * ratio));
      }
    }
  }
}

function stabilizeAilimpoLayout(document: Document) {
  const sections = Array.from(document.getElementsByTagNameNS(WORD_NS, "sectPr"));
  const section = sections.at(-1);
  if (!section) return;
  const pageSize = childElements(section, "pgSz")[0];
  const margins = childElements(section, "pgMar")[0];
  const contentWidth = wordNumber(pageSize, "w") - wordNumber(margins, "left") - wordNumber(margins, "right");
  if (contentWidth <= 0) return;

  // El modelo usa sangrías negativas que reducen el margen visual a casi la mitad.
  // El PDF debe respetar los márgenes A4 declarados por el propio documento.
  clampNegativeParagraphIndents(document);
  topLevelTables(document).forEach((table) => scaleTableToWidth(table, contentWidth));
}

function rows(table: Element) {
  return childElements(table, "tr");
}

function cells(row: Element) {
  return childElements(row, "tc");
}

function longDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  const day = String(date.getDate()).padStart(2, "0");
  const month = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(date).toLocaleUpperCase("es");
  return `${day} de ${month} de ${date.getFullYear()}`;
}

function numberEs(value: string) {
  return value.trim().replace(".", ",");
}

function fillDocument(document: Document, purchase: PurchaseForm, batch: ContractBatch) {
  const details = purchase.contractDetails;
  const isAilimpo = batch.kind === "limon" || batch.kind === "pomelo";
  const contractNumber = details.contractNumber || purchase.id || "PENDIENTE";

  const dateParagraph = findParagraph(document, (text) => text.startsWith("En Librilla"));
  if (dateParagraph) setParagraph(dateParagraph, `En Librilla (Murcia) a ${longDate(details.signatureDate)}          Nº CONTRATO: ${contractNumber}`, "", 15);

  const sellerParagraph = findParagraph(document, (text) => text.trimStart().startsWith("Vendedor:"));
  if (sellerParagraph) {
    const sellerText = isAilimpo
      ? `Vendedor: D. ${details.sellerRepresentative}, con DNI ${details.sellerDni}, mayor de edad, con domicilio en ${details.sellerAddress}, en representación y con poderes suficientes de ${purchase.provider}, con NIF ${purchase.taxId}, domiciliada en ${details.sellerAddress}, en adelante vendedor. Con número de operador ecológico: ${details.organicOperatorCode}. Certificado por la autoridad u organismo de control con Código: ${details.certifierCode || "__________"}. Código registro AILIMPO/REGEPA ${details.ailimpoRegepaCode || "____________"}.`
      : `Vendedor: D. ${details.sellerRepresentative}, con DNI ${details.sellerDni}, mayor de edad, con domicilio en ${details.sellerAddress}, en representación y con poderes suficientes de ${purchase.provider}, con NIF ${purchase.taxId}, domiciliada en ${details.sellerAddress}, en adelante vendedor. Código operador ecológico: ${details.organicOperatorCode}`;
    setParagraph(sellerParagraph, sellerText, "Vendedor:", 14);
  }

  if (isAilimpo) {
    const varieties = [...new Set(batch.materials.map((material) => material.variety.trim()).filter(Boolean))].join(", ");
    const varietiesParagraph = findParagraph(document, (text) => text.includes("siguiente/s variedad/es"));
    if (varietiesParagraph && varieties) replaceNextBlank(varietiesParagraph, varieties);
  }

  // En el apartado 1 solo se completa la variedad en su hueco reservado.
  // La finca, la modalidad, la recolección y el transporte se conservan en el expediente,
  // pero permanecen en blanco en el documento para la revisión de oficina.
  const tables = topLevelTables(document);
  const collectionTable = tables[3];
  const collectionRows = rows(collectionTable);
  const collectionCells = cells(collectionRows[1]);
  const leftCollectionCell = collectionCells[0];

  const priceCells = cells(collectionRows[2]);
  const priceMode = details.totalPrice && !details.pricePerKg ? "POR TANTO" : "A KILOS";
  const activePriceCell = priceMode === "POR TANTO" ? priceCells[2] : priceCells[0];
  const priceParagraphs = Array.from(activePriceCell.getElementsByTagNameNS(WORD_NS, "p"));
  const priceParagraph = priceParagraphs.find((paragraph) => paragraphText(paragraph).includes("IVA"));
  if (priceParagraph) {
    const priceValue = priceMode === "POR TANTO" ? details.totalPrice : details.pricePerKg;
    if (paragraphText(priceParagraph).trimStart().startsWith("€ / Kg.")) {
      replaceInParagraph(priceParagraph, " € / Kg.", ` ${numberEs(priceValue)} € / Kg.`);
    } else if (!replaceNextBlank(priceParagraph, numberEs(priceValue))) {
      const marker = paragraphText(priceParagraph).includes(" € / Kg.") ? " € / Kg." : " €/";
      replaceInParagraph(priceParagraph, marker, `${numberEs(priceValue)}${marker}`);
    }
    if (details.ivaPercent) {
      replaceInParagraph(priceParagraph, "más el ___% IVA", `más el ${numberEs(details.ivaPercent)}% IVA`);
      replaceInParagraph(priceParagraph, "incrementado en el __% correspondiente", `incrementado en el ${numberEs(details.ivaPercent)}% correspondiente`);
    }
    if (details.irpfPercent) replaceInParagraph(priceParagraph, "menos el ___% IRPF", `menos el ${numberEs(details.irpfPercent)}% IRPF`);
  }

  // Si no se pacta una prima, los tres bloques deben quedar marcados en NO.
  if (priceMode === "A KILOS") {
    const premiumTables = Array.from(priceCells[0].getElementsByTagNameNS(WORD_NS, "tbl"));
    premiumTables.slice(0, 3).forEach((table) => {
      const premiumRows = rows(table);
      if (premiumRows[1]) setCellText(cells(premiumRows[1])[1], "X");
    });
  }

  if (details.applyDestrio === "Sí" && priceMode === "A KILOS") {
    const leftParagraphs = childElements(leftCollectionCell, "p");
    const agreementParagraph = leftParagraphs.find((paragraph) => paragraphText(paragraph).startsWith("Las partes podrán acordar"));
    if (agreementParagraph) {
      const agreement = `Destrío en ${details.destrioLocation.toLocaleLowerCase("es")} de ${details.destrioDefects}; el destrío se pagará a ${numberEs(details.destrioPrice)} €/kg.`;
      replaceNextBlank(agreementParagraph, agreement);
    }
  }

  const paymentCells = cells(collectionRows[3]);
  if (priceMode === "A KILOS") {
    const paymentParagraphs = childElements(paymentCells[0], "p");
    const advance = paymentParagraphs.find((paragraph) => paragraphText(paragraph).includes("Entrega a cuenta"));
    if (advance) {
      while (replaceNextBlank(advance, details.advancePayment || "0")) break;
    }
    const days = paymentParagraphs.find((paragraph) => paragraphText(paragraph).includes("El pago se realizará"));
    if (days) replaceNextBlank(days, details.paymentDays || "30");
  } else {
    const payment = childElements(paymentCells[2], "p")[0];
    if (payment) setParagraph(payment, `5.o FORMA DE PAGO: Transferencia bancaria a ${details.paymentDays || "30"} días.`, "5.o FORMA DE PAGO:", 14);
  }

  const otherAgreements = findParagraph(document, (text) => /^1[34]\.o OTROS ACUERDOS:/.test(text.trimStart()));
  if (otherAgreements && purchase.otherAgreements.trim()) {
    const original = paragraphText(otherAgreements);
    if (/_{5,}/.test(original)) {
      const prefix = original.match(/^.*?OTROS ACUERDOS:/)?.[0] || "14.o OTROS ACUERDOS:";
      setParagraph(otherAgreements, `${prefix} ${purchase.otherAgreements.trim()}`, prefix, 15);
    } else {
      setParagraph(otherAgreements, `${original.trim()} ${purchase.otherAgreements.trim()}`, original.slice(0, original.indexOf(":") + 1), 15);
    }
  }

  if (isAilimpo) stabilizeAilimpoLayout(document);
}

function safeFilename(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function generateOne(purchase: PurchaseForm, batch: ContractBatch, loadTemplate: (name: string) => Promise<ArrayBuffer>, signatures?: ContractSignatures) {
  const name = templateName(purchase.contractDetails.buyerCompany, batch.kind);
  const zip = await JSZip.loadAsync(await loadTemplate(name));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("El modelo Word no contiene el documento principal.");
  const xml = await documentFile.async("string");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("El modelo Word no se ha podido interpretar.");
  fillDocument(document, purchase, batch);
  await addSignatures(zip, document, signatures);
  zip.file("word/document.xml", new XMLSerializer().serializeToString(document));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}

type ReamModule = {
  Ream: {
    parse: (bytes: Uint8Array) => {
      convertWithReport: (target: "pdf") => Promise<{ bytes: Uint8Array; losses: unknown[] }>;
    };
  };
};

const REAM_MODULE_URL = "https://esm.sh/reamkit@latest";

async function convertDocxToPdf(docx: Blob) {
  try {
    const module = await import(/* @vite-ignore */ REAM_MODULE_URL) as ReamModule;
    const source = new Uint8Array(await docx.arrayBuffer());
    const result = await module.Ream.parse(source).convertWithReport("pdf");
    if (result.losses.length) console.warn("La conversión del contrato a PDF ha comunicado avisos:", result.losses);
    const pdfBuffer = new ArrayBuffer(result.bytes.byteLength);
    new Uint8Array(pdfBuffer).set(result.bytes);
    return new Blob([pdfBuffer], { type: "application/pdf" });
  } catch (reason) {
    console.error("No se ha podido convertir el contrato a PDF", reason);
    throw new Error("No se ha podido generar el PDF estable. Comprueba la conexión e inténtalo de nuevo.");
  }
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function validateContractGeneration(purchase: PurchaseForm) {
  const details = purchase.contractDetails;
  const required = [
    [purchase.provider, "agricultor o razón social"],
    [purchase.taxId, "NIF/CIF"],
    [purchase.contractStart, "inicio del contrato"],
    [purchase.contractEnd, "fin del contrato"],
    [details.buyerCompany, "empresa compradora"],
    [details.signatureDate, "fecha de firma"],
    [details.sellerRepresentative, "representante del vendedor"],
    [details.sellerDni, "DNI del representante"],
    [details.sellerAddress, "domicilio del vendedor"],
    [details.organicOperatorCode, "código de operador ecológico"],
    [details.pricePerKg || details.totalPrice, "precio por kg o precio total"],
    [details.paymentDays, "plazo de pago"],
  ];
  const missing = required.filter(([value]) => !value).map(([, label]) => label);
  if (missing.length) throw new Error(`Completa antes de descargar: ${missing.join(", ")}.`);
  if (details.pricePerKg && details.totalPrice) {
    throw new Error("Indica solo un tipo de precio: precio por kg o precio total.");
  }
  if (purchase.materials.some((material) => !material.crop || !material.variety || !material.expectedKg)) {
    throw new Error("Completa la especie, variedad y kg de todas las materias primas.");
  }
  if (details.applyDestrio === "Sí" && (!details.destrioLocation || !details.destrioDefects || !details.destrioPrice)) {
    throw new Error("Completa el lugar, los defectos y el precio del destrío.");
  }
  const usesAilimpoModel = purchase.materials.some((material) => {
    const kind = contractKind(material.crop);
    return kind === "limon" || kind === "pomelo";
  });
  if (usesAilimpoModel && [details.signatureDate, purchase.contractStart, purchase.contractEnd].some((date) => date > CURRENT_AILIMPO_MODEL_END)) {
    throw new Error("Este modelo AILIMPO solo cubre hasta el 31/08/2026. Para la campaña 2026/2027 debe cargarse el contrato homologado vigente desde el 01/09/2026.");
  }
}

export async function generateContractPackage(
  purchase: PurchaseForm,
  loadTemplate: (name: string) => Promise<ArrayBuffer>,
  signatures?: ContractSignatures,
) {
  validateContractGeneration(purchase);
  const batches = batchesFor(purchase);
  if (!batches.length) throw new Error("Añade una materia prima con un modelo contractual disponible.");
  const generated = await Promise.all(batches.map(async (batch) => {
    const suffix = batch.part > 1 ? `-${batch.part}` : "";
    const filename = `contrato-${batch.kind}-${safeFilename(purchase.provider)}${suffix}.pdf`;
    const docx = await generateOne(purchase, batch, loadTemplate, signatures);
    return { filename, blob: await convertDocxToPdf(docx) };
  }));
  if (generated.length === 1) {
    return { ...generated[0], count: 1 };
  }
  const zip = new JSZip();
  generated.forEach((file) => zip.file(file.filename, file.blob));
  const bundle = await zip.generateAsync({ type: "blob", mimeType: "application/zip", compression: "DEFLATE" });
  return { blob: bundle, filename: `contratos-${safeFilename(purchase.provider)}.zip`, count: generated.length };
}

export async function downloadContracts(purchase: PurchaseForm, loadTemplate: (name: string) => Promise<ArrayBuffer>) {
  const generated = await generateContractPackage(purchase, loadTemplate);
  triggerDownload(generated.blob, generated.filename);
  return generated.count;
}
