import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const workerUrl = new URL(`../dist/server/index.js?test=${Date.now()}`, import.meta.url);
const { default: worker, driveBackupFolderId, enrichRowsFromPrivateCatalog, nextPurchaseIdForCompany, rowRevision, validatePurchase, verifyExpectedRevision } = await import(workerUrl.href);
const storedContracts = new Map();

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  ALLOWED_ORIGINS: "https://recolecciontf.github.io",
  ADMIN_USERNAME: "ADMINISTRADOR",
  ADMIN_PASSWORD_SHA256: createHash("sha256").update("admin-password").digest("hex"),
  VIEWER_USERNAME: "CONSULTAS",
  VIEWER_PASSWORD_SHA256: createHash("sha256").update("viewer-password").digest("hex"),
  APP_USERS_JSON: JSON.stringify([{
    username: "MIGUEL.ANGEL",
    displayName: "Miguel Ángel",
    role: "editor",
    passwordHash: createHash("sha256").update("editor-password").digest("hex"),
  }]),
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
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      const keys = [...storedContracts.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const objects = keys.slice(start, start + limit).map((key) => ({ key }));
      const next = start + objects.length;
      return { objects, truncated: next < keys.length, cursor: next < keys.length ? String(next) : undefined };
    },
  },
};

function api(path, init = {}) {
  return worker.fetch(new Request(`https://app.example${path}`, init), env);
}

test("separa la copia externa por empresa y mantiene una carpeta general de respaldo", () => {
  const folders = {
    GOOGLE_DRIVE_BACKUP_FOLDER_ID: "general",
    GOOGLE_DRIVE_TN_FOLDER_ID: "tonifruit",
    GOOGLE_DRIVE_MR_FOLDER_ID: "mr-organica",
  };
  assert.equal(driveBackupFolderId(folders, "TOÑIFRUIT, S.L.", "TN-01"), "tonifruit");
  assert.equal(driveBackupFolderId(folders, "MR. ORGÁNICA, S.L.", "MR-01"), "mr-organica");
  assert.equal(driveBackupFolderId(folders, "", "SIN-REFERENCIA"), "general");
});

test("duplica en Google Drive el contrato que se archiva", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();
  const driveEnv = {
    ...env,
    GOOGLE_DRIVE_BACKUP_FOLDER_ID: "general-folder",
    GOOGLE_DRIVE_TN_FOLDER_ID: "tonifruit-folder",
    GOOGLE_DRIVE_MR_FOLDER_ID: "mr-folder",
    GOOGLE_DRIVE_BACKUP_WEBHOOK_URL: "https://script.example.invalid/backup",
    GOOGLE_DRIVE_BACKUP_WEBHOOK_TOKEN: "test-backup-token",
  };
  const originalFetch = globalThis.fetch;
  let uploadedBody = "";
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === driveEnv.GOOGLE_DRIVE_BACKUP_WEBHOOK_URL) {
      uploadedBody = String(init.body || "");
      return Response.json({ ok: true, id: "drive-file-1", name: "copia-contrato.pdf" });
    }
    throw new Error(`Petición externa inesperada: ${url}`);
  };
  try {
    const form = new FormData();
    form.set("file", new Blob(["copia independiente"], { type: "application/pdf" }), "contrato.pdf");
    form.set("provider", "Agricultor de respaldo");
    form.set("contractNumber", "TN-01");
    form.set("buyerCompany", "TOÑIFRUIT, S.L.");
    form.set("sendCopies", "false");
    const upload = await worker.fetch(new Request("https://app.example/api/contract-files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }), driveEnv);
    assert.equal(upload.status, 201);
    const archived = await upload.json();
    assert.equal(archived.driveBackupStatus, "stored");
    assert.equal(archived.driveBackupFileId, "drive-file-1");
    assert.match(uploadedBody, /tonifruit-folder/);
    assert.match(uploadedBody, /TN-01/);
    assert.match(uploadedBody, /Agricultor de respaldo/);
    assert.equal(storedContracts.get(archived.archiveId).customMetadata.driveBackupStatus, "stored");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("incluye Naturland para los titulares confirmados", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();
  const response = await api("/api/control-catalog", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const { certificates } = await response.json();
  const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const holders = ["Toñifruit", "Martínez Romero Bibio", "MR Orgánica", "Agrollans", "Patatas Alcalde"];
  for (const holder of holders) {
    assert.ok(certificates.some((record) => (
      normalize(record.farmer).includes(normalize(holder))
      && normalize(record.certification) === "naturland"
    )), `Falta Naturland para ${holder}`);
  }
});

test("identifica al usuario personal y conserva su nombre en la sesión", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "miguel.angel", password: "editor-password" }),
  });
  assert.equal(login.status, 200);
  const { token, profile: loginProfile } = await login.json();
  assert.deepEqual(loginProfile, {
    displayName: "Miguel Ángel",
    userPrincipalName: "MIGUEL.ANGEL",
    role: "editor",
    canEdit: true,
  });

  const profile = await api("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(profile.status, 200);
  assert.deepEqual(await profile.json(), loginProfile);

  const audit = await api("/api/audit-events", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(audit.status, 403);
});

