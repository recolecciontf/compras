// Run against the retained official DOCX files; never change the originals.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const input = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const fittedLogo = resolve(process.argv[4] || "tmp/anexos-qa/tonifruit-logo-fit.png");
await mkdir(output, { recursive: true });
function text(p) { return [...p.getElementsByTagNameNS(ns, "t")].map(n => n.textContent).join(""); }
function replace(p, from, to) {
  const start = text(p).indexOf(from);
  if (start < 0) throw new Error(`No se encuentra el hueco del modelo: ${from}`);
  let offset = 0;
  for (const n of [...p.getElementsByTagNameNS(ns, "t")]) {
    const value = n.textContent, end = offset + value.length;
    if (offset < start + from.length && end > start) {
      n.textContent = value.slice(0, Math.max(0, start-offset)) + (offset <= start ? to : "") + value.slice(Math.max(0, start+from.length-offset));
      n.setAttribute("xml:space", "preserve");
    }
    offset = end;
  }
}
const companies = {
  mro: { name: "MR. ORGÁNICA, S.L.", nif: "B73894065", box: "31" },
  tonifruit: { name: "TOÑIFRUIT, S.L.", nif: "B73636086", box: "22" },
};
for (const kind of ["precio", "anulacion"]) {
  const filename = kind === "precio" ? "ANEXO CAMBIO DE PRECIO DE CONTRATO.docx" : "ANEXO ANULACIÓN PARCIAL DE CONTRATO.docx";
  const source = await readFile(resolve(input, filename));
  for (const [company, data] of Object.entries(companies)) {
    const zip = await JSZip.loadAsync(source);
    const doc = new DOMParser().parseFromString(await zip.file("word/document.xml").async("string"), "application/xml");
    const p = [...doc.getElementsByTagNameNS(ns, "p")];
    const address = `P.E. Cabecicos Blancos – C/Molino Grande, S/N – Buzón ${data.box} – 30892 Librilla (Murcia)`;
    if (kind === "precio") {
      const slots = {
        2: [["[Ciudad]", "{{place}}"], ["[Día] DE [Mes] DE [Año]", "{{date}}"]],
        5: [["[Nombre de la empresa o agricultor]", "{{sellerName}}"]],
        6: [["[Número de identificación fiscal]", "{{sellerTaxId}}"]],
        7: [["[Dirección completa]", "{{sellerAddress}}"]],
        8: [["[Nombre del representante, si aplica]", "{{sellerRepresentative}}"], ["[Número de DNI]", "{{sellerDni}}"]],
        10: [["[Nombre de la empresa compradora]", data.name]],
        11: [["[Número de identificación fiscal]", data.nif]],
        12: [["[Dirección completa]", address]],
        13: [["[Nombre del representante]", "D. Juan Antonio Martínez Rubio"], ["[Número de DNI]", "52805756X"]],
        16: [["[Fecha del contrato original]", "{{originalDate}}"], ["[Indicar periodo, ej: 2026/2027]", "{{campaign}}"], ["[Introducir número si ya lo tienes]", "{{aicaReference}}"]],
        22: [["[Ej: Aceituna picual, Leche de vaca, etc.]", "{{product}}"]],
        23: [["[Indicar precio en euros]", "{{price}}"], ["[Unidad de medida, ej: kg, litro, tonelada]", "{{unit}}"], ["(indicar si incluye o excluye IVA)", "({{vat}})"]],
        24: [["[Explicar la fórmula claramente]", "{{priceFormula}}"]],
        31: [["[Nombre Vendedor]", "{{sellerSignatory}}"]],
        32: [["[Nombre Comprador]", "Juan Antonio Martínez Rubio"]],
      };
      for (const [index, pairs] of Object.entries(slots)) for (const [from, to] of pairs) replace(p[Number(index)], from, to);
      if (text(p[34]).trim() !== "Recuerda ant") throw new Error("La nota final del modelo ha cambiado; revisar antes de eliminar.");
      p[34].parentNode.removeChild(p[34]);
    } else {
      replace(p[3], text(p[3]), "En {{place}}, a {{date}}");
      const sellerPrefix = "LA PARTE VENDEDORA:";
      replace(p[4], text(p[4]).split(sellerPrefix)[1], "{{sellerName}}, con NIF/CIF {{sellerTaxId}} y domicilio en {{sellerAddress}}, representado/a en este acto por {{sellerRepresentative}}, con DNI {{sellerDni}}");
      const buyerPrefix = "LA PARTE COMPRADORA:";
      replace(p[5], text(p[5]).split(buyerPrefix)[1], `${data.name}, con NIF/CIF ${data.nif} y domicilio en ${address}, representado/a en este acto por D. Juan Antonio Martínez Rubio, con DNI 52805756X`);
      replace(p[7], text(p[7]).match(/con fecha (.*?), ambas partes/)[1], "{{originalDate}}");
      replace(p[7], text(p[7]).split("compraventa de ")[1].split(", el cual")[0], "{{product}}");
      replace(p[8], text(p[8]).split("código identificador ")[1], "{{aicaReference}}");
      replace(p[13], text(p[13]).split("variedad de producto ")[1].split(", manteniéndose")[0], "{{removedVariety}}");
    }
    // Keep the image box/anchor from the model. The TN logo is fitted into that box.
    if (company === "tonifruit") {
      zip.file("word/media/image1.png", await readFile(fittedLogo));
    }
    zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
    const core = zip.file("docProps/core.xml");
    if (core) zip.file("docProps/core.xml", (await core.async("string")).replace(/<(dc:creator|cp:lastModifiedBy)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, "<$1></$1>"));
    await writeFile(resolve(output, `${company}-anexo-${kind}.docx`), await zip.generateAsync({ type: "nodebuffer" }));
  }
}
process.stdout.write("Preparados cuatro modelos de anexo conservando los originales.\n");
