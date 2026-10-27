import JSZip from "jszip";
import type { ContractOutputFormat, PurchaseForm } from "../types";
import { validateAnnexFields, type AnnexFields } from "./contractAnnexData";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export function annexTemplateName(company: string, fields: AnnexFields) {
  if (!["MR. ORGÁNICA, S.L.", "TOÑIFRUIT, S.L."].includes(company)) throw new Error("Selecciona la empresa del contrato original y guarda la compra antes de crear un anexo.");
  return `${company === "TOÑIFRUIT, S.L." ? "tonifruit" : "mro"}-anexo-${fields.kind === "price" ? "precio" : "anulacion"}.docx`;
}
function writtenDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export async function prepareAnnexPdf(docx: Blob) {
  const zip = await JSZip.loadAsync(await docx.arrayBuffer());
  const source = await zip.file("word/document.xml")?.async("string");
  if (!source) throw new Error("No se ha podido leer el anexo.");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const priceClause = Array.from(doc.getElementsByTagNameNS(WORD_NS, "p")).find(p => (p.textContent || "").startsWith("SEGUNDA. NUEVO PRECIO PACTADO"));
  if (priceClause) {
    // Keep the price clause as one coherent section on page two. Cached page
    // markers from the source must not split an edited price paragraph.
    for (const marker of Array.from(doc.getElementsByTagNameNS(WORD_NS, "lastRenderedPageBreak"))) marker.parentNode?.removeChild(marker);
    let properties = priceClause.getElementsByTagNameNS(WORD_NS, "pPr")[0];
    if (!properties) { properties = doc.createElementNS(WORD_NS, "w:pPr"); priceClause.insertBefore(properties, priceClause.firstChild); }
    if (!properties.getElementsByTagNameNS(WORD_NS, "pageBreakBefore").length) properties.appendChild(doc.createElementNS(WORD_NS, "w:pageBreakBefore"));
    zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  }
  // Ream does not reserve overflowing header pictures. Fit only the PDF copy's
  // inline logo into the existing header gap, without changing body margins/text.
  const gaps = Array.from(doc.getElementsByTagNameNS(WORD_NS, "pgMar")).map(margin => {
    const top = Number(margin.getAttributeNS(WORD_NS, "top"));
    const header = Number(margin.getAttributeNS(WORD_NS, "header"));
    return (top - header - 60) * 635; // twips -> EMU, 3pt clearance
  }).filter(gap => gap > 0);
  if (!gaps.length) return docx;
  const maxHeight = Math.min(...gaps);
  const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  for (const name of Object.keys(zip.files).filter(name => /^word\/header\d+\.xml$/.test(name))) {
    const header = new DOMParser().parseFromString(await zip.file(name)!.async("string"), "application/xml");
    let changed = false;
    for (const inline of Array.from(header.getElementsByTagNameNS(wp, "inline"))) {
      const extent = inline.getElementsByTagNameNS(wp, "extent")[0];
      const height = Number(extent?.getAttribute("cy"));
      if (!extent || height <= maxHeight) continue;
      const width = Math.round(Number(extent.getAttribute("cx")) * maxHeight / height);
      extent.setAttribute("cx", String(width)); extent.setAttribute("cy", String(Math.round(maxHeight)));
      for (const pictureExtent of Array.from(inline.getElementsByTagNameNS(a, "ext"))) {
        if (pictureExtent.hasAttribute("cx") && pictureExtent.hasAttribute("cy")) {
          pictureExtent.setAttribute("cx", String(width)); pictureExtent.setAttribute("cy", String(Math.round(maxHeight)));
        }
      }
      changed = true;
    }
    if (changed) zip.file(name, new XMLSerializer().serializeToString(header));
  }
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export async function convertAnnexToPdf(docx: Blob) {
  const prepared = await prepareAnnexPdf(docx);
  const bytes = await prepared.arrayBuffer();
  const worker = new Worker(new URL("../workers/annexPdf.worker.ts", import.meta.url), { type: "module" });
  try {
    const result = await new Promise<ArrayBuffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("La conversión ha tardado demasiado. Puedes descargar el Word y volver a intentar el PDF.")), 120_000);
      worker.onmessage = event => {
        clearTimeout(timer);
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.bytes);
      };
      worker.onerror = () => { clearTimeout(timer); reject(new Error("No se ha podido convertir el anexo a PDF. Descárgalo en Word y vuelve a intentarlo.")); };
      worker.postMessage({ bytes, moduleUrl: new URL("vendor/reamkit-1.27.0.js", new URL(import.meta.env.BASE_URL, window.location.href)).href }, [bytes]);
    });
    return new Blob([result], { type: "application/pdf" });
  } finally { worker.terminate(); }
}

