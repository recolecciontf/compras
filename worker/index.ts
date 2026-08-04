import { STATIC_ASSETS } from "./static-assets.generated";
import { CONTRACT_ASSETS } from "./contract-assets.generated";

type Fetcher = { fetch(request: Request): Promise<Response> };

interface Env {
  ASSETS?: Fetcher;
  ALLOWED_ORIGINS?: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_SHA256: string;
  VIEWER_USERNAME: string;
  VIEWER_PASSWORD_SHA256: string;
  SESSION_SECRET: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  GOOGLE_SPREADSHEET_ID: string;
  GOOGLE_WORKSHEET_NAME?: string;
  GOOGLE_DATA_START_ROW?: string;
  GOOGLE_DATA_END_ROW?: string;
  CONTRACT_TEMPLATE_KEY: string;
}

type UserRole = "admin" | "viewer";

type Session = {
  sub: string;
  role: UserRole;
  exp: number;
};

type ReviewPayload = {
  plannedCutDate: string;
  farmChecked: string;
  fieldNotebook: string;
  notebookReviewDate: string;
  analysisStatus: string;
  analysisDate: string;
  certificateType: string;
  certificateExpiry: string;
  otherDocuments: string;
  reviewer: string;
  lastReviewDate: string;
};

type PurchasePayload = {
  id: string;
  provider: string;
  taxId: string;
  farm: string;
  municipality: string;
  crop: string;
  variety: string;
  expectedKg: string;
  campaign: string;
  contractSigned: string;
  contractStart: string;
  contractEnd: string;
  documentPath: string;
  otherAgreements: string;
  registeredIca: string;
  materials: Array<{
    id: string;
    crop: string;
    variety: string;
    expectedKg: string;
    situation: string;
    municipality: string;
    paraje: string;
    polygon: string;
    plot: string;
    hectares: string;
  }>;
  contractDetails: Record<string, string>;
};

type HarvestPayload = {
  cutStatus: string;
  cutKgTotal: string;
  archived: string;
};

class InputError extends Error {}

const encoder = new TextEncoder();
let cachedGoogleToken = "";
let cachedGoogleTokenExpiresAt = 0;
let sheetSchemaReady = false;

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function sessionKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function issueSession(env: Env, sub: string, role: UserRole) {
  const payload = base64Url(encoder.encode(JSON.stringify({ sub, role, exp: Date.now() + 8 * 60 * 60 * 1000 })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await sessionKey(env.SESSION_SECRET), encoder.encode(payload)));
  return `${payload}.${base64Url(signature)}`;
}

async function verifySession(token: string, env: Env) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await sessionKey(env.SESSION_SECRET),
    decodeBase64Url(signature),
    encoder.encode(payload),
  );
  if (!valid) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as Partial<Session>;
    if (
      typeof parsed.sub !== "string" ||
      (parsed.role !== "admin" && parsed.role !== "viewer") ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Date.now()
    ) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

function normalizeUsername(value: string) {
  return value.trim().toLocaleUpperCase("es");
}

function configuredUsers(env: Env) {
  return [
    {
      username: normalizeUsername(env.ADMIN_USERNAME || "ADMINISTRADOR"),
      passwordHash: env.ADMIN_PASSWORD_SHA256 || "",
      role: "admin" as const,
    },
    {
      username: normalizeUsername(env.VIEWER_USERNAME || "CONSULTAS"),
      passwordHash: env.VIEWER_PASSWORD_SHA256 || "",
      role: "viewer" as const,
    },
  ];
}

function profileFor(session: Pick<Session, "sub" | "role">) {
  return {
    displayName: session.role === "admin" ? "Administrador" : "Consultas",
    userPrincipalName: session.sub,
    role: session.role,
    canEdit: session.role === "admin",
  };
}

function requestToken(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function allowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return "";
  if (origin === new URL(request.url).origin) return origin;
  const configured = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return configured.includes(origin.replace(/\/$/, "")) ? origin : "";
}

function corsHeaders(request: Request, env: Env) {
  const origin = allowedOrigin(request, env);
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        Vary: "Origin",
      }
    : {};
}

function json(request: Request, env: Env, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...corsHeaders(request, env) },
  });
}