test("registra los cambios con el usuario que los realiza", async () => {
  for (const key of [...storedContracts.keys()]) {
    if (key.startsWith("audit/events/")) storedContracts.delete(key);
  }
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();
  const update = await api("/api/control-catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ certificates: [], opfhMembers: [], farms: [], documents: [] }),
  });
  assert.equal(update.status, 200);

  const auditResponse = await api("/api/audit-events?limit=10", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(auditResponse.status, 200);
  const { events } = await auditResponse.json();
  assert.equal(events.length, 1);
  assert.equal(events[0].actorUsername, "ADMINISTRADOR");
  assert.equal(events[0].actorDisplayName, "Administrador");
  assert.equal(events[0].action, "catalog.update");
  assert.equal(events[0].status, "completed");
  storedContracts.delete("catalog/control-documental.json");
});

test("un contrato nuevo no hereda el PDF histórico del agricultor", () => {
  const values = Array.from({ length: 35 }, () => "");
  values[0] = "MRO-032";
  values[1] = "ISIDRO MIÑANO RUIZ";
  values[5] = "Limón";
  values[7] = "Pendiente de firma";
  values[34] = JSON.stringify({
    contractOrigin: "generated",
    contractNumber: "MRO-032",
    buyerCompany: "MR. ORGÁNICA, S.L.",
    signatureMethod: "external_pending",
    archiveId: "",
  });
  const [result] = enrichRowsFromPrivateCatalog([{ index: 41, values }]);
  const details = JSON.parse(result.values[34]);
  assert.equal(result.values[7], "Pendiente de firma");
  assert.equal(details.contractOrigin, "generated");
  assert.equal(details.archiveId, "");
});

test("permite crear una compra sin correos cuyo nuevo contrato se firmará más tarde", () => {
  const purchase = {
    id: "MRO-032",
    provider: "ISIDRO MIÑANO RUIZ",
    taxId: "27433413W",
    farm: "LIBRILLA",
    municipality: "LIBRILLA",
    crop: "Limón",
    variety: "Rodrejo",
    expectedKg: "5000",
    campaign: "2026",
    registeredIca: "Pendiente",
    contractSigned: "Pendiente de firma del vendedor",
    contractStart: "2026-08-21",
    contractEnd: "2026-09-30",
    documentPath: "Pendiente de devolución y archivo central",
    otherAgreements: "",
    materials: [{ id: "parcela-1", crop: "Limón", variety: "Rodrejo", expectedKg: "5000", situation: "", municipality: "LIBRILLA", paraje: "", polygon: "3", plot: "810", hectares: "" }],
    contractDetails: {
      contractOrigin: "generated",
      buyerCompany: "MR. ORGÁNICA, S.L.",
      signatureDate: "2026-08-21",
      contractNumber: "MRO-032",
      sellerTreatment: "",
      sellerRepresentative: "",
      sellerDni: "",
      sellerRepresentativeAddress: "",
      sellerAddress: "",
      organicOperatorCode: "",
      modality: "A KILOS",
      collectionBy: "Comprador",
      transportBy: "Comprador",
      cutMinMm: "55",
      cutMaxMm: "75",
      priceAgreement: "IMPORTE",
      pricePerKg: "0.1",
      totalPrice: "",
      paymentDays: "30",
      applyDestrio: "Sí",
      destrioLocation: "Almacén",
      destrioDefects: "SE REALIZARÁ DESTRÍO EN ALMACÉN",
      destrioPrice: "0",
      signatureMethod: "external_pending",
      sellerSignedAt: "",
      sellerEmail: "",
      companyEmail: "",
    },
  };
  assert.doesNotThrow(() => validatePurchase(purchase));
  purchase.contractDetails.sellerRepresentative = "REPRESENTANTE DE PRUEBA";
  assert.throws(() => validatePurchase(purchase), /DNI del representante/i);
  purchase.contractDetails.sellerDni = "00000000T";
  purchase.contractDetails.destrioLocation = "Campo";
  purchase.contractDetails.destrioDefects = "Bola, Rajada, Mosca, Araña";
  assert.doesNotThrow(() => validatePurchase(purchase));
  purchase.contractDetails.destrioPrice = "";
  assert.doesNotThrow(() => validatePurchase(purchase));
  purchase.contractDetails.destrioDefects = "";
  assert.throws(() => validatePurchase(purchase), /defectos del destrío/i);
});

