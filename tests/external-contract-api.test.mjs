import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
const { default: worker } = await import(new URL(`../dist/server/index.js?external=${Date.now()}`, import.meta.url));

test("contratos externos: datos mínimos, originales privados, anexos, firmas, reintentos y ningún cambio de compras", async () => {
  const objects = new Map();
  const env = {
    ADMIN_USERNAME: "ADMIN", ADMIN_PASSWORD_SHA256: createHash("sha256").update("external-admin-test").digest("hex"),
    VIEWER_USERNAME: "CONSULTA", VIEWER_PASSWORD_SHA256: createHash("sha256").update("external-viewer-test").digest("hex"),
    APP_USERS_JSON: JSON.stringify([{ username: "EDITOR", displayName: "Editor de prueba", role: "editor", passwordHash: createHash("sha256").update("external-editor-test").digest("hex") }]),
    SESSION_SECRET: "external-test-secret-at-least-thirty-two-characters",
    CONTRACT_FILES: {
      async put(key, body, options) { objects.set(key, { body, ...options }); },
      async get(key) { return objects.get(key) || null; },
      async list({ prefix = "" } = {}) { return { objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false }; },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Los anexos externos no deben acceder a Sheets ni enviar correos"); };
  const api = (path, init = {}) => worker.fetch(new Request(`https://test.example${path}`, init), env);
  const data = {
    buyerCompany: "MR. ORGÁNICA, S.L.", contractNumber: "EXTERNO-PRUEBA-34", originalDate: "2026-10-01", campaign: "2026/27",
    provider: "Proveedor externo de prueba", taxId: "NIF-PRUEBA", sellerAddress: "Dirección de prueba", sellerTreatment: "",
    sellerRepresentative: "", sellerDni: "", sellerRepresentativeAddress: "", product: "5000 kg Limón Fino",
  };
  const zip = new JSZip(); zip.file("word/document.xml", "<test/>");
  const docx = new Blob([await zip.generateAsync({ type: "arraybuffer" })], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const pdf = new Blob(["%PDF-1.7\nOriginal de prueba, no modificar"], { type: "application/pdf" });
  const makeContract = (values = data, file = null, filename = "contrato.pdf") => {
    const form = new FormData(); form.set("data", JSON.stringify(values)); if (file) form.set("file", file, filename); return form;
  };
  try {
    const login = async (username, password) => {
      const response = await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      assert.equal(response.status, 200); return { Authorization: `Bearer ${(await response.json()).token}` };
    };
    const headers = await login("ADMIN", "external-admin-test");
    const viewer = await login("CONSULTA", "external-viewer-test");
    const editor = await login("EDITOR", "external-editor-test");
    const endpoint = "/api/external-contracts";
    assert.equal((await api(endpoint)).status, 401);
    assert.equal((await api(endpoint, { headers: viewer })).status, 403);
    assert.equal((await api(endpoint, { method: "POST", headers: viewer })).status, 403);
    for (const patch of [{ campaign: "" }, { originalDate: "" }, { originalDate: "2026-02-30" }, { contractNumber: "" }, { product: "" }, { buyerCompany: "OTRA" }, { sellerRepresentative: "Persona", sellerDni: "" }, { provider: "{{token}}" }]) {
      assert.equal((await api(endpoint, { method: "POST", headers, body: makeContract({ ...data, ...patch }) })).status, 400);
    }
    assert.equal((await api(endpoint, { method: "POST", headers, body: makeContract(data, new Blob(["no es PDF"]), "contrato.pdf") })).status, 400);
    const created = await api(endpoint, { method: "POST", headers, body: makeContract(data, pdf) });
    assert.equal(created.status, 201, await created.clone().text());
    const record = (await created.json()).contract;
    assert.match(record.id, /^EXT-[a-f0-9]{32}$/);
    assert.deepEqual(record.data, data); assert.equal(record.createdBy, "Administrador");
    assert.equal(await new Response(objects.get(record.source.archiveId).body).text(), await pdf.text());
    assert.equal(objects.get(record.source.archiveId).customMetadata.documentKind, "external_contract_original");
    const retry = await api(endpoint, { method: "POST", headers, body: makeContract() });
    assert.equal((await retry.json()).contract.source.archiveId, record.source.archiveId);
    const conflict = await api(endpoint, { method: "POST", headers, body: makeContract({ ...data, sellerAddress: "Otra dirección" }) });
    assert.equal(conflict.status, 409);
    const list = await api(endpoint, { headers });
    assert.match(list.headers.get("Cache-Control"), /no-store/); assert.equal((await list.json()).contracts.length, 1);
    const fields = { kind: "price", place: "Librilla", date: "2026-11-16", originalDate: data.originalDate, aicaReference: "RCA-PRUEBA", product: data.product, priceMode: "fixed", price: "0,45", unit: "kg", vat: "excluded", priceFormula: "", removedVariety: "", remainingVarietiesConfirmed: false };
    const annexId = randomUUID();
    const annexEndpoint = `${endpoint}/${record.id}/annexes`;
    const annexForm = (patch = {}, signed = false, fieldPatch = {}) => {
      const form = new FormData(); form.set("file", signed ? pdf : docx, signed ? "firmado.pdf" : "anexo.docx");
      form.set("expectedId", record.id); form.set("expectedRevision", record.revision); form.set("annexId", annexId); form.set("fields", JSON.stringify({ ...fields, ...fieldPatch }));
      form.set("provider", "FALSO"); form.set("buyerCompany", "FALSA"); form.set("contractNumber", "FALSO");
      for (const [key, value] of Object.entries(patch)) form.set(key, value);
      return form;
    };
    assert.equal((await api(annexEndpoint, { headers: viewer })).status, 403);
    assert.equal((await api(annexEndpoint, { method: "POST", headers: viewer })).status, 403);
    assert.equal((await api(annexEndpoint, { method: "POST", headers, body: annexForm({ expectedRevision: "obsoleto" }) })).status, 409);
    assert.equal((await api(annexEndpoint, { method: "POST", headers, body: annexForm({ expectedId: "otro" }) })).status, 400);
    assert.equal((await api(annexEndpoint, { method: "POST", headers, body: annexForm({}, false, { originalDate: "2026-10-02" }) })).status, 400);
    const response = await api(annexEndpoint, { method: "POST", headers, body: annexForm() });
    assert.equal(response.status, 201, await response.clone().text());
    const annex = (await response.json()).annex;
    assert.equal(annex.contractReference, data.contractNumber); assert.equal(annex.company, data.buyerCompany);
    assert.equal(objects.get(annex.draft.archiveId).customMetadata.provider, data.provider);
    assert.equal(objects.get(annex.draft.archiveId).customMetadata.contractNumber, data.contractNumber);
    assert.equal((await (await api(annexEndpoint, { method: "POST", headers, body: annexForm() })).json()).annex.draft.archiveId, annex.draft.archiveId);
    const signedEndpoint = `${annexEndpoint}/${annexId}/signed`;
    const results = await Promise.all([api(signedEndpoint, { method: "POST", headers, body: annexForm({}, true) }), api(signedEndpoint, { method: "POST", headers, body: annexForm({}, true) })]);
    assert.ok(results.every(result => result.status === 201));
    const otherDevice = await login("ADMIN", "external-admin-test");
    const saved = (await (await api(annexEndpoint, { headers: otherDevice })).json()).annexes[0];
    assert.equal(saved.signedCopies.length, 2); assert.equal(saved.draft.archiveId, annex.draft.archiveId);
    const manual = await api(endpoint, { method: "POST", headers, body: makeContract({ ...data, buyerCompany: "TOÑIFRUIT, S.L.", contractNumber: "TN-EXTERNO-PRUEBA" }) });
    assert.equal(manual.status, 201); assert.equal((await manual.json()).contract.source, null);
    const word = await api(endpoint, { method: "POST", headers, body: makeContract({ ...data, contractNumber: "WORD-PRUEBA" }, docx, "original.docx") });
    assert.equal(word.status, 201);
    assert.equal((await (await api(endpoint, { headers: otherDevice })).json()).contracts.length, 3);
    const editorCreated = await api(endpoint, { method: "POST", headers: editor, body: makeContract({ ...data, contractNumber: "EDITOR-PRUEBA" }) });
    assert.equal(editorCreated.status, 201); assert.equal((await editorCreated.json()).contract.createdBy, "Editor de prueba");
    assert.deepEqual(JSON.parse(await new Response(objects.get(`external-contracts/${record.id}.json`).body).text()).data, data);
    const activity = [...objects.entries()].filter(([key]) => key.startsWith("audit/")).map(([, value]) => JSON.parse(new TextDecoder().decode(value.body)));
    for (const action of ["contract.external.create", "contract.annex.create", "contract.annex.signed"]) assert.ok(activity.some(entry => entry.action === action && entry.status === "completed"));
    assert.ok([...objects.keys()].every(key => !key.startsWith("row-backups/")));
  } finally { globalThis.fetch = originalFetch; }
});