async function contractTemplate(name: string, env: Env) {
  const encrypted = CONTRACT_ASSETS[name as keyof typeof CONTRACT_ASSETS];
  if (!encrypted) return null;
  const keyBytes = Uint8Array.from(atob(env.CONTRACT_TEMPLATE_KEY || ""), (character) => character.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error("La clave de los modelos contractuales no está configurada.");
  const bytes = Uint8Array.from(atob(encrypted), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
}

function embeddedAssetPath(pathname: string) {
  if (pathname === "/" || pathname === "/index.html") return "/index.html";
  if (pathname === "/compras" || pathname === "/compras/") return "/index.html";
  return pathname.startsWith("/compras/") ? pathname.slice("/compras".length) : pathname;
}

function serveEmbeddedAsset(request: Request) {
  const path = embeddedAssetPath(new URL(request.url).pathname);
  const asset = STATIC_ASSETS[path as keyof typeof STATIC_ASSETS];
  if (!asset) return new Response("No encontrado", { status: 404 });
  const binary = atob(asset.body);
  const body = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const shouldRevalidate = path === "/index.html" || path === "/app-config.json" || path === "/sw.js";
  return new Response(body, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": shouldRevalidate ? "no-cache" : "public, max-age=31536000, immutable",
    },
  });
}

function pemToBytes(pem: string) {
  const clean = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
}

async function googleAccessToken(env: Env) {
  if (cachedGoogleToken && cachedGoogleTokenExpiresAt > Date.now() + 60_000) return cachedGoogleToken;

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(
    encoder.encode(
      JSON.stringify({
        iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(env.GOOGLE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, encoder.encode(unsigned)),
  );
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const tokenBody = (await tokenResponse.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error_description || "No se ha podido conectar con Google Sheets.");
  }
  cachedGoogleToken = tokenBody.access_token;
  cachedGoogleTokenExpiresAt = Date.now() + (tokenBody.expires_in || 3600) * 1000;
  return cachedGoogleToken;
}

async function sheetsRequest<T>(env: Env, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${await googleAccessToken(env)}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || "Google Sheets no ha podido completar la operación.");
  return body;
}

function dataBounds(env: Env) {
  const start = Number(env.GOOGLE_DATA_START_ROW || "9");
  const end = Number(env.GOOGLE_DATA_END_ROW || "108");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error("La configuración de filas de Google Sheets no es válida.");
  }
  return { start, end };
}

