import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
const root = fileURLToPath(new URL("../", import.meta.url));
const compiled = join(root, "tmp", "contract-import-tests");
await mkdir(compiled, { recursive: true });
globalThis.DOMParser = DOMParser; globalThis.XMLSerializer = XMLSerializer;
const prototype = Object.getPrototypeOf(new DOMParser().parseFromString("<root/>", "application/xml").documentElement);
if (!("children" in prototype)) Object.defineProperty(prototype, "children", { get() { return [...this.childNodes].filter(node => node.nodeType === 1); } });
for (const name of ["catalog", "PurchaseFields", "contractImport"]) {
  const path = name === "PurchaseFields" ? "src/components" : "src/lib";
  let source = await readFile(join(root, `${path}/${name}.${name === "PurchaseFields" ? "tsx" : "ts"}`), "utf8");
  source = source.replace('"../lib/catalog"', '"./catalog.mjs"').replace('"./catalog"', '"./catalog.mjs"');
  if (name === "contractImport") source = source.replace('import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";', 'const pdfWorkerUrl = "test-worker.js";')
    .replace('await import("pdfjs-dist")', 'globalThis.__contractImportPdfTest')
    .replace('parsed.querySelector("parsererror")', 'parsed.getElementsByTagName("parsererror")[0]');
  await writeFile(join(compiled, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText);
}
const { importPurchaseFromContract } = await import(pathToFileURL(join(compiled, "contractImport.mjs")));
const { EMPTY_PURCHASE } = await import(pathToFileURL(join(compiled, "PurchaseFields.mjs")));
const seller = "Vendedor: Dña. Representante de Prueba, con DNI 00000000T, mayor de edad, con domicilio en Avenida del Representante 1, en representación y con poderes suﬁcientes de SOCIEDAD DE\nPRUEBA SL, con NIF B00000000, domiciliada en Calle del Vendedor 2, en adelante vendedor. Con número de operador ecológico: TEST-001.";
const buyer = "Comprador: D. Comprador de Prueba, con DNI 11111111H, en representación de MR. Orgánica, S.L., con NIF B73894065 domiciliada en Avenida del Comprador 3, en adelante comprador.";
const text = `CONTRATO DE COMPRAVENTA DE LIMONES ECOLÓGICOS\n${seller}\n${buyer}\nOPCIÓN 2: X 90000 kilogramos de limones procedentes de campo de las fincas que se relacionan:`;
const row1 = ["Fino", "", "CIUDAD A", "-", "11", "101, 102, 103", "", "50000"];
const row2 = ["Fino", "", "CIUDAD B", "-", "22", "201, 202", "", "40000"];
const headers = ["VARIEDAD", "SITUACIÓN", "TÉRMINO", "PARAJE", "POLÍGONO", "PARCELA", "Ha", "Kg aproximados"];
const headerX = [49.384, 115.642, 180.403, 241.133, 291.441, 351.738, 413.14, 469.749];
const dataX = [38.95, 106, 173.65, 230.35, 287.05, 343.75, 400, 442.95];
const item = (str, x, y) => ({ str, transform: [9, 0, 0, 9, x, y] });
async function pdfImport(header = headers, rows = [row1, row2], splitKg = false, body = text) {
  let items = body.split("\n").map((line, index) => item(line, 35, 780 - index * 14));
  items.push(...header.flatMap((label, index) => index === 7 && splitKg
    ? [item("Kg", headerX[index], 551), item("aproximados", headerX[index] + 13, 551)]
    : [item(label, headerX[index], 551)]));
  rows.forEach((row, rowIndex) => items.push(...row.map((value, index) => item(value, dataX[index], 540 - rowIndex * 11))));
  items.push(item("La identificación exacta de las parcelas se realizará con indicación SIG-PAC.", 35, 500));
  globalThis.__contractImportPdfTest = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items }), cleanup() {} }), async destroy() {} }) }) };
  return importPurchaseFromContract(new File(["synthetic PDF layout"], "test.pdf", { type: "application/pdf" }), "MR. ORGÁNICA, S.L.", structuredClone(EMPTY_PURCHASE));
}
for (const kg of ["Kg", "Kg aproximados", "Kg aprox.", "Kilogramos", "Kg previstos"]) {
  test(`importa dos fincas con cabecera ${kg}, celdas vacías y parcelas múltiples`, async () => {
    const result = await pdfImport([...headers.slice(0, -1), kg]);
    assert.equal(result.purchase.materials.length, 2);
    assert.equal(result.purchase.expectedKg, "90000");
    assert.deepEqual(result.purchase.materials.map(({ variety, expectedKg, municipality, polygon, plot, hectares, situation, paraje }) => ({ variety, expectedKg, municipality, polygon, plot, hectares, situation, paraje })), [
      { variety: "Fino", expectedKg: "50000", municipality: "CIUDAD A", polygon: "11", plot: "101, 102, 103", hectares: "", situation: "", paraje: "" },
      { variety: "Fino", expectedKg: "40000", municipality: "CIUDAD B", polygon: "22", plot: "201, 202", hectares: "", situation: "", paraje: "" },
    ]);
    assert.equal(result.purchase.contractDetails.sellerAddress, "Calle del Vendedor 2");
    assert.equal(result.purchase.contractDetails.sellerRepresentativeAddress, "Avenida del Representante 1");
    assert.equal(result.purchase.provider, "SOCIEDAD DE PRUEBA SL");
    assert.equal(result.purchase.taxId, "B00000000");
    assert.equal(result.purchase.contractDetails.sellerDni, "00000000T");
    assert.equal(result.purchase.contractDetails.sellerEmail, "");
    assert.equal(result.purchase.contractDetails.archiveId, "");
  });
}
test("reconoce cabecera kg dividida en varios fragmentos de texto PDF", async () => {
  assert.equal((await pdfImport(headers, [row1, row2], true)).purchase.materials.length, 2);
});
async function importTextAsWord(body) {
  const escape = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const paragraph = value => `<w:p><w:r><w:t>${escape(value)}</w:t></w:r></w:p>`;
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.split("\n").map(paragraph).join("")}<w:tbl>${[headers, row1, row2].map(row => `<w:tr>${row.map(cell => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl></w:body></w:document>`;
  const zip = new JSZip(); zip.file("word/document.xml", xml);
  const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  return importPurchaseFromContract(file, "MR. ORGÁNICA, S.L.", structuredClone(EMPTY_PURCHASE));
}
test("Word conserva la misma tabla y separa el domicilio del vendedor del representante", async () => {
  const result = await importTextAsWord(text);
  assert.equal(result.purchase.materials.length, 2);
  assert.equal(result.purchase.expectedKg, "90000");
  assert.equal(result.purchase.contractDetails.sellerAddress, "Calle del Vendedor 2");
  assert.equal(result.purchase.contractDetails.sellerRepresentativeAddress, "Avenida del Representante 1");
  assert.equal(result.purchase.contractDetails.sellerTreatment, "Dña.");
});

for (const representation of ["en representación y con poderes de", "en representación y con poderes suficientes de", "en representacion\ny con poderes de"]) {
  for (const comma of ["", ","]) {
    test(`direcciones: corta el texto legal con «${representation.replace(/\n/g, " ")}» y ${comma ? "con" : "sin"} comas`, async () => {
      const body = `CONTRATO DE LIMONES\nVendedor: Dña. Representante de Prueba, con DNI 00000000T, con domicilio en Avenida del Representante 1${comma} ${representation} SOCIEDAD DE\nPRUEBA SL${comma} con NIF B00000000, domiciliada en Calle del Vendedor 2${comma} en adelante vendedor. Con número de operador ecológico TEST-001.\n${buyer}`;
      const result = await importTextAsWord(body);
      assert.equal(result.purchase.contractDetails.sellerAddress, "Calle del Vendedor 2");
      assert.equal(result.purchase.contractDetails.sellerRepresentativeAddress, "Avenida del Representante 1");
      assert.equal(result.purchase.provider, "SOCIEDAD DE PRUEBA SL");
      for (const address of [result.purchase.contractDetails.sellerAddress, result.purchase.contractDetails.sellerRepresentativeAddress]) assert.doesNotMatch(address, /en\s+representaci[oó]n|con\s+poderes|NIF|operador|en\s+adelante/i);
    });
  }
}
for (const ending of ["en representación y con poderes de otra persona", ", con poderes suficientes para este acto", "; actuando en nombre de otra persona", ", en adelante vendedor", " Con número de operador ecológico: TEST-001", " Código registro AILIMPO TEST-002"]) {
  test(`direcciones: nunca incorpora la cláusula posterior «${ending.trim()}»`, async () => {
    const result = await importTextAsWord(`CONTRATO DE LIMONES\nVendedor: D. Persona de Prueba, con DNI 00000000T, con domicilio en Carretera Nacional 1, km 2, Murcia ${ending}\n${buyer}`);
    assert.equal(result.purchase.contractDetails.sellerAddress, "Carretera Nacional 1, km 2, Murcia");
  });
}
test("direcciones: conserva la dirección completa y no hereda la dirección del comprador", async () => {
  const result = await importTextAsWord(`CONTRATO DE LIMONES\nVendedor: D. Persona de Prueba, con DNI 00000000T, con domicilio en C/ de los Poderes, nº 14, 3º A, 30000 Murcia\nY de la otra parte, ${buyer}`);
  assert.equal(result.purchase.contractDetails.sellerAddress, "C/ de los Poderes, no 14, 3o A, 30000 Murcia");
  assert.equal(result.purchase.contractDetails.sellerRepresentativeAddress, "");
});

test("PDF: no prolonga la dirección cuando el texto pierde las comas y la palabra suficientes", async () => {
  const body = text.replace(/suﬁcientes /g, "").replace(/, en representación/g, " en representación").replace(/, con NIF/g, " con NIF");
  const result = await pdfImport(headers, [row1, row2], false, body);
  assert.equal(result.purchase.contractDetails.sellerAddress, "Calle del Vendedor 2");
  assert.equal(result.purchase.contractDetails.sellerRepresentativeAddress, "Avenida del Representante 1");
  assert.equal(result.purchase.materials.length, 2);
  assert.equal(result.purchase.expectedKg, "90000");
});