test("valida los calibres indicados sin hacerlos obligatorios", () => {
  const purchase = {
    id: "TN-01",
    provider: "Proveedor de prueba",
    taxId: "B00000000",
    farm: "Finca de prueba",
    municipality: "Municipio de prueba",
    crop: "Uva",
    variety: "Arra 19",
    expectedKg: "5000",
    campaign: "2026/2027",
    registeredIca: "Pendiente",
    contractSigned: "Pendiente de firma del vendedor",
    contractStart: "2026-08-17",
    contractEnd: "2026-08-31",
    documentPath: "Pendiente de devolución y archivo central",
    otherAgreements: "",
    materials: [{ id: "parcela-1", crop: "Uva", variety: "Arra 19", expectedKg: "5000", situation: "", municipality: "Municipio de prueba", paraje: "", polygon: "", plot: "", hectares: "" }],
    contractDetails: {
      contractOrigin: "generated",
      buyerCompany: "TOÑIFRUIT, S.L.",
      signatureDate: "2026-08-17",
      modality: "A KILOS",
      collectionBy: "Comprador",
      transportBy: "Comprador",
      priceAgreement: "IMPORTE",
      pricePerKg: "1.05",
      totalPrice: "",
      paymentDays: "30",
      applyDestrio: "No",
      signatureMethod: "external_pending",
      sellerSignedAt: "",
      cutMinMm: "75",
      cutMaxMm: "55",
    },
  };
  assert.throws(() => validatePurchase(purchase), /mínimo no puede ser superior/i);
  purchase.contractDetails.cutMinMm = "55";
  purchase.contractDetails.cutMaxMm = "";
  assert.doesNotThrow(() => validatePurchase(purchase));
  purchase.contractDetails.cutMinMm = "";
  assert.doesNotThrow(() => validatePurchase(purchase));
});

test("genera series MR y TN independientes desde 01", () => {
  const legacyIds = ["MRO-052", "TON-109"];
  assert.equal(nextPurchaseIdForCompany(legacyIds, "MR. ORGÁNICA, S.L."), "MR-01");
  assert.equal(nextPurchaseIdForCompany(legacyIds, "TOÑIFRUIT, S.L."), "TN-01");
  const currentIds = [...legacyIds, "MR-01", "MR-02", "TN-01"];
  assert.equal(nextPurchaseIdForCompany(currentIds, "MR. ORGÁNICA, S.L."), "MR-03");
  assert.equal(nextPurchaseIdForCompany(currentIds, "TOÑIFRUIT, S.L."), "TN-02");
});