function sheetName(env: Env) {
  return (env.GOOGLE_WORKSHEET_NAME || "Control documental").replace(/'/g, "''");
}

async function ensureSheetSchema(env: Env) {
  if (sheetSchemaReady) return;
  const spreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}?fields=sheets.properties`;
  const metadata = await sheetsRequest<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { columnCount?: number } } }> }>(env, spreadsheetUrl);
  const title = env.GOOGLE_WORKSHEET_NAME || "Control documental";
  const sheet = metadata.sheets?.find((item) => item.properties?.title === title)?.properties;
  if (typeof sheet?.sheetId !== "number") throw new Error(`No existe la pestaña ${title}.`);
  const missingColumns = Math.max(0, 35 - Number(sheet.gridProperties?.columnCount || 0));
  if (missingColumns) {
    await sheetsRequest(env, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sheet.sheetId, dimension: "COLUMNS", length: missingColumns } }] }),
    });
  }
  const headerRow = Math.max(1, dataBounds(env).start - 1);
  const headerRange = `'${sheetName(env)}'!AF${headerRow}:AI${headerRow}`;
  const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(headerRange)}`;
  const current = await sheetsRequest<{ values?: unknown[][] }>(env, headerUrl);
  const proposed = ["Materias primas (JSON)", "Registrado en ICA", "Certificaciones (reservado)", "Datos contrato (JSON)"];
  const headers = proposed.map((header, index) => {
    const existing = String(current.values?.[0]?.[index] ?? "").trim();
    return !existing || /^Column \d+$/i.test(existing) ? header : existing;
  });
  await sheetsRequest(env, `${headerUrl}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ range: headerRange, majorDimension: "ROWS", values: [headers] }),
  });
  sheetSchemaReady = true;
}

async function loadRows(env: Env) {
  await ensureSheetSchema(env);
  const { start, end } = dataBounds(env);
  const range = `'${sheetName(env)}'!A${start}:AI${end}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const result = await sheetsRequest<{ values?: unknown[][] }>(env, url);
  return (result.values || [])
    .map((values, offset) => ({ index: start + offset, values }))
    .filter((row) => String(row.values[1] || "").trim());
}

function cleanRecord<T extends Record<string, unknown>, K extends keyof T>(value: unknown, keys: readonly K[]) {
  const source = (value && typeof value === "object" ? value : {}) as Partial<T>;
  return Object.fromEntries(keys.map((key) => [key, String(source[key] ?? "").trim()])) as Pick<T, K>;
}

function purchaseValues(value: unknown): PurchasePayload {
  const source = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof PurchasePayload, unknown>>;
  const base = cleanRecord<PurchasePayload, Exclude<keyof PurchasePayload, "materials" | "contractDetails">>(value, [
    "id", "provider", "taxId", "farm", "municipality", "crop", "variety", "expectedKg", "campaign",
    "contractSigned", "contractStart", "contractEnd", "documentPath", "otherAgreements", "registeredIca",
  ]);
  const materialKeys = ["id", "crop", "variety", "expectedKg", "situation", "municipality", "paraje", "polygon", "plot", "hectares"] as const;
  const materials = Array.isArray(source.materials)
    ? source.materials.slice(0, 12).map((item) => cleanRecord<Record<(typeof materialKeys)[number], unknown>, (typeof materialKeys)[number]>(item, materialKeys))
    : [];
  const contractSource = source.contractDetails && typeof source.contractDetails === "object"
    ? source.contractDetails as Record<string, unknown>
    : {};
  const contractDetails = Object.fromEntries(
    Object.entries(contractSource).slice(0, 40).map(([key, entry]) => [key, String(entry ?? "").trim()]),
  );
  return { ...base, materials, contractDetails } as PurchasePayload;
}

function validatePurchase(purchase: PurchasePayload, requireComplete = true) {
  const required: Array<[keyof PurchasePayload, string]> = [
    ["provider", "agricultor o proveedor"],
    ["taxId", "NIF o CIF"],
    ["farm", "finca o parcela"],
    ["municipality", "municipio"],
    ["crop", "especie"],
    ["variety", "variedad"],
    ["expectedKg", "kg previstos"],
    ["campaign", "campaña"],
    ["contractSigned", "estado del contrato"],
    ["contractStart", "inicio del contrato"],
    ["contractEnd", "fin del contrato"],
    ["registeredIca", "registro en ICA"],
  ];
  if (requireComplete) {
    const missing = required.filter(([key]) => !purchase[key]).map(([, label]) => label);
    if (missing.length) throw new InputError(`Faltan campos obligatorios: ${missing.join(", ")}.`);
  }
  if (purchase.expectedKg) {
    const expectedKg = Number(purchase.expectedKg.replace(",", "."));
    if (!Number.isFinite(expectedKg) || expectedKg <= 0) throw new InputError("Los kg previstos deben ser superiores a cero.");
  }
  if (requireComplete) {
    if (!purchase.materials.length) throw new InputError("Añade al menos una especie y variedad.");
    const incompleteMaterial = purchase.materials.find((item) => !item.crop || !item.variety || !item.expectedKg);
    if (incompleteMaterial) throw new InputError("Completa la especie, variedad y kg de todas las materias primas.");
    const requiredContractFields = [
      ["buyerCompany", "empresa compradora"],
      ["signatureDate", "fecha de firma"],
      ["sellerRepresentative", "representante del vendedor"],
      ["sellerDni", "DNI del representante"],
      ["sellerAddress", "domicilio del vendedor"],
      ["organicOperatorCode", "código de operador ecológico"],
      ["modality", "modalidad"],
      ["collectionBy", "responsable de recolección"],
      ["transportBy", "responsable de transporte"],
      ["paymentDays", "plazo de pago"],
    ];
    requiredContractFields.push(purchase.contractDetails.modality === "POR TANTO" ? ["totalPrice", "precio total"] : ["pricePerKg", "precio por kg"]);
    const missingContract = requiredContractFields.filter(([key]) => !purchase.contractDetails[key]).map(([, label]) => label);
    if (missingContract.length) throw new InputError(`Faltan datos del contrato: ${missingContract.join(", ")}.`);
    if (purchase.contractDetails.applyDestrio === "Sí") {
      const missingDestrio = ["destrioLocation", "destrioDefects", "destrioPrice"].filter((key) => !purchase.contractDetails[key]);
      if (missingDestrio.length) throw new InputError("Completa el lugar, los defectos y el precio del destrío.");
    }
  }
  if (purchase.contractStart && purchase.contractEnd && purchase.contractStart > purchase.contractEnd) {
    throw new InputError("El fin del contrato no puede ser anterior al inicio.");
  }
}

function harvestValues(value: unknown): HarvestPayload {
  const harvest = cleanRecord<HarvestPayload, keyof HarvestPayload>(value, ["cutStatus", "cutKgTotal", "archived"]);
  const cutStatus = harvest.cutStatus.toLocaleLowerCase("es") === "sí" ? "Sí" : "No";
  const archived = harvest.archived.toLocaleLowerCase("es") === "sí" ? "Sí" : "No";
  const kg = Number(harvest.cutKgTotal.replace(",", "."));
  if (cutStatus === "Sí" && (!Number.isFinite(kg) || kg <= 0)) {
    throw new InputError("Indica los kg cortados totales antes de marcar el corte como realizado.");
  }
  if (archived === "Sí" && cutStatus !== "Sí") {
    throw new InputError("Solo se puede archivar una compra cuyo corte esté realizado.");
  }
  return { cutStatus, cutKgTotal: cutStatus === "Sí" ? String(kg) : "", archived };
}

async function batchSave(env: Env, data: Array<{ range: string; values: unknown[][] }>) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values:batchUpdate`;
  await sheetsRequest(env, url, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
}

async function firstAvailableRow(env: Env) {
  const { start, end } = dataBounds(env);
  const range = `'${sheetName(env)}'!B${start}:B${end}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const result = await sheetsRequest<{ values?: unknown[][] }>(env, url);
  const values = result.values || [];
  for (let row = start; row <= end; row += 1) {
    if (!String(values[row - start]?.[0] ?? "").trim()) return row;
  }
  throw new Error("No quedan filas libres en el control documental.");
}