// Replace only the existing text spans; retain paragraph/run properties and page geometry.
export function replaceAnnexToken(paragraph: Element, token: string, replacement: string) {
  const nodes = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "t"));
  const full = nodes.map((node) => node.textContent || "").join("");
  const start = full.indexOf(token);
  if (start < 0) return false;
  let offset = 0;
  for (const node of nodes) {
    const text = node.textContent || "";
    const end = offset + text.length;
    if (offset < start + token.length && end > start) {
      node.textContent = text.slice(0, Math.max(0, start - offset)) + (offset <= start ? replacement : "") + text.slice(Math.max(0, start + token.length - offset));
      node.setAttribute("xml:space", "preserve");
    }
    offset = end;
  }
  return true;
}

export async function generateContractAnnex(template: ArrayBuffer, purchase: PurchaseForm, rawFields: AnnexFields, format: ContractOutputFormat) {
  const fields = validateAnnexFields(rawFields);
  annexTemplateName(purchase.contractDetails.buyerCompany, fields);
  const details = purchase.contractDetails;
  if (!purchase.provider.trim() || !purchase.taxId.trim() || !details.sellerAddress.trim() || !purchase.campaign.trim()) throw new Error("Completa y guarda el nombre, NIF, domicilio del vendedor y campaña del contrato original.");
  if (details.sellerRepresentative.trim() && !details.sellerDni.trim()) throw new Error("Falta el DNI del representante del vendedor en la compra original.");
  const representative = details.sellerRepresentative.trim();
  const slots: Record<string, string> = {
    place: fields.place, date: writtenDate(fields.date), sellerName: purchase.provider, sellerTaxId: purchase.taxId,
    sellerAddress: details.sellerAddress, sellerRepresentative: representative ? `${details.sellerTreatment || "D."} ${representative}` : "",
    sellerDni: details.sellerDni, originalDate: `${writtenDate(fields.originalDate)} (contrato ${details.contractNumber || purchase.id})`,
    campaign: purchase.campaign, aicaReference: fields.aicaReference, product: fields.product,
    price: fields.price, unit: fields.unit, vat: fields.vat === "included" ? "IVA incluido" : "IVA no incluido",
    priceFormula: fields.priceFormula, removedVariety: fields.removedVariety,
    sellerSignatory: representative || purchase.provider,
  };
  const zip = await JSZip.loadAsync(template);
  const source = await zip.file("word/document.xml")?.async("string");
  if (!source) throw new Error("No se ha podido leer el modelo del anexo.");
  const xml = new DOMParser().parseFromString(source, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw new Error("El modelo del anexo no es válido.");
  for (const paragraph of Array.from(xml.getElementsByTagNameNS(WORD_NS, "p"))) {
    const text = paragraph.textContent || "";
    if ((text.includes("{{priceFormula}}") && fields.priceMode === "fixed") || (text.includes("{{price}}") && fields.priceMode === "variable") || (fields.kind === "price" && text.includes("{{sellerRepresentative}}") && !representative)) {
      paragraph.parentNode?.removeChild(paragraph);
      continue;
    }
    if (fields.kind === "partial_cancellation" && !representative) replaceAnnexToken(paragraph, ", representado/a en este acto por {{sellerRepresentative}}, con DNI {{sellerDni}}", "");
    for (const [key, value] of Object.entries(slots)) {
      if (/\{\{|\}\}/.test(value)) throw new Error("Los datos del contrato contienen marcadores no admitidos.");
      while (replaceAnnexToken(paragraph, `{{${key}}}`, value)) { /* handles repeated tokens */ }
    }
  }
  const output = new XMLSerializer().serializeToString(xml);
  if (/\{\{|\}\}|Recuerda ant/.test(output)) throw new Error("Quedan campos sin resolver en el modelo. No se ha generado el anexo.");
  zip.file("word/document.xml", output);
  const docx = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const reference = (details.contractNumber || purchase.id).replace(/[^a-zA-Z0-9-]/g, "-");
  return { blob: format === "pdf" ? await convertAnnexToPdf(docx) : docx, filename: `anexo-${fields.kind === "price" ? "precio" : "anulacion"}-${reference}-${fields.date}.${format}` };
}
