import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import JSZip from "jszip";
const { default: worker, rowRevision } = await import(new URL(`../dist/server/index.js?annex=${Date.now()}`, import.meta.url));

test("anexos API: permisos, persistencia, empresa real, reintentos, firmas simultáneas y contrato intacto", async () => {
  const objects = new Map();
  const row = Array(40).fill("");
  row[0] = "TN-01"; row[1] = "Proveedor de prueba"; row[2] = "NIF-PRUEBA"; row[35] = "Activo";
  row[34] = JSON.stringify({ buyerCompany: "TOÑIFRUIT, S.L.", contractNumber: "TN-01", archiveId: "original-intacto" });
  const originalDetails = row[34];
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const env = {
    ADMIN_USERNAME: "ADMIN", ADMIN_PASSWORD_SHA256: createHash("sha256").update("test-admin").digest("hex"),
    VIEWER_USERNAME: "CONSULTA", VIEWER_PASSWORD_SHA256: createHash("sha256").update("test-viewer").digest("hex"),
    SESSION_SECRET: "annex-test-secret-at-least-thirty-two-characters", GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.invalid", GOOGLE_PRIVATE_KEY: privateKey,
    GOOGLE_SPREADSHEET_ID: "annex-test", GOOGLE_WORKSHEET_NAME: "Control documental", GOOGLE_DATA_START_ROW: "5", GOOGLE_DATA_END_ROW: "500",
    CONTRACT_FILES: {
      async put(key, body, options) { objects.set(key, { body, ...options }); },
      async get(key) { return objects.get(key) || null; },
      async list({ prefix = "" } = {}) { return { objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false }; },
    },
  };
  const originalFetch = globalThis.fetch;
  let sheetUpdates = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "test-token", expires_in: 3600 });
    if (url.includes("?fields=sheets.properties")) return Response.json({ sheets: [{ properties: { sheetId: 0, title: "Control documental", gridProperties: { columnCount: 40 } } }] });
    if (url.includes("sheets.googleapis.com") && init.method === "PUT") {
      assert.match(decodeURIComponent(url), /!AF4:AN4/); sheetUpdates++; return Response.json({});
    }
    if (url.includes("sheets.googleapis.com") && decodeURIComponent(url).includes("!A5:AN5")) return Response.json({ values: [row] });
    if (url.includes("sheets.googleapis.com") && decodeURIComponent(url).includes("!AF4:AN4")) return Response.json({ values: [[]] });
    throw new Error(`Petición inesperada durante la prueba: ${url}`);
  };
  const api = (path, init = {}) => worker.fetch(new Request(`https://test.example${path}`, init), env);
  try {
    async function login(username, password) {
      const response = await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      assert.equal(response.status, 200); return (await response.json()).token;
    }
    const token = await login("ADMIN", "test-admin");
    const viewer = await login("CONSULTA", "test-viewer");
    const headers = { Authorization: `Bearer ${token}` };
    const endpoint = "/api/rows/5/annexes";
    assert.equal((await api(`${endpoint}?expectedId=TN-01`)).status, 401);
    assert.equal((await api(`${endpoint}?expectedId=TN-01`, { headers: { Authorization: `Bearer ${viewer}` } })).status, 403);
    assert.equal((await api(endpoint, { method: "POST", headers: { Authorization: `Bearer ${viewer}` } })).status, 403);
    const fields = { kind: "price", place: "Librilla", date: "2026-10-27", originalDate: "2026-10-01", aicaReference: "RCA-PRUEBA", product: "Fino", priceMode: "fixed", price: "0,45", unit: "kg", vat: "excluded", priceFormula: "", removedVariety: "", remainingVarietiesConfirmed: false };
    const id = randomUUID();
    const zip = new JSZip(); zip.file("word/document.xml", "<test/>");
    const docx = new Blob([await zip.generateAsync({ type: "arraybuffer" })], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const revision = await rowRevision(row);
    function form(overrides = {}, signed = false) {
      const data = new FormData();
      data.set("file", signed ? new Blob(["%PDF-1.7\nPDF de prueba"], { type: "application/pdf" }) : docx, signed ? "firmado.pdf" : "anexo.docx");
      data.set("annexId", id); data.set("expectedId", "TN-01"); data.set("expectedRevision", revision); data.set("fields", JSON.stringify(fields));
      data.set("buyerCompany", "EMPRESA FALSA"); data.set("provider", "PROVEEDOR FALSO");
      for (const [key, value] of Object.entries(overrides)) data.set(key, value);
      return data;
    }
    assert.equal((await api(endpoint, { method: "POST", headers, body: form({ expectedId: "otro" }) })).status, 400);
    assert.equal((await api(endpoint, { method: "POST", headers, body: form({ expectedRevision: "obsoleto" }) })).status, 409);
    assert.equal((await api(endpoint, { method: "POST", headers, body: form({ fields: "{}" }) })).status, 400);
    const create = await api(endpoint, { method: "POST", headers, body: form() });
    assert.equal(create.status, 201, await create.clone().text());
    const saved = (await create.json()).annex;
    assert.equal(saved.company, "TOÑIFRUIT, S.L."); assert.equal(saved.createdBy, "Administrador");
    assert.equal(objects.get(saved.draft.archiveId).customMetadata.provider, "Proveedor de prueba");
    assert.equal(objects.get(saved.draft.archiveId).customMetadata.documentKind, "generated_annex");
    const retry = await api(endpoint, { method: "POST", headers, body: form() });
    assert.equal((await retry.json()).annex.draft.archiveId, saved.draft.archiveId);
    const list = await api(`${endpoint}?expectedId=TN-01`, { headers });
    assert.equal((await list.json()).annexes.length, 1);
    assert.match(list.headers.get("Cache-Control"), /no-store/);
    const signedUrl = `${endpoint}/${id}/signed`;
    assert.equal((await api(signedUrl, { method: "POST", headers, body: form({}, false) })).status, 400);
    const signed = await api(signedUrl, { method: "POST", headers, body: form({}, true) });
    assert.equal(signed.status, 201, await signed.clone().text());
    assert.equal((await signed.json()).annex.signedCopies.length, 1);
    const simultaneous = await Promise.all([api(signedUrl, { method: "POST", headers, body: form({}, true) }), api(signedUrl, { method: "POST", headers, body: form({}, true) })]);
    assert.ok(simultaneous.every(response => response.status === 201));
    const fresh = (await (await api(`${endpoint}?expectedId=TN-01`, { headers })).json()).annexes[0];
    assert.equal(fresh.signedCopies.length, 3);
    assert.equal(fresh.draft.archiveId, saved.draft.archiveId);
    const otherDevice = await login("ADMIN", "test-admin");
    assert.equal((await (await api(`${endpoint}?expectedId=TN-01`, { headers: { Authorization: `Bearer ${otherDevice}` } })).json()).annexes[0].id, id);
    assert.equal(row[34], originalDetails); assert.equal(sheetUpdates, 1);
    const activity = [...objects.entries()].filter(([key]) => key.startsWith("audit/")).map(([,value]) => JSON.parse(new TextDecoder().decode(value.body)));
    assert.ok(activity.some(entry => entry.action === "contract.annex.create" && entry.status === "completed"));
    assert.ok(activity.some(entry => entry.action === "contract.annex.signed" && entry.status === "completed"));
  } finally { globalThis.fetch = originalFetch; }
});