test("detecta una edición concurrente antes de sobrescribir el expediente", async () => {
  const original = ["MRO-032", "AGRICULTOR", "12345678A"];
  const revision = await rowRevision(original);
  await assert.doesNotReject(() => verifyExpectedRevision(original, revision));
  await assert.rejects(
    () => verifyExpectedRevision(["MRO-032", "AGRICULTOR MODIFICADO", "12345678A"], revision),
    /otro dispositivo/,
  );
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

  const consultationCatalog = await api("/api/control-catalog", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(consultationCatalog.status, 200);
  const consultationData = await consultationCatalog.json();
  assert.ok(consultationData.certificates.length > 0);
  assert.ok(consultationData.certificates.every((certificate) => certificate.taxId === "" && certificate.opfhMember === false && certificate.farmType === ""));
  assert.deepEqual(consultationData.opfhMembers, []);
  assert.deepEqual(consultationData.farms, []);
  assert.deepEqual(consultationData.documents, []);

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

  const confidentialDocument = await api("/api/document-library/000000000000000000000000", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(confidentialDocument.status, 403);

  const confidentialContract = await api("/api/contract-files/00000000-0000-0000-0000-000000000000", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(confidentialContract.status, 403);
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
  assert.equal(archived.driveBackupStatus, "pending_configuration");

  const unauthenticated = await api(`/api/contract-files/${archived.archiveId}`);
  assert.equal(unauthenticated.status, 401);

  const download = await api(`/api/contract-files/${archived.archiveId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /contrato-firmado\.pdf/);
  assert.equal(await download.text(), "contrato firmado");
});

test("archiva una copia Word generada sin tratarla como envío firmado", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();
  const form = new FormData();
  form.set(
    "file",
    new Blob(["contrato generado"], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    "contrato-generado.docx",
  );
  form.set("provider", "Agricultor de prueba");
  form.set("contractNumber", "TN-01");
  form.set("sendCopies", "false");
  const upload = await api("/api/contract-files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(upload.status, 201);
  const archived = await upload.json();
  assert.equal(archived.archiveFilename, "contrato-generado.docx");
  assert.equal(archived.emailStatus, "pending_configuration");

  const download = await api(`/api/contract-files/${archived.archiveId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /contrato-generado\.docx/);
  assert.equal(await download.text(), "contrato generado");
});

test("guarda o copia un contrato anterior como referencia independiente", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();

  const form = new FormData();
  form.set("file", new Blob(["contrato anterior"], { type: "application/pdf" }), "contrato-anterior.pdf");
  form.set("provider", "Agricultor de prueba");
  form.set("sourcePurchaseId", "TON-001");
  const uploaded = await api("/api/previous-contract-files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(uploaded.status, 201);
  const stored = await uploaded.json();
  assert.equal(stored.previousContractFilename, "contrato-anterior.pdf");
  assert.ok(stored.previousContractArchiveId);

  const copied = await api("/api/previous-contract-files/copy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ archiveId: stored.previousContractArchiveId, purchaseId: "TON-001", provider: "Agricultor de prueba" }),
  });
  assert.equal(copied.status, 201);
  const cloned = await copied.json();
  assert.notEqual(cloned.previousContractArchiveId, stored.previousContractArchiveId);
  assert.equal(cloned.previousContractFilename, "contrato-anterior.pdf");

  const download = await api(`/api/contract-files/${cloned.previousContractArchiveId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "contrato anterior");
});

test("copia como referencia un contrato importado de la biblioteca privada", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "admin-password" }),
  });
  const { token } = await login.json();
  const libraryId = "0cf23a7a450748bce19a3abd";
  await env.CONTRACT_FILES.put(
    `document-library/${libraryId}`,
    new TextEncoder().encode("contrato de biblioteca").buffer,
    {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { filename: "contrato-firmado-biblioteca.pdf", kind: "document_library" },
    },
  );

  const copied = await api("/api/previous-contract-files/copy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ archiveId: libraryId, purchaseId: "MRO-001", provider: "Agricultor de prueba" }),
  });
  assert.equal(copied.status, 201);
  const cloned = await copied.json();
  assert.notEqual(cloned.previousContractArchiveId, libraryId);
  assert.equal(cloned.previousContractFilename, "contrato-firmado-biblioteca.pdf");

  const download = await api(`/api/contract-files/${cloned.previousContractArchiveId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "contrato de biblioteca");
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
