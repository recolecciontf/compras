import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import ts from "typescript";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = join(root, "tmp", "annex-tests");
await mkdir(dir, { recursive: true });
for (const name of ["contractAnnexData", "contractGenerator", "contractAnnex"]) {
  let source = await readFile(join(root, `src/lib/${name}.ts`), "utf8");
  source = source.replace('"./contractAnnexData"', '"./contractAnnexData.mjs"').replace('"./contractGenerator"', '"./contractGenerator.mjs"');
  await writeFile(join(dir, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const { validateAnnexFields, ANNEX_TEMPLATE_NAMES } = await import(pathToFileURL(join(dir, "contractAnnexData.mjs")));
const { generateContractAnnex, annexTemplateName, replaceAnnexToken } = await import(pathToFileURL(join(dir, "contractAnnex.mjs")));
const fields = { kind: "price", place: "Librilla", date: "2026-10-27", originalDate: "2026-10-01", aicaReference: "RCA-PRUEBA", product: "Limón Fino", priceMode: "fixed", price: "0,45", unit: "kg", vat: "excluded", priceFormula: "", removedVariety: "", remainingVarietiesConfirmed: false };
const purchase = { id: "TN-01", provider: "Agricultor de prueba", taxId: "NIF-PRUEBA", campaign: "2026/27", contractDetails: { buyerCompany: "TOÑIFRUIT, S.L.", sellerAddress: "Domicilio de prueba", sellerRepresentative: "", sellerDni: "", contractNumber: "TN-01" } };
const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

test("anexos: valida datos reales, fechas, precio objetivo y anulación parcial", () => {
  assert.equal(validateAnnexFields(fields).price, "0,45");
  for (const patch of [{ aicaReference: "" }, { date: "2026-99-12" }, { date: "2026-09-30" }, { price: "0" }, { price: "abc" }, { priceMode: "variable" }, { kind: "invalid" }, { place: "{{date}}" }, { kind: "partial_cancellation", removedVariety: "Fino" }]) assert.throws(() => validateAnnexFields({ ...fields, ...patch }));
  assert.equal(validateAnnexFields({ ...fields, kind: "partial_cancellation", removedVariety: "Fino", remainingVarietiesConfirmed: true }).kind, "partial_cancellation");
});
test("anexos: modelo específico por empresa y tipo, sin alternativa a empresa vacía", () => {
  assert.equal(ANNEX_TEMPLATE_NAMES.length, 4);
  assert.equal(annexTemplateName("TOÑIFRUIT, S.L.", fields), "tonifruit-anexo-precio.docx");
  assert.equal(annexTemplateName("MR. ORGÁNICA, S.L.", { ...fields, kind: "partial_cancellation" }), "mro-anexo-anulacion.docx");
  assert.throws(() => annexTemplateName("", fields));
});
test("anexos: sustituye marcadores divididos sin cambiar propiedades ni texto legal", () => {
  const doc = new DOMParser().parseFromString(`<w:p xmlns:w="${ns}"><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Legal {{sel</w:t></w:r><w:r><w:t>lerName}} final</w:t></w:r></w:p>`, "application/xml");
  assert.equal(replaceAnnexToken(doc.documentElement, "{{sellerName}}", "Prueba & Cía"), true);
  assert.equal(doc.documentElement.textContent, "Legal Prueba & Cía final");
  assert.equal(doc.getElementsByTagNameNS(ns, "b").length, 1);
  assert.equal(doc.getElementsByTagNameNS(ns, "keepNext").length, 1);
});
test("anexos: conserva geometría, excluye precio opcional y exige todos los huecos", async () => {
  const zip = new JSZip();
  const xml = `<w:document xmlns:w="${ns}"><w:body><w:p><w:r><w:t>Contrato {{originalDate}} {{sellerName}}</w:t></w:r></w:p><w:p><w:r><w:t>Representado {{sellerRepresentative}} DNI {{sellerDni}}</w:t></w:r></w:p><w:p><w:r><w:t>Precio {{price}} {{unit}} {{vat}}</w:t></w:r></w:p><w:p><w:r><w:t>Fórmula {{priceFormula}}</w:t></w:r></w:p><w:p><w:r><w:t>Cláusula legal inalterada.</w:t></w:r></w:p><w:sectPr><w:pgMar w:top="1234"/></w:sectPr></w:body></w:document>`;
  zip.file("word/document.xml", xml); zip.file("word/styles.xml", "PRESERVE");
  const input = await zip.generateAsync({ type: "arraybuffer" });
  for (const mode of ["fixed", "variable"]) {
    const result = await generateContractAnnex(input, purchase, { ...fields, priceMode: mode, priceFormula: "Índice pactado × 0,9" }, "docx");
    const output = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const text = await output.file("word/document.xml").async("string");
    assert.match(text, /Cláusula legal inalterada/); assert.match(text, /w:top="1234"/); assert.doesNotMatch(text, /\{\{|Representado/);
    assert.equal(await output.file("word/styles.xml").async("string"), "PRESERVE");
    if (mode === "fixed") assert.doesNotMatch(text, /Fórmula/); else assert.doesNotMatch(text, /Precio/);
  }
  await assert.rejects(() => generateContractAnnex(input, { ...purchase, taxId: "" }, fields, "docx"));
  zip.file("word/document.xml", xml.replace("{{unit}}", "{{unknown}}"));
  await assert.rejects(() => zip.generateAsync({ type: "arraybuffer" }).then(data => generateContractAnnex(data, purchase, fields, "docx")), /sin resolver/);
});
