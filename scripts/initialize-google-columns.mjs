import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const keyPath = process.argv[2];
if (!keyPath) throw new Error("Indica la ruta del archivo JSON de la cuenta de servicio.");

const key = JSON.parse(await readFile(keyPath, "utf8"));
const spreadsheetId = "1MIvuzaAvFeo748yd2keFoMsm4YlI9URJg3-GlNBFL2Y";
const sheetName = "Control documental";
const headerRow = 8;
const headers = [
  "Corte realizado",
  "Kg cortados totales",
  "Archivado",
  "Variedad",
  "Kg previstos",
  "Materias primas (JSON)",
  "Registrado en ICA",
  "Certificaciones (reservado)",
  "Datos contrato (JSON)",
];

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

const now = Math.floor(Date.now() / 1000);
const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
  iss: key.client_email,
  scope: "https://www.googleapis.com/auth/spreadsheets",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
}))}`;
const signer = createSign("RSA-SHA256");
signer.update(unsigned);
const assertion = `${unsigned}.${signer.sign(key.private_key).toString("base64url")}`;
const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok || !tokenBody.access_token) throw new Error(tokenBody.error_description || "No se pudo autorizar Google Sheets.");

const requestHeaders = { Authorization: `Bearer ${tokenBody.access_token}`, "Content-Type": "application/json" };
const metadataEndpoint = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
const metadataResponse = await fetch(metadataEndpoint, { headers: requestHeaders });
const metadata = await metadataResponse.json();
if (!metadataResponse.ok) throw new Error(metadata.error?.message || "No se pudo revisar la estructura de la hoja.");
const sheet = metadata.sheets?.find((item) => item.properties?.title === sheetName)?.properties;
if (!sheet) throw new Error(`No existe la pestaña ${sheetName}.`);
const missingColumns = Math.max(0, 35 - Number(sheet.gridProperties?.columnCount || 0));
if (missingColumns > 0) {
  const expandResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sheet.sheetId, dimension: "COLUMNS", length: missingColumns } }] }),
  });
  const expandBody = await expandResponse.json();
  if (!expandResponse.ok) throw new Error(expandBody.error?.message || "No se pudo ampliar la hoja.");
}

const range = `'${sheetName}'!AA${headerRow}:AI${headerRow}`;
const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
const currentResponse = await fetch(endpoint, { headers: requestHeaders });
const currentBody = await currentResponse.json();
if (!currentResponse.ok) throw new Error(currentBody.error?.message || "No se pudieron leer los encabezados.");
const current = currentBody.values?.[0] || [];
const values = headers.map((header, index) => {
  const existing = String(current[index] || "").trim();
  return !existing || /^Column \d+$/i.test(existing) ? header : existing;
});

const updateResponse = await fetch(`${endpoint}?valueInputOption=RAW`, {
  method: "PUT",
  headers: requestHeaders,
  body: JSON.stringify({ range, majorDimension: "ROWS", values: [values] }),
});
const updateBody = await updateResponse.json();
if (!updateResponse.ok) throw new Error(updateBody.error?.message || "No se pudieron guardar los encabezados.");
console.log(JSON.stringify({ ok: true, range, headers: values }));
