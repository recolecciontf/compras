import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(join(root, "tmp"), { recursive: true });
const compiled = await mkdtemp(join(root, "tmp", "purchase-fields-test-"));
after(() => rm(compiled, { recursive: true, force: true }));
for (const [source, target] of [
  ["src/lib/catalog.ts", "catalog.mjs"],
  ["src/components/PurchaseFields.tsx", "PurchaseFields.mjs"],
]) {
  const input = (await readFile(join(root, source), "utf8")).replace('"../lib/catalog"', '"./catalog.mjs"');
  const { outputText } = ts.transpileModule(input, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } });
  await writeFile(join(compiled, target), outputText);
}
const { PurchaseFields, EMPTY_PURCHASE } = await import(pathToFileURL(join(compiled, "PurchaseFields.mjs")));
const render = (value, contractMode = "generated") => renderToStaticMarkup(createElement(PurchaseFields, {
  value, contractMode, onChange: () => {},
}));

for (const mode of ["generated", "unsigned", "editing", "existing"]) {
  test(`ordena el formulario y evita duplicar fechas (${mode})`, () => {
    const html = render(structuredClone(EMPTY_PURCHASE), mode);
    const headings = [...html.matchAll(/class="field-section-heading[^\"]*"[\s\S]*?<strong>(.*?)<\/strong>/g)]
      .map((match) => match[1]);
    assert.deepEqual(headings, ["Agricultor y finca", "Materia prima", "Recolección",
      ...(mode === "existing" ? ["Contrato firmado existente"] : ["Precio y pago", "Datos de firma"]),
      "Información complementaria"]);
    for (const label of ["Inicio del contrato", "Fin del contrato", "DNI del representante", "Cortes (limpia o número de corte)", "Domicilio de la empresa / vendedor"]) {
      assert.equal(html.split(`<span>${label}</span>`).length - 1, 1, label);
    }
    assert.ok(html.indexOf("Agricultor / razón social") < html.indexOf("Representante del vendedor"));
    assert.ok(html.indexOf("Representante del vendedor") < html.indexOf("Materia prima</strong>"));
    assert.ok(html.indexOf("Domicilio de la empresa / vendedor") < html.indexOf("Representante del vendedor"));
    for (const label of ["Mínimo (mm)", "Máximo (mm)"]) {
      const input = html.split(`<span>${label}</span>`)[1].split("/>")[0];
      assert.ok(!/\brequired=/.test(input), `${label} debe seguir siendo opcional`);
    }
    for (const label of ["Correo del agricultor (opcional)", "Correo de la empresa (opcional)"]) {
      const input = html.split(`<span>${label}</span>`)[1].split("/>")[0];
      assert.ok(!/\brequired=/.test(input));
    }
  });
}

test("cortes admite limpia, números o texto libre sin valor automático", () => {
  for (const cut of ["", "Limpia", "2º corte", "Todo limón", "Cuarto corte zona norte"]) {
    const value = structuredClone(EMPTY_PURCHASE);
    value.contractDetails.cutDescription = cut;
    const html = render(value);
    const input = html.split("<span>Cortes (limpia o número de corte)</span>")[1].split("/>")[0];
    assert.ok(input.includes(`value="${cut}"`));
    assert.match(input, /\blist="[^"]+"/);
    assert.ok(html.includes('<option value="Limpia"'));
    assert.ok(html.includes("Recolección modalidad «A KILOS»"));
    assert.ok(html.indexOf("Cortes (limpia") < html.indexOf("Inicio del contrato"));
    assert.ok(html.indexOf("Inicio del contrato") < html.indexOf("Fin del contrato"));
    assert.ok(html.indexOf("Fin del contrato") < html.indexOf("Mínimo (mm)"));
  }
});

test("por tanto conserva el corte y las fechas, y muestra precio total", () => {
  const value = structuredClone(EMPTY_PURCHASE);
  Object.assign(value.contractDetails, { modality: "POR TANTO", cutDescription: "Limpia", totalPrice: "10000" });
  const html = render(value);
  assert.ok(html.includes("Fechas y corte"));
  assert.ok(!html.includes("Recolección modalidad «A KILOS»"));
  assert.ok(html.includes("Precio total (€)"));
  assert.ok(!html.includes("<span>Precio €/kg</span>"));
  assert.ok(html.includes('value="Limpia"'));
});
