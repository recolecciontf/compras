import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(join(root, "tmp"), { recursive: true });
const compiled = await mkdtemp(join(root, "tmp", "saved-contract-search-test-"));
after(() => rm(compiled, { recursive: true, force: true }));
for (const [source, target] of [["src/lib/savedContractSearch.ts", "savedContractSearch"], ["src/components/SavedContractPicker.tsx", "SavedContractPicker"], ["src/lib/copyReference.ts", "copyReference"]]) {
  const input = (await readFile(join(root, source), "utf8")).replace('"../lib/savedContractSearch"', '"./savedContractSearch.mjs"');
  await writeFile(join(compiled, `${target}.mjs`), ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText);
}
const { savedContractResults, purchaseContractOption } = await import(pathToFileURL(join(compiled, "savedContractSearch.mjs")));
const { SavedContractPicker } = await import(pathToFileURL(join(compiled, "SavedContractPicker.mjs")));
const { copyReference } = await import(pathToFileURL(join(compiled, "copyReference.mjs")));
const make = (id, provider, farm, crop, variety, tableIndex) => purchaseContractOption({ row: { tableIndex }, purchase: {
  id, provider, farm, crop, variety, taxId: "NIF-PRUEBA", municipality: "Murcia", campaign: "2026/27", contractStart: "2026-10-01", contractEnd: "2026-12-31",
  contractDetails: { contractNumber: id === "MR-07" ? "LEGADO-001" : id, signatureDate: "2026-10-01", archiveFilename: "contrato-prueba.pdf", draftArchiveFilename: "" },
  materials: [{ crop, variety, municipality: "Murcia", paraje: farm, polygon: "12", plot: "101" }],
} });
const options = [make("MR-07", "José Muñoz de Prueba", "El Limón", "Limón", "Fino", 9), make("MR-08", "Proveedor de Prueba", "La Torre", "Naranja", "Navelina", 8), make("TN-03", "Otro Proveedor", "Finca Norte", "Mandarina", "Clemenules", 7)];
const ids = query => savedContractResults(options, query).matches.map(option => option.value);

test("busca contratos por nombre, finca, especie, variedad y referencias sin tildes ni mayúsculas", () => {
  assert.deepEqual(ids("JOSE MUNOZ"), ["9"]);
  assert.deepEqual(ids("el limon fino"), ["9"]);
  assert.deepEqual(ids("NAVElina torre"), ["8"]);
  for (const reference of ["MR-07", "mr 07", "mr07", "legado001"]) assert.deepEqual(ids(reference), ["9"]);
  assert.deepEqual(ids("nif prueba murcia"), ["9", "8", "7"]);
  assert.deepEqual(ids("2026/27 clemenules"), ["7"]);
  assert.deepEqual(ids("no existe"), []);
});

test("la búsqueda no mezcla empresas, no cambia el orden ni altera los datos originales", () => {
  const snapshot = structuredClone(options);
  const mr = options.filter(option => option.label.startsWith("MR-"));
  assert.deepEqual(savedContractResults(mr, "tn03").matches, []);
  assert.deepEqual(ids(""), ["9", "8", "7"]);
  assert.deepEqual(ids("   "), ["9", "8", "7"]);
  assert.deepEqual(options, snapshot);
});

test("mantiene el contrato seleccionado aunque no coincida con la nueva búsqueda", () => {
  assert.equal(savedContractResults(options, "no existe", "9").selectedOutsideResults.value, "9");
  assert.equal(savedContractResults(options, "jose", "9").selectedOutsideResults, undefined);
  assert.equal(savedContractResults(options, "jose", "inexistente").selectedOutsideResults, undefined);
});

const render = props => renderToStaticMarkup(createElement(SavedContractPicker, { options, value: "", onChange() {}, label: "Compra guardada", placeholder: "Seleccionar compra", required: true, ...props }));
test("el selector ofrece una búsqueda accesible y solo las coincidencias", () => {
  const html = render({ initialQuery: "jose" });
  assert.match(html, /type="search"/); assert.match(html, /Buscar contrato/);
  assert.match(html, /1 de 3 contratos/); assert.match(html, /value="9"/);
  assert.doesNotMatch(html, /value="8"|value="7"/); assert.match(html, /Limpiar búsqueda de contratos/);
  assert.match(html, /<select required=""/);
});

test("sin coincidencias informa del resultado y conserva visible el contrato seleccionado", () => {
  const html = render({ initialQuery: "no existe", value: "9" });
  assert.match(html, /Contrato seleccionado/); assert.match(html, /value="9" selected=""/);
  assert.match(html, /0 de 3 contratos/);
  assert.match(render({ initialQuery: "no existe" }), /No hay contratos coincidentes/);
  assert.match(render({ disabled: true }), /disabled=""/);
});

test("copiar referencia copia únicamente el identificador y respeta los fallos del portapapeles", async () => {
  const copied = [];
  await copyReference(" MR-07 ", { async writeText(value) { copied.push(value); } });
  assert.deepEqual(copied, ["MR-07"]);
  await assert.rejects(copyReference("", { async writeText() { throw new Error("no debe ejecutarse"); } }), /no tiene referencia/);
  await assert.rejects(copyReference("MR-07", { async writeText() { throw new Error("denegado"); } }), /denegado/);
});
