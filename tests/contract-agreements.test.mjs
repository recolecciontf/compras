import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const prototype = Object.getPrototypeOf(new DOMParser().parseFromString("<root/>", "application/xml").documentElement);
if (!("children" in prototype)) Object.defineProperty(prototype, "children", {
  get() { return Array.from(this.childNodes).filter((child) => child.nodeType === 1); },
});
if (!("append" in prototype)) prototype.append = function (...nodes) { nodes.forEach((node) => this.appendChild(node)); };
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(join(root, "tmp"), { recursive: true });
const compiled = await mkdtemp(join(root, "tmp", "contract-agreements-test-"));
after(() => rm(compiled, { recursive: true, force: true }));
const source = await readFile(join(root, "src/lib/contractGenerator.ts"), "utf8");
const { outputText } = ts.transpileModule(`${source}\nexport { fillAgreementSlot, fillDestrioSlot };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
await writeFile(join(compiled, "generator.mjs"), outputText);
const { fillAgreementSlot, fillDestrioSlot } = await import(pathToFileURL(join(compiled, "generator.mjs")));
const parse = (xml) => new DOMParser().parseFromString(xml, "application/xml");
const text = (element) => Array.from(element.getElementsByTagNameNS(w, "t")).map((node) => node.textContent).join("");
const xml = (element) => new XMLSerializer().serializeToString(element);
const paragraph = (content) => `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${content}</w:t></w:r></w:p>`;

for (const label of [
  "Se minorarán los kilos de Mandarinas con los siguientes defectos:",
  "Se minorarán los kilos de Naranja con los siguientes defectos:",
  "Se minorarán los kilos  con los siguientes defectos:",
  "Las partes podrán acordar otro tipo de minoraciones que deberán quedar reflejadas de forma expresa:",
  "Cualquier acuerdo entre las partes de minoración o descuento en el precio deberá especificarse aquí o en documento anexo:",
]) {
  test(`rellena el hueco superior sin alterar otros acuerdos: ${label}`, () => {
    const doc = parse(`<w:document xmlns:w="${w}"><w:body><w:tc>${paragraph(`${label} __________`)}</w:tc>${paragraph("13.o OTROS ACUERDOS: Texto fijo del modelo.")}</w:body></w:document>`);
    const scope = doc.getElementsByTagNameNS(w, "tc")[0];
    const others = doc.getElementsByTagNameNS(w, "p")[1];
    const before = xml(others);
    assert.equal(fillDestrioSlot(scope, "Destrío en campo: Bola, Rajada, Mosca, Araña."), true);
    assert.ok(text(scope).startsWith(label));
    assert.ok(text(scope).includes("Bola, Rajada, Mosca, Araña"));
    assert.equal(xml(others), before);
    assert.equal(scope.getElementsByTagNameNS(w, "sz")[0].getAttributeNS(w, "val"), "20");
  });
}

test("no utiliza el apartado de otros acuerdos como hueco de destrío", () => {
  const doc = parse(`<w:tc xmlns:w="${w}">${paragraph("13.o OTROS ACUERDOS: __________")}</w:tc>`);
  const before = xml(doc);
  assert.equal(fillDestrioSlot(doc.documentElement, "Destrío en almacén: Rajada."), false);
  assert.equal(xml(doc), before);
});

test("mantiene vacíos los porcentajes anteriores y todos los textos fijos", () => {
  const doc = parse(`<w:tc xmlns:w="${w}">${paragraph("Alternativamente ____ % o ______ kg. Las partes podrán acordar minoraciones de forma expresa: ________")}</w:tc>`);
  assert.equal(fillDestrioSlot(doc.documentElement, "Destrío en almacén: Mosca."), true);
  assert.equal(text(doc), "Alternativamente ____ % o ______ kg. Las partes podrán acordar minoraciones de forma expresa: Destrío en almacén: Mosca.");
});

test("inserta otros acuerdos sin borrar el texto habitual ni unir palabras", () => {
  const doc = parse(`<w:tc xmlns:w="${w}">${paragraph("14o. OTROS ACUERDOS Y/O OBSERVACIONES. ______El vendedor se compromete a cuidar la cosecha.")}</w:tc>`);
  const p = doc.getElementsByTagNameNS(w, "p")[0];
  assert.equal(fillAgreementSlot(p, /14o\. OTROS ACUERDOS Y\/O OBSERVACIONES\./, "Condición adicional."), true);
  assert.equal(text(p), "14o. OTROS ACUERDOS Y/O OBSERVACIONES. Condición adicional. El vendedor se compromete a cuidar la cosecha.");
});

test("añade acuerdos sin sobrescribir un modelo sin subrayados", () => {
  const doc = parse(`<w:tc xmlns:w="${w}">${paragraph("13.o OTROS ACUERDOS: El vendedor se compromete a cuidar la cosecha.")}</w:tc>`);
  const p = doc.getElementsByTagNameNS(w, "p")[0];
  assert.equal(fillAgreementSlot(p, /13\.o OTROS ACUERDOS:/, "Condición adicional."), true);
  assert.equal(text(p), "13.o OTROS ACUERDOS: El vendedor se compromete a cuidar la cosecha. Condición adicional.");
});
