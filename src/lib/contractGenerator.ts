import JSZip from "jszip";
import type { ContractOutputFormat, ContractSignatures, MaterialItem, PurchaseForm } from "../types";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const RELATIONSHIP_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const CORE_PROPERTIES_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const DUBLIN_CORE_NS = "http://purl.org/dc/elements/1.1/";

export type ContractKind = "limon" | "pomelo" | "naranja" | "mandarina" | "uva" | "fruta-hueso";

export const CONTRACT_TEMPLATE_NAMES = [
  "mro-limon.docx",
  "mro-pomelo.docx",
  "mro-naranja.docx",
  "mro-mandarina.docx",
  "mro-fruta-hueso.docx",
  "tonifruit-limon.docx",
  "tonifruit-pomelo.docx",
  "tonifruit-naranja.docx",
  "tonifruit-mandarina.docx",
  "tonifruit-uva.docx",
  "tonifruit-fruta-hueso.docx",
] as const;

type ContractBatch = {
  kind: ContractKind;
  materials: MaterialItem[];
  part: number;
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

export function contractKind(crop: string): ContractKind | null {
  const value = normalized(crop);
  if (value === "limon") return "limon";
  if (value === "pomelo") return "pomelo";
  if (value === "naranja") return "naranja";
  if (value.includes("mandarina") || value.includes("clementina")) return "mandarina";
  if (value === "uva") return "uva";
  if (["paraguayo", "nectarina", "melocoton", "albaricoque", "fruta de hueso"].includes(value)) return "fruta-hueso";
  return null;
}

export function templateName(company: PurchaseForm["contractDetails"]["buyerCompany"], kind: ContractKind) {
  const buyer = normalized(company);
  // Los expedientes importados pueden contener pequeñas diferencias de
  // puntuación o acentuación. El modelo se resuelve por empresa y especie,
  // nunca por variedad.
  if (buyer.includes("organica")) {
    // No se cruza nunca un modelo de otra sociedad. MR. Orgánica todavía no
    // dispone de un modelo de uva en la biblioteca entregada.
    if (kind === "uva") return "";
    return `mro-${kind}.docx`;
  }
  if (buyer.includes("tonifruit")) {
    return `tonifruit-${kind}.docx`;
  }
  return "";
}

function buyerParagraphText(company: PurchaseForm["contractDetails"]["buyerCompany"], isAilimpo: boolean) {
  const buyer = normalized(company);
  const label = isAilimpo ? "Y de la otra parte, Comprador:" : "Comprador:";
  const commonRepresentative = "D. Juan Antonio Martínez Rubio, con DNI 52805756X, mayor de edad, con domicilio en 30892 Librilla (Murcia) España, en representación y con poderes suficientes de";
  if (buyer.includes("tonifruit")) {
    const identity = `${commonRepresentative} TOÑIFRUIT, S.L., con NIF B73636086 domiciliada en P.E. Cabecicos Blancos - C/ Molino Grande, S/N, Buzón 22 - 30892 Librilla (Murcia) España, en adelante comprador.`;
    return isAilimpo
      ? `${label} ${identity} Con número de operador ecológico: MU-3078/E. Código registro AILIMPO ____________.`
      : `${label} ${identity} Con número de operador ecológico: MU-3078/E.`;
  }
  if (buyer.includes("organica")) {
    const identity = `${commonRepresentative} MR. Orgánica, S.L., con NIF B73894065 domiciliada en P.E. Cabecicos Blancos - C/ Molino Grande, S/N, Buzón 31 - 30892 Librilla (Murcia) España, en adelante comprador.`;
    return isAilimpo
      ? `${label} ${identity} Con número de operador ecológico: MU-3684/E. Código registro AILIMPO ____________.`
      : `${label} ${identity} Con número de operador ecológico: MU-3684/E.`;
  }
  return "";
}

export function batchesFor(purchase: PurchaseForm) {
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
    throw new Error(`No se ha facilitado un modelo contractual para la especie: ${[...new Set(unsupportedSpecies)].join(", ")}. No se reutilizará un modelo de otra especie. Si ya existe un contrato firmado, selecciona "Contrato firmado existente" para adjuntarlo y archivarlo.`);
  }
  if (speciesWithoutCompanyTemplate.length) {
    const species = [...new Set(speciesWithoutCompanyTemplate)].join(", ");
    throw new Error(`No hay un modelo de ${species} para ${purchase.contractDetails.buyerCompany}. El modelo se selecciona por especie; la variedad se rellena dentro del contrato.`);
  }
  const batches: ContractBatch[] = [];
  for (const [kind, materials] of grouped) {
    // Una especie corresponde a un único contrato. Las distintas parcelas y
    // variedades se incorporan como filas de la tabla del mismo documento;
    // nunca se divide el contrato por el número de parcelas.
    batches.push({ kind, materials, part: 1 });
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

function runElement(document: Document, value: string, bold = false, halfPoints?: number, sourceProperties?: Element | null) {
  const run = document.createElementNS(WORD_NS, "w:r");
  const properties = sourceProperties
    ? document.importNode(sourceProperties, true) as Element
    : document.createElementNS(WORD_NS, "w:rPr");
  for (const child of Array.from(properties.children)) {
    if (child.namespaceURI === WORD_NS && ["strike", "dstrike"].includes(child.localName)) child.remove();
    if (halfPoints !== undefined && child.namespaceURI === WORD_NS && ["sz", "szCs"].includes(child.localName)) child.remove();
    if (!bold && child.namespaceURI === WORD_NS && ["b", "bCs"].includes(child.localName)) child.remove();
  }
  if (bold && !childElements(properties, "b").length) properties.append(document.createElementNS(WORD_NS, "w:b"));
  if (halfPoints !== undefined) {
    const size = document.createElementNS(WORD_NS, "w:sz");
    size.setAttributeNS(WORD_NS, "w:val", String(halfPoints));
    const complexSize = document.createElementNS(WORD_NS, "w:szCs");
    complexSize.setAttributeNS(WORD_NS, "w:val", String(halfPoints));
    properties.append(size, complexSize);
  }
  run.append(properties);
  run.append(textElement(document, value));
  return run;
}

function setParagraph(paragraph: Element, value: string, boldPrefix = "", halfPoints?: number) {
  const document = paragraph.ownerDocument;
  const paragraphProperties = childElements(paragraph, "pPr")[0];
  const sourceProperties = (paragraphProperties && childElements(paragraphProperties, "rPr")[0])
    || paragraph.getElementsByTagNameNS(WORD_NS, "rPr")[0]
    || null;
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

function replaceBetween(paragraph: Element, startMarker: string, endMarker: string, replacement: string) {
  const text = paragraphText(paragraph);
  const start = text.indexOf(startMarker);
  const end = start < 0 ? -1 : text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return false;
  const current = text.slice(start + startMarker.length, end);
  return replaceInParagraph(paragraph, current, replacement);
}

function setCellText(cell: Element, value: string, halfPoints?: number) {
  const paragraph = childElements(cell, "p")[0];
  if (paragraph) setParagraph(paragraph, value, "", halfPoints);
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

function dominantNegativeIndent(paragraphs: Element[], attributes: string[]) {
  const counts = new Map<number, number>();
  for (const paragraph of paragraphs) {
    const properties = childElements(paragraph, "pPr")[0];
    const indent = properties && childElements(properties, "ind")[0];
    if (!indent) continue;
    for (const attribute of attributes) {
      const value = wordNumber(indent, attribute);
      if (value < 0) counts.set(Math.abs(value), (counts.get(Math.abs(value)) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || 0;
}

function shiftTopLevelIndent(indent: Element, attributes: string[], fallbackAttribute: string, correction: number) {
  const attribute = attributes.find((name) => indent.hasAttributeNS(WORD_NS, name) || indent.hasAttribute(`w:${name}`));
  if (attribute) setWordNumber(indent, attribute, Math.max(0, wordNumber(indent, attribute) + correction));
  else setWordNumber(indent, fallbackAttribute, correction);
}

function normalizeParagraphIndents(document: Document, leftCorrection: number, rightCorrection: number) {
  const body = document.getElementsByTagNameNS(WORD_NS, "body")[0];
  const topLevelParagraphs = new Set(childElements(body, "p"));
  for (const paragraph of Array.from(body.getElementsByTagNameNS(WORD_NS, "p"))) {
    const properties = childElements(paragraph, "pPr")[0];
    const indent = properties && childElements(properties, "ind")[0];
    if (!indent) continue;

    if (topLevelParagraphs.has(paragraph)) {
      shiftTopLevelIndent(indent, ["left", "start"], "left", leftCorrection);
      shiftTopLevelIndent(indent, ["right", "end"], "right", rightCorrection);
      continue;
    }

    const hanging = Math.max(0, wordNumber(indent, "hanging"));
    for (const attribute of ["left", "start"]) {
      if (wordNumber(indent, attribute) < 0) setWordNumber(indent, attribute, Math.max(0, wordNumber(indent, attribute) + leftCorrection));
      if (hanging && wordNumber(indent, attribute) < hanging) setWordNumber(indent, attribute, hanging);
    }
    for (const attribute of ["right", "end"]) {
      if (wordNumber(indent, attribute) < 0) setWordNumber(indent, attribute, Math.max(0, wordNumber(indent, attribute) + rightCorrection));
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

function stabilizeContractLayout(document: Document) {
  const sections = Array.from(document.getElementsByTagNameNS(WORD_NS, "sectPr"));
  const section = sections.at(-1);
  if (!section) return;
  const pageSize = childElements(section, "pgSz")[0];
  const margins = childElements(section, "pgMar")[0];
  if (!pageSize || !margins) return;

  const body = document.getElementsByTagNameNS(WORD_NS, "body")[0];
  const topLevelParagraphs = childElements(body, "p");
  const leftCorrection = dominantNegativeIndent(topLevelParagraphs, ["left", "start"]);
  const rightCorrection = dominantNegativeIndent(topLevelParagraphs, ["right", "end"]);

  // Los modelos oficiales combinan los márgenes de sección con una sangría
  // negativa común para definir el margen visual real. Ream no conserva bien
  // esa combinación: elimina anchura útil, provoca más saltos de línea y hace
  // que las páginas de continuación comiencen fuera de su margen superior.
  // Trasladamos esa sangría común al margen de página y dejamos las sangrías a
  // cero. El resultado conserva el ancho visual del Word original.
  if (leftCorrection) setWordNumber(margins, "left", Math.max(0, wordNumber(margins, "left") - leftCorrection));
  if (rightCorrection) setWordNumber(margins, "right", Math.max(0, wordNumber(margins, "right") - rightCorrection));
  normalizeParagraphIndents(document, leftCorrection, rightCorrection);

  const contentWidth = wordNumber(pageSize, "w") - wordNumber(margins, "left") - wordNumber(margins, "right");
  if (contentWidth <= 0) return;

  topLevelTables(document).forEach((table) => scaleTableToWidth(table, contentWidth));
}

function removeListMarkers(root: Element) {
  for (const paragraph of Array.from(root.getElementsByTagNameNS(WORD_NS, "p"))) {
    const properties = childElements(paragraph, "pPr")[0];
    if (!properties) continue;
    const numbering = childElements(properties, "numPr")[0];
    if (!numbering) continue;
    numbering.remove();
    const indent = childElements(properties, "ind")[0];
    if (indent) indent.remove();
  }
}

function removeEmptyNumberedParagraphs(root: Element) {
  for (const paragraph of Array.from(root.getElementsByTagNameNS(WORD_NS, "p"))) {
    const properties = childElements(paragraph, "pPr")[0];
    const numbered = properties && childElements(properties, "numPr").length > 0;
    if (numbered && !paragraphText(paragraph).trim()) paragraph.remove();
  }
}

function preventRowSplit(row: Element | undefined) {
  if (!row) return;
  let properties = childElements(row, "trPr")[0];
  if (!properties) {
    properties = row.ownerDocument.createElementNS(WORD_NS, "w:trPr");
    row.prepend(properties);
  }
  if (!childElements(properties, "cantSplit").length) {
    properties.append(row.ownerDocument.createElementNS(WORD_NS, "w:cantSplit"));
  }
}

function addPageBreakBefore(element: Element) {
  const hasExplicitPageBreak = (paragraph: Element) => {
    const properties = childElements(paragraph, "pPr")[0];
    if (properties && childElements(properties, "pageBreakBefore").length) return true;
    return Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "br"))
      .some((item) => item.getAttributeNS(WORD_NS, "type") === "page");
  };

  let paragraph = element.localName === "p" ? element : null;
  if (!paragraph) {
    let previous = element.previousElementSibling;
    while (previous?.namespaceURI === WORD_NS && previous.localName === "p" && !paragraphText(previous).trim()) {
      if (hasExplicitPageBreak(previous)) return;
      paragraph ||= previous;
      previous = previous.previousElementSibling;
    }
  }
  if (!paragraph) {
    const parent = element.parentNode;
    if (!parent) return;
    const spacer = element.ownerDocument.createElementNS(WORD_NS, "w:p");
    parent.insertBefore(spacer, element);
    addPageBreakBefore(spacer);
    return;
  }
  let properties = childElements(paragraph, "pPr")[0];
  if (!properties) {
    properties = element.ownerDocument.createElementNS(WORD_NS, "w:pPr");
    paragraph.prepend(properties);
  }
  if (!hasExplicitPageBreak(paragraph)) {
    properties.append(element.ownerDocument.createElementNS(WORD_NS, "w:pageBreakBefore"));
  }
}

function preserveTemplateSpacerBefore(paragraph: Element | undefined) {
  const previous = paragraph?.previousElementSibling;
  if (!previous || previous.namespaceURI !== WORD_NS || previous.localName !== "p" || paragraphText(previous).trim()) return;
  // Algunos conversores omiten los párrafos vacíos de 2 pt que el modelo
  // usa como separación. El espacio no separable conserva exactamente ese hueco.
  setParagraph(previous, "\u00a0", "", 4);
}

function removeParagraphs(document: Document, predicate: (text: string) => boolean) {
  for (const paragraph of Array.from(document.getElementsByTagNameNS(WORD_NS, "p"))) {
    if (predicate(paragraphText(paragraph).trim())) paragraph.remove();
  }
}

function suppressParagraphBorders(paragraph: Element | undefined) {
  if (!paragraph) return;
  let properties = childElements(paragraph, "pPr")[0];
  if (!properties) {
    properties = paragraph.ownerDocument.createElementNS(WORD_NS, "w:pPr");
    paragraph.prepend(properties);
  }
  let borders = childElements(properties, "pBdr")[0];
  if (!borders) {
    borders = paragraph.ownerDocument.createElementNS(WORD_NS, "w:pBdr");
    properties.append(borders);
  }
  for (const edgeName of ["top", "bottom"]) {
    let edge = childElements(borders, edgeName)[0];
    if (!edge) {
      edge = paragraph.ownerDocument.createElementNS(WORD_NS, `w:${edgeName}`);
      borders.append(edge);
    }
    edge.setAttributeNS(WORD_NS, "w:val", "nil");
  }
}

function repeatDefaultHeaderOnEveryPage(document: Document) {
  for (const section of Array.from(document.getElementsByTagNameNS(WORD_NS, "sectPr"))) {
    const references = childElements(section, "headerReference");
    const defaultReference = references.find((reference) => reference.getAttributeNS(WORD_NS, "type") === "default");
    const defaultId = defaultReference?.getAttributeNS(OFFICE_REL_NS, "id");
    if (!defaultId) continue;
    references.forEach((reference) => reference.setAttributeNS(OFFICE_REL_NS, "r:id", defaultId));
    for (const type of ["default", "even", "first"]) {
      if (references.some((reference) => reference.getAttributeNS(WORD_NS, "type") === type)) continue;
      const reference = document.createElementNS(WORD_NS, "w:headerReference");
      reference.setAttributeNS(WORD_NS, "w:type", type);
      reference.setAttributeNS(OFFICE_REL_NS, "r:id", defaultId);
      const insertionPoint = childElements(section, "headerReference").at(-1)?.nextSibling || section.firstChild;
      section.insertBefore(reference, insertionPoint);
    }
  }
}

async function synchronizeDefaultHeaderParts(zip: JSZip, document: Document) {
  const section = Array.from(document.getElementsByTagNameNS(WORD_NS, "sectPr")).at(-1);
  const defaultReference = section && childElements(section, "headerReference")
    .find((reference) => reference.getAttributeNS(WORD_NS, "type") === "default");
  const defaultId = defaultReference?.getAttributeNS(OFFICE_REL_NS, "id");
  const relationshipsFile = zip.file("word/_rels/document.xml.rels");
  if (!defaultId || !relationshipsFile) return;

  const relationships = new DOMParser().parseFromString(await relationshipsFile.async("string"), "application/xml");
  const relationship = Array.from(relationships.documentElement.children)
    .find((item) => item.getAttribute("Id") === defaultId);
  const target = relationship?.getAttribute("Target")?.replace(/^\.\//, "");
  if (!target) return;

  const sourcePath = `word/${target}`;
  const source = zip.file(sourcePath);
  if (!source) return;
  const sourceBytes = await source.async("uint8array");
  const sourceName = sourcePath.split("/").at(-1) || "";
  const sourceRelationshipsPath = `word/_rels/${sourceName}.rels`;
  const sourceRelationships = zip.file(sourceRelationshipsPath);
  const sourceRelationshipsBytes = sourceRelationships ? await sourceRelationships.async("uint8array") : null;

  const headerPaths = Object.keys(zip.files).filter((path) => /^word\/header\d+\.xml$/.test(path));
  headerPaths.forEach((path) => {
    zip.file(path, sourceBytes);
    const name = path.split("/").at(-1) || "";
    const relationshipsPath = `word/_rels/${name}.rels`;
    if (sourceRelationshipsBytes) zip.file(relationshipsPath, sourceRelationshipsBytes);
    else zip.remove(relationshipsPath);
  });
}

function rows(table: Element) {
  return childElements(table, "tr");
}

function cells(row: Element) {
  return childElements(row, "tc");
}

function farmTableRows(table: Element, materialCount: number) {
  let tableRows = rows(table);
  const minimumDataRows = Math.max(2, materialCount);
  const sourceRow = tableRows.at(-1);
  if (!sourceRow || tableRows.length < 2) {
    throw new Error("El modelo contractual no contiene la tabla de parcelas esperada.");
  }
  while (tableRows.length - 1 < minimumDataRows) {
    table.append(sourceRow.cloneNode(true));
    tableRows = rows(table);
  }
  return tableRows;
}

function isoDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function shortDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year.slice(-2)}`;
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

function totalKg(materials: MaterialItem[]) {
  return materials.reduce((sum, material) => sum + (Number(material.expectedKg.replace(",", ".")) || 0), 0);
}

function fruitStoneSpecies(materials: MaterialItem[]) {
  const plurals: Record<string, string> = {
    paraguayo: "paraguayos",
    nectarina: "nectarinas",
    melocoton: "melocotones",
    albaricoque: "albaricoques",
    "fruta de hueso": "fruta de hueso",
  };
  const values = [...new Set(materials.map((material) => plurals[normalized(material.crop)]).filter(Boolean))];
  return values.join(" y ") || "fruta de hueso";
}

function replaceHighlightedPlaceholders(document: Document, replacement: string) {
  for (const paragraph of Array.from(document.getElementsByTagNameNS(WORD_NS, "p"))) {
    const highlightedRuns = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "r")).filter((run) => {
      const properties = childElements(run, "rPr")[0];
      return Boolean(properties && childElements(properties, "highlight").length && /\*/.test(paragraphText(run)));
    });
    if (!highlightedRuns.length) continue;
    highlightedRuns.forEach((run, index) => {
      const textNodes = Array.from(run.getElementsByTagNameNS(WORD_NS, "t"));
      textNodes.forEach((node, textIndex) => {
        node.textContent = index === 0 && textIndex === 0 ? replacement : "";
        node.setAttributeNS(XML_NS, "xml:space", "preserve");
      });
      const properties = childElements(run, "rPr")[0];
      childElements(properties, "highlight").forEach((highlight) => highlight.remove());
    });
  }
}

function fillDocument(document: Document, purchase: PurchaseForm, batch: ContractBatch) {
  const details = purchase.contractDetails;
  const isAilimpo = batch.kind === "limon" || batch.kind === "pomelo";
  // Cada modelo conserva el tamaño definido por su Word original. La
  // plantilla de uva requiere 10 pt también en los campos antes vacíos.
  const filledHalfPoints = batch.kind === "uva" ? 20 : undefined;
  const contractNumber = details.contractNumber || purchase.id || "PENDIENTE";

  if (batch.kind === "fruta-hueso") {
    const species = fruitStoneSpecies(batch.materials);
    replaceHighlightedPlaceholders(document, species);
    for (const paragraph of Array.from(document.getElementsByTagNameNS(WORD_NS, "p"))) {
      replaceInParagraph(paragraph, "MANDARINAS", species.toLocaleUpperCase("es"));
      replaceInParagraph(paragraph, "Mandarinas", `${species.charAt(0).toLocaleUpperCase("es")}${species.slice(1)}`);
    }
  }

  const dateParagraph = findParagraph(document, (text) => text.replace(/\s+/g, " ").startsWith("En Librilla"));
  if (dateParagraph) setParagraph(dateParagraph, `En Librilla (Murcia) a ${longDate(details.signatureDate)}          Nº CONTRATO: ${contractNumber}`, "", filledHalfPoints);

  const sellerParagraph = findParagraph(document, (text) => {
    const compact = text.trimStart().replace(/\s+/g, " ");
    return compact.startsWith("Vendedor:") || /^De una parte, Vendedor:/i.test(compact);
  });
  if (sellerParagraph) {
    const representative = details.sellerRepresentative.trim();
    const representativeAddress = details.sellerRepresentativeAddress?.trim() || "";
    const address = details.sellerAddress.trim();
    const treatment = details.sellerTreatment || "D.";
    const sellerIdentity = representative
      ? `${treatment} ${representative}, con DNI ${details.sellerDni.trim() || "__________"}, mayor de edad${representativeAddress ? `, con domicilio en ${representativeAddress}` : ""}, en representación y con poderes suficientes de ${purchase.provider}, con NIF ${purchase.taxId}${address ? `, domiciliada en ${address}` : ""}, en adelante vendedor.`
      : `${purchase.provider}, con NIF ${purchase.taxId}${address ? `, con domicilio en ${address}` : ""}, en adelante vendedor.`;
    const sellerLabel = isAilimpo ? "De una parte, Vendedor:" : "Vendedor:";
    const sellerText = isAilimpo
      ? `${sellerLabel} ${sellerIdentity} Con número de operador ecológico: ${details.organicOperatorCode.trim() || "____________"}. Código registro AILIMPO/REGEPA ${details.ailimpoRegepaCode.trim() || "____________"}.`
      : `Vendedor: ${sellerIdentity} Código operador ecológico: ${details.organicOperatorCode.trim() || "____________"}`;
    setParagraph(sellerParagraph, sellerText, sellerLabel, filledHalfPoints);
  }

  const buyerParagraph = findParagraph(document, (text) => {
    const compact = text.trimStart().replace(/\s+/g, " ");
    return compact.startsWith("Comprador:") || /^Y de la otra parte, Comprador:/i.test(compact);
  });
  const buyerText = buyerParagraphText(details.buyerCompany, isAilimpo);
  if (buyerParagraph && buyerText) setParagraph(buyerParagraph, buyerText, isAilimpo ? "Y de la otra parte, Comprador:" : "Comprador:", filledHalfPoints);

  const varieties = [...new Set(batch.materials.map((material) => material.variety.trim()).filter(Boolean))].join(", ");
  const varietiesParagraph = findParagraph(document, (text) => text.includes("siguiente/s variedad/es"));
  if (varietiesParagraph && varieties && !replaceNextBlank(varietiesParagraph, varieties)) {
    replaceBetween(varietiesParagraph, "variedad/es,", ", con destino", ` ${varieties}`);
  }
  if (varietiesParagraph && batch.kind === "uva") {
    const origin = batch.materials.map((material) => [
      purchase.farm,
      material.municipality || purchase.municipality,
      material.paraje ? `paraje ${material.paraje}` : "",
      material.polygon ? `polígono ${material.polygon}` : "",
      material.plot ? `parcela ${material.plot}` : "",
    ].filter(Boolean).join(", ")).join("; ");
    if (origin) replaceNextBlank(varietiesParagraph, origin);
    // La plantilla de trabajo tenía todo el párrafo en negrita. Se restaura
    // el formato contractual: solo el número del apartado va en negrita y el
    // texto conserva los 10 pt del modelo original.
    setParagraph(varietiesParagraph, paragraphText(varietiesParagraph), "1. ", 20);
    preserveTemplateSpacerBefore(findParagraph(document, (text) => text.trimStart().startsWith("2. Que el comprador")));
  }

  if (batch.kind === "naranja") {
    const objectParagraph = findParagraph(document, (text) => text.includes("cantidades pactadas de MANDARINAS"));
    if (objectParagraph) replaceInParagraph(objectParagraph, "MANDARINAS", "NARANJAS");
  }

  const tables = topLevelTables(document);
  if (tables.length < 4) throw new Error("El modelo contractual no contiene las tablas esperadas.");

  const fieldOption = findParagraph(document, (text) => text.trimStart().startsWith("OPCIÓN 2:"));
  if (fieldOption) {
    replaceInParagraph(fieldOption, "□", "X");
    replaceNextBlank(fieldOption, String(totalKg(batch.materials)));
  }

  const farmRows = farmTableRows(tables[0], batch.materials.length);
  for (let index = 0; index < farmRows.length - 1; index += 1) {
    const material = batch.materials[index];
    const rowCells = farmRows[index + 1] ? cells(farmRows[index + 1]) : [];
    const values = material
      ? [material.variety, material.situation, material.municipality || purchase.municipality, material.paraje || purchase.farm, material.polygon, material.plot, material.hectares, material.expectedKg]
      : ["", "", "", "", "", "", "", ""];
    rowCells.forEach((cell, cellIndex) => setCellText(cell, values[cellIndex] || "", filledHalfPoints));
  }

  const priceMode = details.modality || (details.totalPrice && !details.pricePerKg ? "POR TANTO" : "A KILOS");
  const modalityRows = rows(tables[1]);
  modalityRows.forEach((row, index) => {
    const rowCells = cells(row);
    if (rowCells[0]) setCellText(rowCells[0], (priceMode === "A KILOS" ? index === 0 : index === 1) ? "X" : "", filledHalfPoints);
  });

  const responsibilityRows = rows(tables[2]);
  responsibilityRows.forEach((row, index) => {
    const rowCells = cells(row);
    if (rowCells[0]) setCellText(rowCells[0], (details.collectionBy || "Comprador") === (index === 0 ? "Vendedor" : "Comprador") ? "X" : "", filledHalfPoints);
    if (rowCells[5]) setCellText(rowCells[5], (details.transportBy || "Comprador") === (index === 0 ? "Vendedor" : "Comprador") ? "X" : "", filledHalfPoints);
  });

  const collectionTable = tables[3];
  const collectionRows = rows(collectionTable);
  const collectionCells = cells(collectionRows[1]);
  const leftCollectionCell = collectionCells[0];
  const rightCollectionCell = collectionCells[2];

  if (isAilimpo || batch.kind === "uva") {
    // El modelo original oculta los marcadores de la lista fuera de la celda.
    // Algunos conversores los vuelven a mostrar y desplazan el texto. Los
    // quitamos de forma explícita y mantenemos el bloque de recolección unido.
    removeEmptyNumberedParagraphs(leftCollectionCell);
    removeListMarkers(leftCollectionCell);
    preventRowSplit(collectionRows[1]);
    // En los modelos originales el bloque completo de modalidades comienza en
    // la segunda página. El salto explícito impide que una tabla partida pierda
    // el margen superior y la cabecera de la página de continuación.
    addPageBreakBefore(collectionTable);
  }

  const nestedCuts = leftCollectionCell.getElementsByTagNameNS(WORD_NS, "tbl")[0];
  if (nestedCuts) {
    if (batch.kind === "uva") scaleTableToWidth(nestedCuts, 4500);
    const cutRows = rows(nestedCuts);
    if (cutRows[1]) {
      const cutCells = cells(cutRows[1]);
      ["1", shortDate(purchase.contractStart), shortDate(purchase.contractEnd), "", ""].forEach((value, index) => {
        if (cutCells[index]) setCellText(cutCells[index], value, filledHalfPoints);
      });
    }
  }

  if (priceMode === "POR TANTO") {
    const rightStart = findParagraph(rightCollectionCell, (text) => text.startsWith("INICIO:"));
    const rightEnd = findParagraph(rightCollectionCell, (text) => text.startsWith("FINALIZACIÓN:"));
    if (rightStart) setParagraph(rightStart, `INICIO: ${isoDate(purchase.contractStart)}`, "", filledHalfPoints);
    if (rightEnd) setParagraph(rightEnd, `FINALIZACIÓN: ${isoDate(purchase.contractEnd)}`, "", filledHalfPoints);
  }

  const insurance = findParagraph(rightCollectionCell, (text) => text.startsWith("El vendedor tiene asegurada"));
  if (insurance) setParagraph(insurance, `El vendedor tiene asegurada la cosecha con ${details.insuranceProvider || "…………"}, nº póliza ${details.insurancePolicy || "……………………"}. El vendedor designará como beneficiario de la póliza al comprador.`, "", filledHalfPoints);

  const priceCells = cells(collectionRows[2]);
  const activePriceCell = priceMode === "POR TANTO" ? priceCells[2] : priceCells[0];
  const priceParagraphs = Array.from(activePriceCell.getElementsByTagNameNS(WORD_NS, "p"));
  const priceParagraph = priceParagraphs.find((paragraph) => paragraphText(paragraph).includes("IVA"));
  if (priceParagraph) {
    const priceValue = priceMode === "POR TANTO" ? details.totalPrice : details.pricePerKg;
    if (details.priceAgreement === "A RESULTAS") {
      const current = paragraphText(priceParagraph);
      const priceWithUnit = current.match(/(?:\d+(?:[.,]\d+)?|_{2,})?\s*€\s*(?:\/\s*(?:Kg\.?|kilo))?/i)?.[0];
      if (priceWithUnit?.trim()) replaceInParagraph(priceParagraph, priceWithUnit, "A RESULTAS");
      else if (!replaceNextBlank(priceParagraph, "A RESULTAS")) setParagraph(priceParagraph, `A RESULTAS, más el ___% IVA y, en su caso, menos el ___% IRPF según régimen fiscal aplicable.`, "", filledHalfPoints);
    } else {
      const existingUnitPrice = paragraphText(priceParagraph).match(/\d+(?:[.,]\d+)?\s*€\s*\/\s*Kg\./i)?.[0];
      if (existingUnitPrice) {
        replaceInParagraph(priceParagraph, existingUnitPrice, `${numberEs(priceValue)} € / Kg.`);
      } else if (paragraphText(priceParagraph).trimStart().startsWith("€ / Kg.")) {
        replaceInParagraph(priceParagraph, " € / Kg.", ` ${numberEs(priceValue)} € / Kg.`);
      } else if (!replaceNextBlank(priceParagraph, numberEs(priceValue))) {
        const marker = paragraphText(priceParagraph).includes(" € / Kg.") ? " € / Kg." : " €/";
        replaceInParagraph(priceParagraph, marker, `${numberEs(priceValue)}${marker}`);
      }
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

  if (priceMode === "A KILOS") {
    const leftParagraphs = childElements(leftCollectionCell, "p");
    const agreementParagraph = leftParagraphs.find((paragraph) => paragraphText(paragraph).startsWith("Las partes podrán acordar"));
    if (agreementParagraph) {
      const prefix = "Las partes podrán acordar otro tipo de minoraciones que deberán quedar reflejadas de forma expresa:";
      const agreement = details.applyDestrio === "Sí"
        ? `Destrío en ${details.destrioLocation.toLocaleLowerCase("es")} de ${details.destrioDefects}; el destrío se pagará a ${numberEs(details.destrioPrice)} €/kg.`
        : "____________________";
      // La línea de puntos original es más ancha que la celda y algunos
      // conversores la sacan del margen. Se conserva el espacio reservado sin
      // alterar el texto contractual.
      setParagraph(agreementParagraph, `${prefix} ${agreement}`, "", filledHalfPoints);
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
    if (payment) setParagraph(payment, `5.o FORMA DE PAGO: Transferencia bancaria a ${details.paymentDays || "30"} días.`, "5.o FORMA DE PAGO:", filledHalfPoints);
  }

  const otherAgreements = findParagraph(document, (text) => /^1[34]\.o OTROS ACUERDOS:/.test(text.trimStart()));
  if (otherAgreements && purchase.otherAgreements.trim()) {
    const original = paragraphText(otherAgreements);
    if (batch.kind === "uva") {
      const prefix = original.match(/^.*?OTROS ACUERDOS:/)?.[0] || "13.o OTROS ACUERDOS:";
      setParagraph(otherAgreements, `${prefix} ${purchase.otherAgreements.trim()}`, prefix, 20);
    } else if (/_{5,}/.test(original)) {
      const prefix = original.match(/^.*?OTROS ACUERDOS:/)?.[0] || "14.o OTROS ACUERDOS:";
      setParagraph(otherAgreements, `${prefix} ${purchase.otherAgreements.trim()}`, prefix, filledHalfPoints);
    } else {
      setParagraph(otherAgreements, `${original.trim()} ${purchase.otherAgreements.trim()}`, original.slice(0, original.indexOf(":") + 1), filledHalfPoints);
    }
  }

  if (batch.kind === "uva") {
    // El modelo contiene tres copias estáticas del acuerdo de calidad. Al
    // rellenarlo debe quedar solo el texto vigente introducido en la compra.
    removeParagraphs(document, (text) =>
      text === "Queda pendiente resultado análisis de la fruta a recolectar"
      || /^AL LLEGAR LA MERCANCIA SE HARA CONTROL DE CALIDAD/.test(text),
    );

    suppressParagraphBorders(findParagraph(document, (text) => text.startsWith("CONTRATO DE COMPRAVENTA DE UVA")));
  }

  if (isAilimpo) {
    // El punto 6 pertenece íntegramente a la página 2 del modelo AILIMPO. El
    // punto 7 inicia la página siguiente, aunque cambie la longitud de los
    // datos rellenados en las páginas anteriores.
    const clauseSeven = findParagraph(document, (text) => /^7\.o DURACIÓN/.test(text.trimStart()));
    if (clauseSeven) addPageBreakBefore(clauseSeven);

  }

  repeatDefaultHeaderOnEveryPage(document);

  // Las sangrías negativas del Word original desplazan cruces y bordes al
  // convertirlo en el navegador. Se normalizan para todas las especies y se
  // conserva intacta la anchura imprimible del modelo.
  stabilizeContractLayout(document);
}

function safeFilename(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function setCoreProperty(document: Document, namespace: string, qualifiedName: string, localName: string, value: string) {
  let element = document.getElementsByTagNameNS(namespace, localName)[0];
  if (!element) {
    element = document.createElementNS(namespace, qualifiedName);
    document.documentElement.append(element);
  }
  element.textContent = value;
}

async function setContractMetadata(zip: JSZip, purchase: PurchaseForm, batch: ContractBatch) {
  const coreFile = zip.file("docProps/core.xml");
  if (!coreFile) return;
  const coreDocument = new DOMParser().parseFromString(await coreFile.async("string"), "application/xml");
  if (coreDocument.getElementsByTagName("parsererror").length) return;
  const contractNumber = purchase.contractDetails.contractNumber || purchase.id || "PENDIENTE";
  const species = ({ limon: "Limón", pomelo: "Pomelo", naranja: "Naranja", mandarina: "Mandarina", uva: "Uva", "fruta-hueso": "Fruta de hueso" } as const)[batch.kind];
  const ecological = batch.kind === "pomelo" || batch.kind === "limon" ? "ecológico" : "ecológica";
  setCoreProperty(coreDocument, DUBLIN_CORE_NS, "dc:title", "title", `Contrato de ${species} - ${contractNumber} - ${purchase.provider}`);
  setCoreProperty(coreDocument, DUBLIN_CORE_NS, "dc:subject", "subject", `Contrato de compraventa de ${species.toLocaleLowerCase("es")} ${ecological}`);
  setCoreProperty(coreDocument, DUBLIN_CORE_NS, "dc:creator", "creator", purchase.contractDetails.buyerCompany);
  setCoreProperty(coreDocument, CORE_PROPERTIES_NS, "cp:lastModifiedBy", "lastModifiedBy", purchase.contractDetails.buyerCompany);
  zip.file("docProps/core.xml", new XMLSerializer().serializeToString(coreDocument));
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
  if (batch.kind === "uva") await synchronizeDefaultHeaderParts(zip, document);
  await addSignatures(zip, document, signatures);
  zip.file("word/document.xml", new XMLSerializer().serializeToString(document));
  await setContractMetadata(zip, purchase, batch);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}

type ReamModule = {
  Ream: {
    parse: (bytes: Uint8Array) => {
      convertWithReport: (target: "pdf") => Promise<{ bytes: Uint8Array; losses: unknown[] }>;
    };
  };
};

// Keep the converter inside the application. Mobile browsers and some company
// networks block runtime modules loaded from public CDNs, so a remote import
// made PDF generation fail even when the rest of the application was online.
function reamModuleUrl() {
  return new URL(
    "vendor/reamkit-1.27.0.js",
    new URL(import.meta.env.BASE_URL, window.location.href),
  ).href;
}

async function convertDocxToPdf(docx: Blob) {
  try {
    const module = await import(/* @vite-ignore */ reamModuleUrl()) as ReamModule;
    const source = new Uint8Array(await docx.arrayBuffer());
    const result = await module.Ream.parse(source).convertWithReport("pdf");
    if (result.losses.length) console.warn("La conversión del contrato a PDF ha comunicado avisos:", result.losses);
    const pdfBuffer = new ArrayBuffer(result.bytes.byteLength);
    new Uint8Array(pdfBuffer).set(result.bytes);
    return new Blob([pdfBuffer], { type: "application/pdf" });
  } catch (reason) {
    console.error("No se ha podido convertir el contrato a PDF", reason);
    throw new Error("No se ha podido generar el PDF estable. Inténtalo de nuevo o descárgalo en Word.");
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

export function validateContractGeneration(purchase: PurchaseForm) {
  const details = purchase.contractDetails;
  const required = [
    [purchase.provider, "agricultor o razón social"],
    [purchase.taxId, "NIF/CIF"],
    [purchase.contractStart, "inicio del contrato"],
    [purchase.contractEnd, "fin del contrato"],
    [details.buyerCompany, "empresa compradora"],
    [details.signatureDate, "fecha de firma"],
    [details.modality, "modalidad de compraventa"],
    [details.collectionBy, "responsable de recolección"],
    [details.transportBy, "responsable de transporte"],
    [details.priceAgreement === "A RESULTAS" ? "A RESULTAS" : details.modality === "POR TANTO" ? details.totalPrice : details.pricePerKg, details.modality === "POR TANTO" ? "precio total" : "precio por kg"],
    [details.paymentDays, "plazo de pago"],
  ];
  const missing = required.filter(([value]) => !value).map(([, label]) => label);
  if (missing.length) throw new Error(`Completa antes de descargar: ${missing.join(", ")}.`);
  if (details.priceAgreement !== "A RESULTAS" && details.pricePerKg && details.totalPrice) {
    throw new Error("Indica solo un tipo de precio: precio por kg o precio total.");
  }
  if (details.priceAgreement !== "A RESULTAS" && details.modality === "A KILOS" && details.totalPrice) throw new Error("La modalidad A KILOS requiere precio por kg, no precio total.");
  if (details.priceAgreement !== "A RESULTAS" && details.modality === "POR TANTO" && details.pricePerKg) throw new Error("La modalidad POR TANTO requiere precio total, no precio por kg.");
  if (purchase.materials.some((material) => !material.crop || !material.variety || !material.expectedKg)) {
    throw new Error("Completa la especie, variedad y kg de todas las materias primas.");
  }
  if (details.applyDestrio === "Sí" && (!details.destrioLocation || !details.destrioDefects || !details.destrioPrice)) {
    throw new Error("Completa el lugar, los defectos y el precio del destrío.");
  }
}

export async function generateContractPackage(
  purchase: PurchaseForm,
  loadTemplate: (name: string) => Promise<ArrayBuffer>,
  signatures?: ContractSignatures,
  format: ContractOutputFormat = "pdf",
) {
  validateContractGeneration(purchase);
  const batches = batchesFor(purchase);
  if (!batches.length) throw new Error("Añade una materia prima con un modelo contractual disponible.");
  const generated = await Promise.all(batches.map(async (batch) => {
    const suffix = batch.part > 1 ? `-${batch.part}` : "";
    const contractNumber = purchase.contractDetails.contractNumber || purchase.id || "pendiente";
    const filename = `contrato-${batch.kind}-${safeFilename(contractNumber)}-${safeFilename(purchase.provider)}${suffix}.${format}`;
    const docx = await generateOne(purchase, batch, loadTemplate, signatures);
    return { filename, blob: format === "pdf" ? await convertDocxToPdf(docx) : docx };
  }));
  if (generated.length === 1) {
    return { ...generated[0], count: 1 };
  }
  const zip = new JSZip();
  generated.forEach((file) => zip.file(file.filename, file.blob));
  const bundle = await zip.generateAsync({ type: "blob", mimeType: "application/zip", compression: "DEFLATE" });
  return { blob: bundle, filename: `contratos-${safeFilename(purchase.provider)}.zip`, count: generated.length };
}

export async function downloadContracts(
  purchase: PurchaseForm,
  loadTemplate: (name: string) => Promise<ArrayBuffer>,
  format: ContractOutputFormat = "pdf",
) {
  const generated = await generateContractPackage(purchase, loadTemplate, undefined, format);
  triggerDownload(generated.blob, generated.filename);
  return generated.count;
}
