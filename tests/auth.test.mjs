import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const workerUrl = new URL(`../dist/server/index.js?test=${Date.now()}`, import.meta.url);
const { default: worker } = await import(workerUrl.href);
const storedContracts = new Map();

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  ALLOWED_ORIGINS: "https://recolecciontf.github.io",
  ADMIN_USERNAME: "ADMINISTRADOR",
  ADMIN_PASSWORD_SHA256: createHash("sha256").update("admin-password").digest("hex"),
  VIEWER_USERNAME: "CONSULTAS",
  VIEWER_PASSWORD_SHA256: createHash("sha256").update("viewer-password").digest("hex"),
  SESSION_SECRET: "test-session-secret-that-is-long-enough-for-tests",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "unused@example.invalid",
  GOOGLE_PRIVATE_KEY: "unused",
  GOOGLE_SPREADSHEET_ID: "unused",
  CONTRACT_FILES: {
    async put(key, body, options) {
      storedContracts.set(key, { body, ...options });
    },
    async get(key) {
      return storedContracts.get(key) || null;
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) storedContracts.delete(key);
    },
  },
};

function api(path, init = {}) {
  return worker.fetch(new Request(`https://app.example${path}`, init), env);
}

test("sirve la PWA aunque el alojamiento no inyecte los archivos estÃ¡ticos", async () => {
  const response = await api("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Compras de campo/);
});

test("rechaza una contraseña incorrecta", async () => {
  const response = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recolecciontf.github.io" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "incorrecta" }),
  });
  assert.equal(response.status, 401);
});

test("crea una sesión temporal y permite consultar el perfil", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recolecciontf.github.io" },
    body: JSON.stringify({ username: "administrador", password: "admin-password" }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("access-control-allow-origin"), "https://recolecciontf.github.io");
  const { token } = await login.json();
  assert.ok(token);

  const profile = await api("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(profile.status, 200);
  assert.deepEqual(await profile.json(), {
    displayName: "Administrador",
    userPrincipalName: "ADMINISTRADOR",
    role: "admin",
    canEdit: true,
  });
});

test("el usuario de consulta no puede guardar cambios", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "CONSULTAS", password: "viewer-password" }),
  });
  const { token, profile } = await login.json();
  assert.equal(profile.role, "viewer");
  assert.equal(profile.canEdit, false);

  const save = await api("/api/rows/9/review", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ review: {} }),
  });
  assert.equal(save.status, 403);
  assert.match((await save.json()).error, /consulta/);

  const cancel = await api("/api/rows/9/status", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Anulado", reason: "Creado por error", expectedId: "CMP-TEST" }),
  });
  assert.equal(cancel.status, 403);

  const remove = await api("/api/rows/9", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedId: "CMP-TEST", confirmation: "CMP-TEST", acknowledgement: "ELIMINAR DEFINITIVAMENTE", reason: "Creado por error" }),
  });
  assert.equal(remove.status, 403);
});

test("protege las acciones destructivas con validación reforzada", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();

  const invalidStatus = await api("/api/rows/9/status", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Borrado", reason: "Creado por error", expectedId: "CMP-TEST" }),
  });
  assert.equal(invalidStatus.status, 400);
  assert.match((await invalidStatus.json()).error, /estado/);

  const insufficientConfirmation = await api("/api/rows/9", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedId: "CMP-TEST", confirmation: "otro", acknowledgement: "", reason: "Creado por error" }),
  });
  assert.equal(insufficientConfirmation.status, 400);
  assert.match((await insufficientConfirmation.json()).error, /identificador/);
});

test("exige los datos obligatorios al crear una compra", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();
  const create = await api("/api/rows", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ purchase: { provider: "Agricultor" } }),
  });
  assert.equal(create.status, 400);
  assert.match((await create.json()).error, /campos obligatorios/);
});

test("solo permite archivar compras con corte y kilos", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();
  const archive = await api("/api/rows/9/harvest", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ harvest: { cutStatus: "No", cutKgTotal: "", archived: "Sí" } }),
  });
  assert.equal(archive.status, 400);
  assert.match((await archive.json()).error, /Solo se puede archivar/);
});

test("archiva y descarga una copia firmada sin exponerla públicamente", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();
  const form = new FormData();
  form.set("file", new Blob(["contrato firmado"], { type: "application/pdf" }), "contrato-firmado.pdf");
  form.set("provider", "Agricultor de prueba");
  form.set("sellerEmail", "agricultor@example.test");
  form.set("companyEmail", "compras@example.test");
  form.set("contractNumber", "CMP-TEST-001");
  const upload = await api("/api/contract-files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(upload.status, 201);
  const archived = await upload.json();
  assert.equal(archived.archiveFilename, "contrato-firmado.pdf");
  assert.equal(archived.emailStatus, "pending_configuration");

  const unauthenticated = await api(`/api/contract-files/${archived.archiveId}`);
  assert.equal(unauthenticated.status, 401);

  const download = await api(`/api/contract-files/${archived.archiveId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /contrato-firmado\.pdf/);
  assert.equal(await download.text(), "contrato firmado");
});

test("rechaza el contrato si el archivo central no está configurado", async () => {
  const envWithoutArchive = { ...env, CONTRACT_FILES: undefined };
  const login = await worker.fetch(new Request("https://app.example/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  }), envWithoutArchive);
  const { token } = await login.json();
  const form = new FormData();
  form.set("file", new Blob(["contrato firmado"], { type: "application/pdf" }), "contrato-firmado.pdf");
  const upload = await worker.fetch(new Request("https://app.example/api/contract-files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  }), envWithoutArchive);
  assert.equal(upload.status, 500);
  assert.match((await upload.json()).error, /archivo central/);
});
