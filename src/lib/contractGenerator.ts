import JSZip from "jszip";
import type { MaterialItem, PurchaseForm } from "../types";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

type ContractKind = "limon" | "pomelo" | "naranja" | "mandarina";

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
  if (company === "MR. ORGÁNICA, S.L.") return `mro-${kind}.docx`;
  if (company === "TOÑIFRUIT, S.L." && ["naranja", "mandarina"].includes(kind)) return `tonifruit-${kind}.docx`;
  return "";
}

function batchesFor(purchase: PurchaseForm) {
  const grouped = new Map<ContractKind, MaterialItem[]>();
  const unsupported: string[] = [];
  for (const material of purchase.materials) {
    const kind = contractKind(material.crop);
    if (!kind || !templateName(purchase.contractDetails.buyerCompany, kind)) {
      unsupported.push(`${material.crop}${material.variety ? ` · ${material.variety}` : ""}`);
      continue;
    }
    grouped.set(kind, [...(grouped.get(kind) || []), material]);
  }
  if (unsupported.length) {
    throw new Error(`No se ha facilitado un modelo contractual para: ${unsupported.join(", ")}.`);
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

function runElement(document: Document, value: string, bold = false) {
  const run = document.createElementNS(WORD_NS, "w:r");
  if (bold) {
    const properties = document.createElementNS(WORD_NS, "w:rPr");
    properties.append(document.createElementNS(WORD_NS, "w:b"));
    run.append(properties);
  }
  run.append(textElement(document, value));
  return run;
}

function setParagraph(paragraph: Element, value: string, boldPrefix = "") {
  const document = paragraph.ownerDocument;
  for (const child of Array.from(paragraph.children)) {
    if (!(child.namespaceURI === WORD_NS && child.localName === "pPr")) child.remove();
  }
  if (boldPrefix && value.startsWith(boldPrefix)) {
    paragraph.append(runElement(document, boldPrefix, true));
    paragraph.append(runElement(document, value.slice(boldPrefix.length)));
  } else {
    paragraph.append(runElement(document, value));
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

function setStrike(paragraph: Element) {
  const document = paragraph.ownerDocument;
  for (const run of Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "r"))) {
    let properties = childElements(run, "rPr")[0];
    if (!properties) {
      properties = document.createElementNS(WORD_NS, "w:rPr");
      run.insertBefore(properties, run.firstChild);
    }
    if (!childElements(properties, "strike").length) properties.append(document.createElementNS(WORD_NS, "w:strike"));
  }
}

function setCellText(cell: Element, value: string) {
  const paragraph = childElements(cell, "p")[0];
  if (paragraph) setParagraph(paragraph, value);
}

function topLevelTables(document: Document) {
  const body = document.getElementsByTagNameNS(WORD_NS, "body")[0];
  return childElements(body, "tbl");
}

function rows(table: Element) {
  return childElements(table, "tr");
}

function cells(row: Element) {
  return childElements(row, "tc");
}

function isoDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
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

function fillDocument(document: Document, purchase: PurchaseForm, batch: ContractBatch) {
  const details = purchase.contractDetails;
  const isAilimpo = batch.kind === "limon" || batch.kind === "pomelo";
  const contractNumber = details.contractNumber || purchase.id || "PENDIENTE";

  const dateParagraph = findParagraph(document, (text) => text.startsWith("En Librilla"));
  if (dateParagraph) setParagraph(dateParagraph, `En Librilla (Murcia) a ${longDate(details.signatureDate)}          Nº CONTRATO: ${contractNumber}`);

  const sellerParagraph = findParagraph(document, (text) => text.trimStart().startsWith("Vendedor:"));
  if (sellerParagraph) {
    const sellerText = isAilimpo
      ? `Vendedor: D. ${details.sellerRepresentative}, con DNI ${details.sellerDni}, mayor de edad, con domicilio en ${details.sellerAddress}, en representación y con poderes suficientes de ${purchase.provider}, con NIF ${purchase.taxId}, domiciliada en ${details.sellerAddress}, en adelante vendedor. Con número de operador ecológico: ${details.organicOperatorCode}. Certificado por la autoridad u organismo de control con Código: ${details.certifierCode || "__________"}. Código registro AILIMPO/REGEPA ${details.ailimpoRegepaCode || "____________"}.`
      : `Vendedor: D. ${details.sellerRepresentative}, con DNI ${details.sellerDni}, mayor de edad, con domicilio en ${details.sellerAddress}, en representación y con poderes suficientes de ${purchase.provider}, con NIF ${purchase.taxId}, domiciliada en ${details.sellerAddress}, en adelante vendedor. Código operador ecológico: ${details.organicOperatorCode}`;
    setParagraph(sellerParagraph, sellerText, "Vendedor:");
  }

  const ownerParagraph = findParagraph(document, (text) => text.startsWith("1. Que el vendedor es propietario"));
  if (ownerParagraph) {
    const text = paragraphText(ownerParagraph);
    const marker = "variedad/es,";
    const destination = ", con destino al mercado en fresco, con procedencia:";
    const start = text.indexOf(marker);
    const end = text.indexOf(destination, start + marker.length);
    if (start >= 0 && end >= 0) {
      const varieties = batch.materials.map((item) => item.variety).join(", ");
      setParagraph(ownerParagraph, `${text.slice(0, start + marker.length)} ${varieties}${text.slice(end)}`, "1.");
    }
  }

  const fieldOption = findParagraph(document, (text) => text.trimStart().startsWith("OPCIÓN 2:"));
  if (fieldOption) {
    replaceInParagraph(fieldOption, "□", "X");
    replaceNextBlank(fieldOption, String(totalKg(batch.materials)));
  }

  const tables = topLevelTables(document);
  const farmRows = rows(tables[0]);
  for (let index = 0; index < 2; index += 1) {
    const material = batch.materials[index];
    const rowCells = cells(farmRows[index + 1]);
    const values = material
      ? [material.variety, material.situation, material.municipality || purchase.municipality, material.paraje || purchase.farm, material.polygon, material.plot, material.hectares, material.expectedKg]
      : ["", "", "", "", "", "", "", ""];
    rowCells.forEach((cell, cellIndex) => setCellText(cell, values[cellIndex] || ""));
  }

  const modalityRows = rows(tables[1]);
  modalityRows.forEach((row, index) => setCellText(cells(row)[1], (details.modality === "A KILOS" ? index === 0 : index === 1) ? "X" : ""));
  const responsibilityRows = rows(tables[2]);
  responsibilityRows.forEach((row, index) => {
    const rowCells = cells(row);
    setCellText(rowCells[1], details.collectionBy === (index === 0 ? "Vendedor" : "Comprador") ? "X" : "");
    setCellText(rowCells[6], details.transportBy === (index === 0 ? "Vendedor" : "Comprador") ? "X" : "");
  });

  const collectionTable = tables[3];
  const collectionRows = rows(collectionTable);
  const collectionCells = cells(collectionRows[1]);
  const leftCollectionCell = collectionCells[0];
  const rightCollectionCell = collectionCells[2];
  const nestedCuts = leftCollectionCell.getElementsByTagNameNS(WORD_NS, "tbl")[0];
  if (nestedCuts) {
    const cutRows = rows(nestedCuts);
    if (cutRows[1]) {
      const cutCells = cells(cutRows[1]);
      ["1", isoDate(purchase.contractStart), isoDate(purchase.contractEnd), "", ""].forEach((value, index) => setCellText(cutCells[index], value));
    }
  }

  const rightStart = findParagraph(rightCollectionCell, (text) => text.startsWith("INICIO:"));
  const rightEnd = findParagraph(rightCollectionCell, (text) => text.startsWith("FINALIZACIÓN:"));
  if (details.modality === "POR TANTO") {
    if (rightStart) setParagraph(rightStart, `INICIO: ${isoDate(purchase.contractStart)}`);
    if (rightEnd) setParagraph(rightEnd, `FINALIZACIÓN: ${isoDate(purchase.contractEnd)}`);
  }
  const insurance = findParagraph(rightCollectionCell, (text) => text.startsWith("El vendedor tiene asegurada"));
  if (insurance) setParagraph(insurance, `El vendedor tiene asegurada la cosecha con ${details.insuranceProvider || "…………"}, nº póliza ${details.insurancePolicy || "……………………"}. El vendedor designará como beneficiario de la póliza al comprador.`);

  const priceCells = cells(collectionRows[2]);
  const activePriceCell = details.modality === "POR TANTO" ? priceCells[2] : priceCells[0];
  const priceParagraphs = Array.from(activePriceCell.getElementsByTagNameNS(WORD_NS, "p"));
  const priceParagraph = priceParagraphs.find((paragraph) => paragraphText(paragraph).includes("IVA"));
  if (priceParagraph) {
    const priceValue = details.modality === "POR TANTO" ? details.totalPrice : details.pricePerKg;
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

  if (details.applyDestrio === "Sí" && details.modality === "A KILOS") {
    const leftParagraphs = childElements(leftCollectionCell, "p");
    const standard = leftParagraphs.filter((paragraph) => {
      const text = paragraphText(paragraph);
      return text.startsWith("Se minor") || text.startsWith("Alternativamente") || text.startsWith("Las minoraciones se aplicarán") || text.startsWith("Las partes podrán acordar");
    });
    standard.forEach(setStrike);
    const insertion = leftParagraphs.find((paragraph, index) => !paragraphText(paragraph) && index > 4);
    if (insertion) {
      const agreement = `SE DESTRÍA EN ${details.destrioLocation.toLocaleUpperCase("es")} ${details.destrioDefects.toLocaleUpperCase("es")} Y EL DESTRÍO SE PAGA A ${numberEs(details.destrioPrice)}€/KG`;
      setParagraph(insertion, agreement);
    }
  }

  const paymentCells = cells(collectionRows[3]);
  if (details.modality === "A KILOS") {
    const paymentParagraphs = childElements(paymentCells[0], "p");
    const advance = paymentParagraphs.find((paragraph) => paragraphText(paragraph).includes("Entrega a cuenta"));
    if (advance) {
      while (replaceNextBlank(advance, details.advancePayment || "0")) break;
    }
    const days = paymentParagraphs.find((paragraph) => paragraphText(paragraph).includes("El pago se realizará"));
    if (days) replaceNextBlank(days, details.paymentDays || "30");
  } else {
    const payment = childElements(paymentCells[2], "p")[0];
    if (payment) setParagraph(payment, `5.o FORMA DE PAGO: Transferencia bancaria a ${details.paymentDays || "30"} días.`, "5.o FORMA DE PAGO:");
  }

  const otherAgreements = findParagraph(document, (text) => /^1[34]\.o OTROS ACUERDOS:/.test(text.trimStart()));
  if (otherAgreements && purchase.otherAgreements.trim()) {
    const original = paragraphText(otherAgreements);
    if (/_{5,}/.test(original)) {
      const prefix = original.match(/^.*?OTROS ACUERDOS:/)?.[0] || "14.o OTROS ACUERDOS:";
      setParagraph(otherAgreements, `${prefix} ${purchase.otherAgreements.trim()}`, prefix);
    } else {
      setParagraph(otherAgreements, `${original.trim()} ${purchase.otherAgreements.trim()}`, original.slice(0, original.indexOf(":") + 1));
    }
  }
}

function safeFilename(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function generateOne(purchase: PurchaseForm, batch: ContractBatch, loadTemplate: (name: string) => Promise<ArrayBuffer>) {
  const name = templateName(purchase.contractDetails.buyerCompany, batch.kind);
  const zip = await JSZip.loadAsync(await loadTemplate(name));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("El modelo Word no contiene el documento principal.");
  const xml = await documentFile.async("string");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("El modelo Word no se ha podido interpretar.");
  fillDocument(document, purchase, batch);
  zip.file("word/document.xml", new XMLSerializer().serializeToString(document));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export async function downloadContracts(purchase: PurchaseForm, loadTemplate: (name: string) => Promise<ArrayBuffer>) {
  const details = purchase.contractDetails;
  const required = [
    [purchase.provider, "agricultor o razón social"],
    [purchase.taxId, "NIF/CIF"],
    [details.buyerCompany, "empresa compradora"],
    [details.signatureDate, "fecha de firma"],
    [details.sellerRepresentative, "representante del vendedor"],
    [details.sellerDni, "DNI del representante"],
    [details.sellerAddress, "domicilio del vendedor"],
    [details.organicOperatorCode, "código de operador ecológico"],
    [details.modality, "modalidad"],
    [details.collectionBy, "responsable de recolección"],
    [details.transportBy, "responsable de transporte"],
    [details.modality === "POR TANTO" ? details.totalPrice : details.pricePerKg, details.modality === "POR TANTO" ? "precio total" : "precio por kg"],
    [details.paymentDays, "plazo de pago"],
  ];
  const missing = required.filter(([value]) => !value).map(([, label]) => label);
  if (missing.length) throw new Error(`Completa antes de descargar: ${missing.join(", ")}.`);
  if (purchase.materials.some((material) => !material.crop || !material.variety || !material.expectedKg)) {
    throw new Error("Completa la especie, variedad y kg de todas las materias primas.");
  }
  if (details.applyDestrio === "Sí" && (!details.destrioLocation || !details.destrioDefects || !details.destrioPrice)) {
    throw new Error("Completa el lugar, los defectos y el precio del destrío.");
  }
  const batches = batchesFor(purchase);
  if (!batches.length) throw new Error("Añade una materia prima con un modelo contractual disponible.");
  const generated = await Promise.all(batches.map(async (batch) => {
    const suffix = batch.part > 1 ? `-${batch.part}` : "";
    const filename = `contrato-${batch.kind}-${safeFilename(purchase.provider)}${suffix}.docx`;
    return { filename, blob: await generateOne(purchase, batch, loadTemplate) };
  }));
  if (generated.length === 1) {
    triggerDownload(generated[0].blob, generated[0].filename);
    return 1;
  }
  const zip = new JSZip();
  generated.forEach((file) => zip.file(file.filename, file.blob));
  const bundle = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  triggerDownload(bundle, `contratos-${safeFilename(purchase.provider)}.zip`);
  return generated.length;
}