async function savePurchase(env: Env, row: number, purchase: PurchasePayload, create = false) {
  const { start, end } = dataBounds(env);
  if (!Number.isInteger(row) || row < start || row > end) throw new Error("La fila seleccionada no es válida.");
  validatePurchase(purchase, create);
  await ensureSheetSchema(env);
  const materials = purchase.materials.length ? purchase.materials : [{
    id: `material-${row}-0`, crop: purchase.crop, variety: purchase.variety, expectedKg: purchase.expectedKg,
    situation: "", municipality: purchase.municipality, paraje: purchase.farm, polygon: "", plot: "", hectares: "",
  }];
  const crops = [...new Set(materials.map((item) => item.crop).filter(Boolean))].join(" + ");
  const varieties = materials.map((item) => item.variety).filter(Boolean).join(" · ");
  const totalKg = materials.reduce((total, item) => total + (Number(item.expectedKg.replace(",", ".")) || 0), 0);
  const normalizedKg = totalKg ? String(totalKg) : "";
  const generatedId = purchase.id || `CMP-${purchase.campaign}-${String(row).padStart(3, "0")}`;
  const sheet = sheetName(env);
  const data = [
    {
      range: `'${sheet}'!A${row}:J${row}`,
      values: [[generatedId, purchase.provider, purchase.taxId, purchase.farm, purchase.municipality, crops,
        purchase.campaign, purchase.contractSigned, purchase.contractStart, purchase.contractEnd]],
    },
    {
      range: `'${sheet}'!Y${row}:Z${row}`,
      values: [[purchase.documentPath, purchase.otherAgreements]],
    },
    {
      range: `'${sheet}'!AD${row}:AE${row}`,
      values: [[varieties, normalizedKg]],
    },
    {
      range: `'${sheet}'!AF${row}:AG${row}`,
      values: [[JSON.stringify(materials), purchase.registeredIca]],
    },
    {
      range: `'${sheet}'!AI${row}:AI${row}`,
      values: [[JSON.stringify(purchase.contractDetails)]],
    },
  ];
  if (create) data.push({ range: `'${sheet}'!AA${row}:AC${row}`, values: [["No", "", "No"]] });
  await batchSave(env, data);
  return generatedId;
}

