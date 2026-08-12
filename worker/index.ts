import { STATIC_ASSETS } from "./static-assets.generated";
import { CONTRACT_ASSETS } from "./contract-assets.generated";
import {
  CERTIFICATE_RECORDS,
  CONTROL_DATA_UPDATED_AT,
  FARM_RECORDS,
  OPFH_MEMBERS,
} from "./data/controlCatalog.generated";
import { CONTRACT_DOCUMENTS } from "./data/documentLibrary.generated";

type Fetcher = { fetch(request: Request): Promise<Response> };
type ContractObject = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};
type ContractBucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<ContractObject | null>;
  delete(keys: string | string[]): Promise<unknown>;
};

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
  UVA_TEMPLATE_KEY?: string;
  CONTRACT_FILES?: ContractBucket;
  CONTRACT_EMAIL_WEBHOOK_URL?: string;
  CONTRACT_EMAIL_WEBHOOK_TOKEN?: string;
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
const libraryDocumentsById = new Map(CONTRACT_DOCUMENTS.map((document) => [document.id, document]));

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
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
  const configuredKey = name === "tonifruit-uva.docx" ? env.UVA_TEMPLATE_KEY : env.CONTRACT_TEMPLATE_KEY;
  const keyBytes = Uint8Array.from(atob(configuredKey || ""), (character) => character.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error("La clave de los modelos contractuales no está configurada.");
  const bytes = Uint8Array.from(atob(encrypted), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
}

function safeContractFilename(value: string) {
  const cleaned = value.replace(/[\r\n"\\/:*?<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return (cleaned || "contrato-firmado").slice(0, 180);
}

async function sendContractCopies(
  env: Env,
  bytes: ArrayBuffer,
  metadata: { filename: string; contentType: string; provider: string; sellerEmail: string; companyEmail: string; contractNumber: string },
) {
  if (!env.CONTRACT_EMAIL_WEBHOOK_URL) return "pending_configuration" as const;
  try {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: metadata.contentType }), metadata.filename);
    form.set("provider", metadata.provider);
    form.set("sellerEmail", metadata.sellerEmail);
    form.set("companyEmail", metadata.companyEmail);
    form.set("contractNumber", metadata.contractNumber);
    const response = await fetch(env.CONTRACT_EMAIL_WEBHOOK_URL, {
      method: "POST",
      headers: env.CONTRACT_EMAIL_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.CONTRACT_EMAIL_WEBHOOK_TOKEN}` } : undefined,
      body: form,
    });
    return response.ok ? "sent" as const : "failed" as const;
  } catch {
    return "failed" as const;
  }
}

async function storeContract(form: FormData, env: Env) {
  if (!env.CONTRACT_FILES) throw new Error("El archivo central de contratos no está configurado.");
  const file = form.get("file");
  if (!(file instanceof File)) throw new InputError("Adjunta el contrato firmado.");
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new InputError("El contrato debe ocupar entre 1 byte y 10 MB.");
  const allowed = [
    "application/pdf",
    "application/octet-stream",
  ];
  if (file.type && !allowed.includes(file.type)) throw new InputError("El contrato firmado debe ser un PDF.");
  if (!/\.pdf$/i.test(file.name)) throw new InputError("El archivo debe tener extensión PDF.");

  const metadata = {
    filename: safeContractFilename(file.name),
    contentType: file.type || "application/octet-stream",
    provider: String(form.get("provider") || "").trim().slice(0, 180),
    sellerEmail: String(form.get("sellerEmail") || "").trim().slice(0, 254),
    companyEmail: String(form.get("companyEmail") || "").trim().slice(0, 254),
    contractNumber: String(form.get("contractNumber") || "").trim().slice(0, 80),
  };
  if (!metadata.provider) throw new InputError("Falta identificar al agricultor o proveedor.");
  if (!metadata.sellerEmail || !metadata.companyEmail) throw new InputError("Indica el correo del agricultor y el correo de la empresa.");
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(metadata.sellerEmail) || !emailPattern.test(metadata.companyEmail)) {
    throw new InputError("Revisa el formato del correo del agricultor y del correo de la empresa.");
  }

  const bytes = await file.arrayBuffer();
  const archiveId = crypto.randomUUID();
  const archivedAt = new Date().toISOString();
  const putArchive = (emailStatus: "sent" | "pending_configuration" | "failed") => env.CONTRACT_FILES!.put(archiveId, bytes, {
    httpMetadata: { contentType: metadata.contentType },
    customMetadata: {
      filename: metadata.filename,
      provider: metadata.provider,
      sellerEmail: metadata.sellerEmail,
      companyEmail: metadata.companyEmail,
      contractNumber: metadata.contractNumber,
      archivedAt,
      emailStatus,
    },
  });
  await putArchive("pending_configuration");
  const emailStatus = await sendContractCopies(env, bytes, metadata);
  if (emailStatus !== "pending_configuration") await putArchive(emailStatus);
  return { archiveId, archiveFilename: metadata.filename, archivedAt, emailStatus };
}

async function archiveContract(request: Request, env: Env) {
  return storeContract(await request.formData(), env);
}

function contentTypeForLibraryDocument(filename: string, supplied: string) {
  if (supplied && supplied !== "application/octet-stream") return supplied;
  const extension = filename.split(".").pop()?.toLocaleLowerCase("es");
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "doc") return "application/msword";
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === "odt") return "application/vnd.oasis.opendocument.text";
  if (extension === "jpeg" || extension === "jpg") return "image/jpeg";
  return "application/octet-stream";
}

async function storeLibraryDocument(request: Request, env: Env) {
  if (!env.CONTRACT_FILES) throw new Error("La biblioteca documental no está configurada.");
  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const document = libraryDocumentsById.get(id);
  if (!document) throw new InputError("El documento no pertenece a la biblioteca preparada.");
  const file = form.get("file");
  if (!(file instanceof File)) throw new InputError("Selecciona el documento contractual.");
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new InputError("Cada documento debe ocupar entre 1 byte y 20 MB.");
  const contentType = contentTypeForLibraryDocument(document.filename, file.type);
  await env.CONTRACT_FILES.put(`document-library/${id}`, await file.arrayBuffer(), {
    httpMetadata: { contentType },
    customMetadata: {
      filename: safeContractFilename(document.filename),
      company: document.company,
      farmer: document.farmer.slice(0, 180),
      campaign: document.campaign,
      documentType: document.documentType,
      importedAt: new Date().toISOString(),
      kind: "document_library",
    },
  });
  return { ok: true as const, id };
}

async function storePreviousContract(request: Request, env: Env) {
  if (!env.CONTRACT_FILES) throw new Error("El archivo central de contratos no está configurado.");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new InputError("Adjunta el contrato anterior.");
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new InputError("El contrato anterior debe ocupar entre 1 byte y 10 MB.");
  if (file.type && !["application/pdf", "application/octet-stream"].includes(file.type)) {
    throw new InputError("El contrato anterior debe ser un PDF.");
  }
  if (!/\.pdf$/i.test(file.name)) throw new InputError("El contrato anterior debe tener extensión PDF.");
  const provider = String(form.get("provider") || "").trim().slice(0, 180);
  if (!provider) throw new InputError("Falta identificar al agricultor o proveedor.");
  const previousContractArchiveId = crypto.randomUUID();
  const previousContractFilename = safeContractFilename(file.name);
  const previousContractStoredAt = new Date().toISOString();
  await env.CONTRACT_FILES.put(previousContractArchiveId, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/pdf" },
    customMetadata: {
      filename: previousContractFilename,
      provider,
      sourcePurchaseId: String(form.get("sourcePurchaseId") || "").trim().slice(0, 80),
      storedAt: previousContractStoredAt,
      kind: "previous_contract_reference",
    },
  });
  return { previousContractArchiveId, previousContractFilename, previousContractStoredAt };
}

async function copyPreviousContract(value: unknown, env: Env) {
  if (!env.CONTRACT_FILES) throw new Error("El archivo central de contratos no está configurado.");
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const archiveId = String(source.archiveId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(archiveId)) throw new InputError("Selecciona un contrato anterior válido.");
  const original = await env.CONTRACT_FILES.get(archiveId);
  if (!original) throw new InputError("El contrato anterior seleccionado ya no está disponible.");
  const previousContractArchiveId = crypto.randomUUID();
  const previousContractFilename = safeContractFilename(original.customMetadata?.filename || "contrato-anterior.pdf");
  const previousContractStoredAt = new Date().toISOString();
  const bytes = await new Response(original.body).arrayBuffer();
  await env.CONTRACT_FILES.put(previousContractArchiveId, bytes, {
    httpMetadata: { contentType: original.httpMetadata?.contentType || "application/pdf" },
    customMetadata: {
      filename: previousContractFilename,
      provider: String(source.provider || "").trim().slice(0, 180),
      sourcePurchaseId: String(source.purchaseId || "").trim().slice(0, 80),
      sourceArchiveId: archiveId,
      storedAt: previousContractStoredAt,
      kind: "previous_contract_reference",
    },
  });
  return { previousContractArchiveId, previousContractFilename, previousContractStoredAt };
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
  const missingColumns = Math.max(0, 40 - Number(sheet.gridProperties?.columnCount || 0));
  if (missingColumns) {
    await sheetsRequest(env, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sheet.sheetId, dimension: "COLUMNS", length: missingColumns } }] }),
    });
  }
  const headerRow = Math.max(1, dataBounds(env).start - 1);
  const headerRange = `'${sheetName(env)}'!AF${headerRow}:AN${headerRow}`;
  const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(headerRange)}`;
  const current = await sheetsRequest<{ values?: unknown[][] }>(env, headerUrl);
  const proposed = [
    "Materias primas (JSON)",
    "Registrado en AICA",
    "Certificaciones (reservado)",
    "Datos contrato (JSON)",
    "Estado expediente",
    "Motivo del estado",
    "Fecha del estado",
    "Usuario del estado",
    "Historial de gestión (JSON)",
  ];
  const headers = proposed.map((header, index) => {
    const existing = String(current.values?.[0]?.[index] ?? "").trim();
    if (existing === "Registrado en ICA") return "Registrado en AICA";
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
  const range = `'${sheetName(env)}'!A${start}:AN${end}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const result = await sheetsRequest<{ values?: unknown[][] }>(env, url);
  return (result.values || [])
    .map((values, offset) => ({ index: start + offset, values }))
    .filter((row) => String(row.values[1] || "").trim());
}

async function loadRowValues(env: Env, row: number) {
  const { start, end } = dataBounds(env);
  if (!Number.isInteger(row) || row < start || row > end) throw new InputError("La fila seleccionada no es válida.");
  await ensureSheetSchema(env);
  const range = `'${sheetName(env)}'!A${row}:AN${row}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const result = await sheetsRequest<{ values?: unknown[][] }>(env, url);
  const values = result.values?.[0] || [];
  if (!String(values[0] || "").trim() || !String(values[1] || "").trim()) {
    throw new InputError("El expediente ya no existe.");
  }
  return values;
}

function parseJsonRecord(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function parseJsonHistory(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object").slice(-40) : [];
  } catch {
    return [] as unknown[];
  }
}

function verifyExpectedId(values: unknown[], expectedId: string) {
  const actualId = String(values[0] || "").trim();
  if (!expectedId || actualId !== expectedId.trim()) {
    throw new InputError("El expediente ha cambiado. Sincroniza los datos antes de continuar.");
  }
  return actualId;
}

function managementReason(value: unknown) {
  const reason = String(value || "").trim().slice(0, 500);
  if (reason.length < 5) throw new InputError("Indica un motivo de al menos 5 caracteres.");
  return reason;
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
    Object.entries(contractSource).slice(0, 60).map(([key, entry]) => [key, String(entry ?? "").trim()]),
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
    const signed = ["sí", "si"].includes(purchase.contractSigned.toLocaleLowerCase("es"));
    if (purchase.contractDetails.contractOrigin === "existing" && !signed) {
      throw new InputError("El contrato existente debe estar firmado antes de crear la compra.");
    }
    const commonContractFields = [
      ["buyerCompany", "empresa compradora"], ["signatureDate", "fecha de firma"],
      ["sellerEmail", "correo del agricultor"], ["companyEmail", "correo de la empresa"],
    ];
    const requiredContractFields = purchase.contractDetails.contractOrigin === "existing" ? commonContractFields : [
      ...commonContractFields,
      ["sellerRepresentative", "representante del vendedor"], ["sellerDni", "DNI del representante"],
      ["sellerAddress", "domicilio del vendedor"], ["organicOperatorCode", "código de operador ecológico"],
      ["modality", "modalidad de compraventa"], ["collectionBy", "responsable de recolección"],
      ["transportBy", "responsable de transporte"], ["paymentDays", "plazo de pago"],
      ["sellerSignedAt", "firma del vendedor"],
    ];
    if (purchase.contractDetails.contractOrigin !== "existing") {
      const priceField = purchase.contractDetails.modality === "POR TANTO" ? "totalPrice" : "pricePerKg";
      const priceLabel = purchase.contractDetails.modality === "POR TANTO" ? "precio total" : "precio por kg";
      if (!purchase.contractDetails[priceField]) requiredContractFields.push([priceField, priceLabel]);
      if (purchase.contractDetails.pricePerKg && purchase.contractDetails.totalPrice) {
        throw new InputError("Indica solo un tipo de precio: precio por kg o precio total.");
      }
    }
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

function purchaseIdPrefix(company: string) {
  const normalizedCompany = company.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("es");
  if (normalizedCompany.includes("TONIFRUIT")) return "TON";
  if (normalizedCompany.includes("ORGANICA")) return "MRO";
  throw new InputError("La empresa compradora no permite asignar una serie MRO o TON.");
}

async function currentPurchaseIds(env: Env) {
  const { start, end } = dataBounds(env);
  const range = `'${sheetName(env)}'!A${start}:A${end}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const result = await sheetsRequest<{ values?: unknown[][] }>(env, url);
  return (result.values || []).map((row) => String(row[0] ?? "").trim()).filter(Boolean);
}

async function generatedPurchaseId(env: Env, company: string) {
  const ids = await currentPurchaseIds(env);
  const highest = ids.reduce((maximum, id) => {
    const match = id.match(/^(?:MRO|TON)-(\d+)$/i);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `${purchaseIdPrefix(company)}-${String(highest + 1).padStart(3, "0")}`;
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
  let generatedId = purchase.id;
  if (!generatedId) generatedId = await generatedPurchaseId(env, String(purchase.contractDetails.buyerCompany || ""));
  if (create) {
    const expectedPrefix = purchaseIdPrefix(String(purchase.contractDetails.buyerCompany || ""));
    if (!new RegExp(`^${expectedPrefix}-\\d{3,}$`, "i").test(generatedId)) {
      throw new InputError(`El identificador debe usar la serie ${expectedPrefix}-XXX.`);
    }
    const existingIds = await currentPurchaseIds(env);
    if (existingIds.some((id) => id.toLocaleUpperCase("es") === generatedId.toLocaleUpperCase("es"))) {
      throw new InputError(`El identificador ${generatedId} ya existe. Actualiza la lista e inténtalo de nuevo.`);
    }
  }
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
  if (create) {
    data.push({ range: `'${sheet}'!AA${row}:AC${row}`, values: [["No", "", "No"]] });
    data.push({ range: `'${sheet}'!AJ${row}:AN${row}`, values: [["Activo", "", "", "", "[]"]] });
  }
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

async function updateRecordStatus(env: Env, row: number, value: unknown, session: Session) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = String(source.status || "").trim();
  if (status !== "Activo" && status !== "Anulado") throw new InputError("El estado del expediente no es válido.");
  const reason = managementReason(source.reason);
  const values = await loadRowValues(env, row);
  verifyExpectedId(values, String(source.expectedId || ""));
  const currentStatus = String(values[35] || "Activo").trim() || "Activo";
  if (currentStatus === status) throw new InputError(`El expediente ya está ${status.toLocaleLowerCase("es")}.`);
  const changedAt = new Date().toISOString();
  const changedBy = session.sub;
  const history = parseJsonHistory(values[39]);
  history.push({ status, reason, changedAt, changedBy });
  const statusHistoryJson = JSON.stringify(history.slice(-40));
  await batchSave(env, [{
    range: `'${sheetName(env)}'!AJ${row}:AN${row}`,
    values: [[status, reason, changedAt, changedBy, statusHistoryJson]],
  }]);
  return { recordStatus: status, statusReason: reason, statusUpdatedAt: changedAt, statusUpdatedBy: changedBy, statusHistoryJson };
}

async function replaceArchivedContract(env: Env, row: number, request: Request, session: Session) {
  const form = await request.formData();
  const reason = managementReason(form.get("reason"));
  const values = await loadRowValues(env, row);
  verifyExpectedId(values, String(form.get("expectedId") || ""));
  const contract = parseJsonRecord(values[34]);
  const previousArchiveId = String(contract.archiveId || "").trim();
  if (!previousArchiveId) throw new InputError("Este expediente todavía no tiene un contrato archivado que sustituir.");

  const archived = await storeContract(form, env);
  const replacedAt = new Date().toISOString();
  const history = parseJsonHistory(contract.archiveHistoryJson);
  history.push({
    archiveId: previousArchiveId,
    archiveFilename: String(contract.archiveFilename || "contrato-firmado.pdf"),
    archivedAt: String(contract.archivedAt || ""),
    replacedAt,
    replacedBy: session.sub,
    reason,
  });
  const updatedContract = {
    ...contract,
    contractOrigin: "existing",
    signatureMethod: "uploaded",
    archiveId: archived.archiveId,
    archiveFilename: archived.archiveFilename,
    archivedAt: archived.archivedAt,
    emailStatus: archived.emailStatus,
    archiveHistoryJson: JSON.stringify(history.slice(-20)),
  };

  try {
    await batchSave(env, [
      { range: `'${sheetName(env)}'!H${row}:H${row}`, values: [["Sí"]] },
      { range: `'${sheetName(env)}'!Y${row}:Y${row}`, values: [[`Archivo central: ${archived.archiveFilename}`]] },
      { range: `'${sheetName(env)}'!AI${row}:AI${row}`, values: [[JSON.stringify(updatedContract)]] },
    ]);
  } catch (error) {
    try {
      await env.CONTRACT_FILES?.delete(archived.archiveId);
    } catch {
      // El archivo queda inaccesible y podrá limpiarse posteriormente.
    }
    throw error;
  }

  return { ...archived, historyCount: history.length };
}

async function deleteRecordPermanently(env: Env, row: number, value: unknown, session: Session) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const expectedId = String(source.expectedId || "").trim();
  const confirmation = String(source.confirmation || "").trim();
  const acknowledgement = String(source.acknowledgement || "").trim();
  const reason = managementReason(source.reason);
  if (!expectedId || confirmation !== expectedId) throw new InputError("Escribe exactamente el identificador del expediente para confirmar.");
  if (acknowledgement !== "ELIMINAR DEFINITIVAMENTE") {
    throw new InputError("Confirma expresamente el borrado definitivo.");
  }

  const values = await loadRowValues(env, row);
  const deletedId = verifyExpectedId(values, expectedId);
  if (String(values[35] || "Activo").trim() !== "Anulado") {
    throw new InputError("Antes del borrado definitivo debes anular el expediente.");
  }

  const contract = parseJsonRecord(values[34]);
  const archivedIds = new Set<string>();
  const currentArchiveId = String(contract.archiveId || "").trim();
  if (currentArchiveId) archivedIds.add(currentArchiveId);
  const previousContractArchiveId = String(contract.previousContractArchiveId || "").trim();
  const previousContractSourceArchiveId = String(contract.previousContractSourceArchiveId || "").trim();
  if (previousContractArchiveId && previousContractArchiveId !== previousContractSourceArchiveId) archivedIds.add(previousContractArchiveId);
  for (const entry of parseJsonHistory(contract.archiveHistoryJson)) {
    const archiveId = String((entry as Record<string, unknown>).archiveId || "").trim();
    if (archiveId) archivedIds.add(archiveId);
  }

  const range = `'${sheetName(env)}'!A${row}:AN${row}`;
  const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}:clear`;
  await sheetsRequest(env, clearUrl, { method: "POST", body: "{}" });

  const deletedAt = new Date().toISOString();
  let archiveCleanupPending = false;
  if (env.CONTRACT_FILES) {
    try {
      const audit = encoder.encode(JSON.stringify({
        action: "delete_record",
        deletedId,
        provider: String(values[1] || "").trim(),
        row,
        reason,
        deletedAt,
        deletedBy: session.sub,
        deletedArchives: [...archivedIds],
      }));
      await env.CONTRACT_FILES.put(`audit/deletions/${crypto.randomUUID()}.json`, audit.buffer, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { deletedId, deletedAt, deletedBy: session.sub },
      });
      if (archivedIds.size) await env.CONTRACT_FILES.delete([...archivedIds]);
    } catch {
      archiveCleanupPending = archivedIds.size > 0;
    }
  } else {
    archiveCleanupPending = archivedIds.size > 0;
  }

  return { deletedId, deletedArchives: archivedIds.size, archiveCleanupPending };
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

  if (url.pathname === "/api/control-catalog" && request.method === "GET") {
    return json(request, env, {
      updatedAt: CONTROL_DATA_UPDATED_AT,
      certificates: CERTIFICATE_RECORDS,
      opfhMembers: OPFH_MEMBERS,
      farms: FARM_RECORDS,
      documents: CONTRACT_DOCUMENTS,
    });
  }

  if (url.pathname === "/api/document-library" && request.method === "POST") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede importar documentos." }, 403);
    return json(request, env, await storeLibraryDocument(request, env), 201);
  }

  const libraryDocumentMatch = url.pathname.match(/^\/api\/document-library\/([0-9a-f]{24})$/i);
  if (libraryDocumentMatch && request.method === "GET") {
    if (!env.CONTRACT_FILES) return json(request, env, { error: "La biblioteca documental no está configurada." }, 503);
    const document = libraryDocumentsById.get(libraryDocumentMatch[1]);
    if (!document) return json(request, env, { error: "El documento no pertenece al catálogo." }, 404);
    const object = await env.CONTRACT_FILES.get(`document-library/${document.id}`);
    if (!object) return json(request, env, { error: "Este documento todavía no se ha incorporado al archivo privado." }, 404);
    const filename = safeContractFilename(document.filename);
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || contentTypeForLibraryDocument(filename, ""),
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        ...corsHeaders(request, env),
      },
    });
  }

  if (url.pathname === "/api/contract-files" && request.method === "POST") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede archivar contratos." }, 403);
    return json(request, env, await archiveContract(request, env), 201);
  }

  if (url.pathname === "/api/previous-contract-files" && request.method === "POST") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede archivar contratos anteriores." }, 403);
    return json(request, env, await storePreviousContract(request, env), 201);
  }

  if (url.pathname === "/api/previous-contract-files/copy" && request.method === "POST") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede reutilizar contratos anteriores." }, 403);
    return json(request, env, await copyPreviousContract(await request.json().catch(() => ({})), env), 201);
  }

  const archivedContractMatch = url.pathname.match(/^\/api\/contract-files\/([0-9a-f-]{36})$/i);
  if (archivedContractMatch && request.method === "GET") {
    if (!env.CONTRACT_FILES) return json(request, env, { error: "El archivo central de contratos no está configurado." }, 503);
    const object = await env.CONTRACT_FILES.get(archivedContractMatch[1]);
    if (!object) return json(request, env, { error: "No se ha encontrado la copia firmada del contrato." }, 404);
    const filename = safeContractFilename(object.customMetadata?.filename || "contrato-firmado");
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        ...corsHeaders(request, env),
      },
    });
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

  const statusMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/status$/);
  if (statusMatch && request.method === "PATCH") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede cambiar el estado de expedientes." }, 403);
    const body = await request.json().catch(() => ({}));
    return json(request, env, { ok: true, ...await updateRecordStatus(env, Number(statusMatch[1]), body, session) });
  }

  const replacementMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/contract$/);
  if (replacementMatch && request.method === "POST") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede sustituir contratos." }, 403);
    return json(request, env, { ok: true, ...await replaceArchivedContract(env, Number(replacementMatch[1]), request, session) }, 201);
  }

  const deleteMatch = url.pathname.match(/^\/api\/rows\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede eliminar expedientes." }, 403);
    const body = await request.json().catch(() => ({}));
    return json(request, env, { ok: true, ...await deleteRecordPermanently(env, Number(deleteMatch[1]), body, session) });
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
