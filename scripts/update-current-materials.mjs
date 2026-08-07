import { createSign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const keyPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!keyPath) throw new Error("Indica la ruta del archivo JSON de la cuenta de servicio.");

const corrections = new Map(Object.entries({
  "MRO-001": [["Nectarina", "", ""]],
  "MRO-002": [["Limón", "Fino y rodrejo", "55000"]],
  "MRO-003": [["Limón", "Rodrejo", "5000"]],
  "MRO-004": [["Limón", "", ""], ["Mandarina", "", ""]],
  "MRO-005": [["Mandarina", "Nadorcott y Tango", "100000"]],
  "MRO-006": [["Melocotón", "", ""]],
  "MRO-007": [["Limón", "Rodrejo", "35000"]],
  "MRO-008": [["Limón", "Rodrejo", "5000"]],
  "MRO-009": [["Limón", "Rodrejo", "15000"]],
  "MRO-010": [["Limón", "Rodrejo", "5000"]],
  "MRO-011": [["Limón", "Segundos rodrejos", "10000"]],
  "TON-012": [["Limón", "Rodrejo", "60000"]],
  "MRO-013": [["Limón", "Rodrejo", "2500"]],
  "MRO-014": [["Limón", "Rodrejo", "5000"]],
  "MRO-015": [["Limón", "Rodrejo", "20000"]],
  "MRO-016": [["Limón", "Rodrejo", ""]],
  "MRO-017": [["Melocotón", "", ""], ["Nectarina", "", ""], ["Paraguayo", "", ""]],
  "MRO-018": [["Limón", "Rodrejo", "30000"]],
  "MRO-019": [["Limón", "Verna y rodrejo", "100000"]],
  "MRO-020": [["Limón", "Rodrejo", "5000"]],
  "MRO-021": [["Limón", "Segundos y rodrejo", "20000"]],
  "MRO-022": [["Limón", "Rodrejo", "15000"]],
  "MRO-023": [["Limón", "Rodrejo", "3000"]],
  "MRO-024": [["Limón", "Rodrejo", "3000"]],
  "TON-025": [["Limón", "", ""]],
  "MRO-026": [["Limón", "Rodrejo", "3000"]],
  "MRO-027": [["Limón", "Rodrejo", "5000"]],
  "TON-028": [["Limón", "Rodrejo", "15000"]],
  "MRO-029": [["Limón", "Fino y fino chaparro", "180000"]],
  "CMP-2026-038": [["Limón", "Fino", "10000"]],
  "CMP-2026-039": [["Limón", "Rodrejo / Verdelli", "50000"]],
}));

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(key) {
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
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body.error_description || "No se pudo autorizar Google Sheets.");
  return body.access_token;
}

const key = JSON.parse(await readFile(keyPath, "utf8"));
const token = await accessToken(key);
const spreadsheetId = "1MIvuzaAvFeo748yd2keFoMsm4YlI9URJg3-GlNBFL2Y";
const sheet = "Control documental";
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const sourceRange = `'${sheet}'!A9:AG108`;
const sourceUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sourceRange)}?valueRenderOption=UNFORMATTED_VALUE`;
const sourceResponse = await fetch(sourceUrl, { headers });
const source = await sourceResponse.json();
if (!sourceResponse.ok) throw new Error(source.error?.message || "No se pudieron leer las compras actuales.");

const backup = { createdAt: new Date().toISOString(), range: sourceRange, values: source.values || [] };
await writeFile(new URL("../../work/materials-before-ica-migration.json", import.meta.url), JSON.stringify(backup, null, 2));

const updates = [];
const audit = [];
const seen = new Set();
for (const [offset, values] of (source.values || []).entries()) {
  const row = 9 + offset;
  const id = String(values[0] ?? "").trim();
  if (!id || !corrections.has(id)) continue;
  if (seen.has(id)) throw new Error(`El expediente ${id} aparece más de una vez.`);
  seen.add(id);
  const provider = String(values[1] ?? "").trim();
  const municipality = String(values[4] ?? "").trim();
  const farm = String(values[3] ?? "").trim();
  const sourceMaterials = corrections.get(id);
  const materials = sourceMaterials.map(([crop, variety, expectedKg], index) => ({
    id: `material-${row}-${index}`,
    crop,
    variety,
    expectedKg,
    situation: "",
    municipality,
    paraje: farm,
    polygon: "",
    plot: "",
    hectares: "",
  }));
  const crops = [...new Set(materials.map((item) => item.crop).filter(Boolean))].join(" + ");
  const varieties = materials.map((item) => item.variety).filter(Boolean).join(" · ");
  const kgValues = materials.map((item) => Number(item.expectedKg)).filter((value) => Number.isFinite(value) && value > 0);
  const totalKg = kgValues.length === materials.length ? String(kgValues.reduce((total, value) => total + value, 0)) : "";
  const registeredIca = String(values[32] ?? "").trim() || "Pendiente";
  updates.push(
    { range: `'${sheet}'!F${row}`, values: [[crops]] },
    { range: `'${sheet}'!AD${row}:AG${row}`, values: [[varieties, totalKg, JSON.stringify(materials), registeredIca]] },
  );
  audit.push({ row, id, provider, crop: crops, variety: varieties, expectedKg: totalKg, registeredIca });
}

const missing = [...corrections.keys()].filter((id) => !seen.has(id));
if (missing.length) throw new Error(`No se localizaron estos expedientes: ${missing.join(", ")}`);

if (apply) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ valueInputOption: "RAW", data: updates }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "No se pudieron actualizar las compras.");
}

console.log(JSON.stringify({ applied: apply, records: audit.length, audit }, null, 2));