async function saveHarvest(env: Env, row: number, value: unknown) {
  const { start, end } = dataBounds(env);
  if (!Number.isInteger(row) || row < start || row > end) throw new Error("La fila seleccionada no es válida.");
  const harvest = harvestValues(value);
  const range = `'${sheetName(env)}'!AA${row}:AC${row}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  await sheetsRequest(env, url, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values: [[harvest.cutStatus, harvest.cutKgTotal, harvest.archived]] }),
  });
}

function reviewValues(value: unknown): ReviewPayload {
  const review = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof ReviewPayload, unknown>>;
  const stringValue = (key: keyof ReviewPayload) => String(review[key] ?? "").trim();
  return {
    plannedCutDate: stringValue("plannedCutDate"),
    farmChecked: stringValue("farmChecked"),
    fieldNotebook: stringValue("fieldNotebook"),
    notebookReviewDate: stringValue("notebookReviewDate"),
    analysisStatus: stringValue("analysisStatus"),
    analysisDate: stringValue("analysisDate"),
    certificateType: stringValue("certificateType"),
    certificateExpiry: stringValue("certificateExpiry"),
    otherDocuments: stringValue("otherDocuments"),
    reviewer: stringValue("reviewer"),
    lastReviewDate: stringValue("lastReviewDate"),
  };
}

async function saveReview(env: Env, row: number, review: ReviewPayload) {
  const { start, end } = dataBounds(env);
  if (!Number.isInteger(row) || row < start || row > end) throw new Error("La fila seleccionada no es válida.");
  const range = `'${sheetName(env)}'!L${row}:V${row}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  await sheetsRequest(env, url, {
    method: "PUT",
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values: [[
        review.plannedCutDate,
        review.farmChecked,
        review.fieldNotebook,
        review.notebookReviewDate,
        review.analysisStatus,
        review.analysisDate,
        review.certificateType,
        review.certificateExpiry,
        review.otherDocuments,
        review.reviewer,
        new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date()),
      ]],
    }),
  });
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    if (request.headers.get("Origin") && !allowedOrigin(request, env)) return json(request, env, { error: "Origen no permitido." }, 403);
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json(request, env, { ok: true });
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    if (request.headers.get("Origin") && !allowedOrigin(request, env)) return json(request, env, { error: "Origen no permitido." }, 403);
    const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
    const suppliedUser = normalizeUsername(String(body.username || ""));
    const suppliedHash = await sha256Hex(String(body.password || ""));
    const user = configuredUsers(env).find(
      (candidate) =>
        Boolean(candidate.passwordHash) &&
        safeEqual(suppliedUser, candidate.username) &&
        safeEqual(suppliedHash, candidate.passwordHash),
    );
    if (!user) {
      return json(request, env, { error: "Usuario o contraseña incorrectos." }, 401);
    }
    const profile = profileFor({ sub: user.username, role: user.role });
    return json(request, env, { token: await issueSession(env, user.username, user.role), profile });
  }

  const session = await verifySession(requestToken(request), env);
  if (!session) {
    return json(request, env, { error: "La sesión ha caducado. Vuelve a iniciar sesión." }, 401);
  }

  if (url.pathname === "/api/profile" && request.method === "GET") {
    return json(request, env, profileFor(session));
  }

  const templateMatch = url.pathname.match(/^\/api\/contract-templates\/([a-z0-9-]+\.docx)$/);
  if (templateMatch && request.method === "GET") {
    const body = await contractTemplate(templateMatch[1], env);
    if (!body) return json(request, env, { error: "Modelo contractual no encontrado." }, 404);
    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${templateMatch[1]}"`,
        "Cache-Control": "private, no-store",
        ...corsHeaders(request, env),
      },
    });
  }

  if (url.pathname === "/api/rows" && request.method === "GET") {
    return json(request, env, { rows: await loadRows(env) });
  }

  if (url.pathname === "/api/rows" && request.method === "POST") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede añadir compras." }, 403);
    const body = (await request.json().catch(() => ({}))) as { purchase?: unknown };
    const purchase = purchaseValues(body.purchase);
    validatePurchase(purchase);
    const row = await firstAvailableRow(env);
    const id = await savePurchase(env, row, purchase, true);
    return json(request, env, { ok: true, row, id }, 201);
  }

  const reviewMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/review$/);
  if (reviewMatch && request.method === "PATCH") {
    if (session.role !== "admin") {
      return json(request, env, { error: "Este usuario es de consulta y no puede modificar los datos." }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as { review?: unknown };
    await saveReview(env, Number(reviewMatch[1]), reviewValues(body.review));
    return json(request, env, { ok: true });
  }

  const purchaseMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/purchase$/);
  if (purchaseMatch && request.method === "PATCH") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede modificar compras." }, 403);
    const body = (await request.json().catch(() => ({}))) as { purchase?: unknown };
    await savePurchase(env, Number(purchaseMatch[1]), purchaseValues(body.purchase));
    return json(request, env, { ok: true });
  }

  const harvestMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/harvest$/);
  if (harvestMatch && request.method === "PATCH") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede modificar cortes." }, 403);
    const body = (await request.json().catch(() => ({}))) as { harvest?: unknown };
    await saveHarvest(env, Number(harvestMatch[1]), body.harvest);
    return json(request, env, { ok: true });
  }

  return json(request, env, { error: "Operación no encontrada." }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (new URL(request.url).pathname.startsWith("/api/")) return await handleApi(request, env);
      if (env.ASSETS) {
        const response = await env.ASSETS.fetch(request);
        if (response.status !== 404) return response;
      }
      return serveEmbeddedAsset(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se ha podido completar la operación.";
      return json(request, env, { error: message }, error instanceof InputError ? 400 : 500);
    }
  },
};
