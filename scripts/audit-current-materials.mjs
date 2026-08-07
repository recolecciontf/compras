import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const keyPath = process.argv[2];
if (!keyPath) throw new Error("Indica la ruta del archivo JSON de la cuenta de servicio.");

const key = JSON.parse(await readFile(keyPath, "utf8"));
const { default: worker } = await import(new URL(`../dist/server/index.js?audit=${Date.now()}`, import.meta.url));

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  ADMIN_USERNAME: "ADMINISTRADOR",
  ADMIN_PASSWORD_SHA256: createHash("sha256").update("materials-audit").digest("hex"),
  VIEWER_USERNAME: "CONSULTAS",
  VIEWER_PASSWORD_SHA256: createHash("sha256").update("viewer-audit").digest("hex"),
  SESSION_SECRET: "materials-audit-session-secret",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: key.client_email,
  GOOGLE_PRIVATE_KEY: key.private_key,
  GOOGLE_SPREADSHEET_ID: "1MIvuzaAvFeo748yd2keFoMsm4YlI9URJg3-GlNBFL2Y",
  GOOGLE_WORKSHEET_NAME: "Control documental",
  GOOGLE_DATA_START_ROW: "9",
  GOOGLE_DATA_END_ROW: "108",
};

const login = await worker.fetch(
  new Request("https://app.example/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ADMINISTRADOR", password: "materials-audit" }),
  }),
  env,
);
if (!login.ok) throw new Error(`No se pudo iniciar la auditoría (${login.status}).`);
const { token } = await login.json();

const rowsResponse = await worker.fetch(
  new Request("https://app.example/api/rows", { headers: { Authorization: `Bearer ${token}` } }),
  env,
);
const result = await rowsResponse.json();
if (!rowsResponse.ok) throw new Error(result.error || `Google Sheets respondió con ${rowsResponse.status}.`);

const rows = result.rows.map(({ index, values }) => ({
  row: index,
  id: String(values[0] ?? "").trim(),
  provider: String(values[1] ?? "").trim(),
  crop: String(values[5] ?? "").trim(),
  variety: String(values[29] ?? "").trim(),
  expectedKg: String(values[30] ?? "").trim(),
  materialsJson: String(values[31] ?? "").trim(),
  registeredIca: String(values[32] ?? "").trim(),
}));

console.log(JSON.stringify(rows, null, 2));
