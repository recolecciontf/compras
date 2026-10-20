import { STATIC_ASSETS } from "./static-assets.generated";
import { CONTRACT_ASSETS } from "./contract-assets.generated";
import {
  CERTIFICATE_RECORDS,
  CONTROL_DATA_UPDATED_AT,
  FARM_RECORDS,
  OPFH_MEMBERS,
} from "./data/controlCatalog.generated";
import { CONTRACT_DOCUMENTS } from "./data/documentLibrary.generated";
import { SUPPORT_SUMMARIES } from "./data/supportCatalog.generated";
import { certificationSelection } from "../src/lib/catalog";

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
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
};

interface Env {
  ASSETS?: Fetcher;
  ALLOWED_ORIGINS?: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_SHA256: string;
  VIEWER_USERNAME: string;
  VIEWER_PASSWORD_SHA256: string;
  APP_USERS_JSON?: string;
  SESSION_SECRET: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  GOOGLE_SPREADSHEET_ID: string;
  GOOGLE_WORKSHEET_NAME?: string;
  GOOGLE_DATA_START_ROW?: string;
  GOOGLE_DATA_END_ROW?: string;
  GOOGLE_DRIVE_BACKUP_FOLDER_ID?: string;
  GOOGLE_DRIVE_TN_FOLDER_ID?: string;
  GOOGLE_DRIVE_MR_FOLDER_ID?: string;
  GOOGLE_DRIVE_BACKUP_WEBHOOK_URL?: string;
  GOOGLE_DRIVE_BACKUP_WEBHOOK_TOKEN?: string;
  CONTRACT_TEMPLATE_KEY: string;
  UVA_TEMPLATE_KEY?: string;
  CONTRACT_FILES?: ContractBucket;
  CONTRACT_EMAIL_WEBHOOK_URL?: string;
  CONTRACT_EMAIL_WEBHOOK_TOKEN?: string;
}

type UserRole = "admin" | "editor" | "viewer";

type Session = {
  sub: string;
  role: UserRole;
  displayName?: string;
  exp: number;
};

type ConfiguredUser = {
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
};

type AuditEventStatus = "pending" | "completed" | "failed";

type AuditEvent = {
  id: string;
  timestamp: string;
  completedAt?: string;
  actorUsername: string;
  actorDisplayName: string;
  role: UserRole;
  action: string;
  area: string;
  summary: string;
  recordId?: string;
  row?: number;
  status: AuditEventStatus;
  error?: string;
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
class ConflictError extends Error {}

const encoder = new TextEncoder();
let cachedGoogleToken = "";
let cachedGoogleTokenExpiresAt = 0;
let sheetSchemaReady = false;
const libraryDocumentsById = new Map(CONTRACT_DOCUMENTS.map((document) => [document.id, document]));
const LIVE_CATALOG_KEY = "catalog/control-documental.json";

async function controlCatalogData(env: Env) {
  const storedDocuments = await storedLibraryDocumentCount(env.CONTRACT_FILES).catch(() => 0);
  const fallback = {
    updatedAt: CONTROL_DATA_UPDATED_AT,
    certificates: CERTIFICATE_RECORDS,
    opfhMembers: OPFH_MEMBERS,
    farms: FARM_RECORDS,
    documents: CONTRACT_DOCUMENTS,
    storedDocuments,
  };
  if (!env.CONTRACT_FILES) return fallback;
  const object = await env.CONTRACT_FILES.get(LIVE_CATALOG_KEY).catch(() => null);
  if (!object) return fallback;
  const snapshot = await new Response(object.body).json().catch(() => null) as Record<string, unknown> | null;
  if (!snapshot) return fallback;
  return {
    updatedAt: String(snapshot.updatedAt || fallback.updatedAt),
    certificates: Array.isArray(snapshot.certificates) ? snapshot.certificates : fallback.certificates,
    opfhMembers: Array.isArray(snapshot.opfhMembers) ? snapshot.opfhMembers : fallback.opfhMembers,
    farms: Array.isArray(snapshot.farms) ? snapshot.farms : fallback.farms,
    documents: Array.isArray(snapshot.documents) ? snapshot.documents : fallback.documents,
    storedDocuments,
  };
}

async function libraryDocumentById(id: string, env: Env) {
  const generated = libraryDocumentsById.get(id);
  if (generated) return generated;
  const catalog = await controlCatalogData(env);
  return (catalog.documents as Array<Record<string, unknown>>).find((document) => String(document.id || "") === id) as (typeof CONTRACT_DOCUMENTS)[number] | undefined;
}

async function storeControlCatalog(request: Request, env: Env, session: Session) {
  if (!env.CONTRACT_FILES) throw new Error("El almacenamiento del cat�logo no est� configurado.");
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || ![body.certificates, body.opfhMembers, body.farms, body.documents].every(Array.isArray)) {
    throw new InputError("El cat�logo debe incluir certificados, socios OPFH, fincas y documentos.");
  }
  const snapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: session.sub,
    certificates: body.certificates,
    opfhMembers: body.opfhMembers,
    farms: body.farms,
    documents: body.documents,
  };
  const bytes = encoder.encode(JSON.stringify(snapshot));
  await env.CONTRACT_FILES.put(LIVE_CATALOG_KEY, bytes.buffer as ArrayBuffer, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { updatedAt: snapshot.updatedAt, updatedBy: session.sub, kind: "control_catalog" },
  });
  return snapshot;
}

async function storedLibraryDocumentCount(bucket?: ContractBucket) {
  if (!bucket) return 0;
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "document-library/", cursor, limit: 1000 });
    count += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return count;
}

function normalizedCatalogName(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(SOCIEDAD|LIMITADA|ANONIMA|SAT|S\s*A\s*T|SLU?|SA|SC|SCA|CB)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function catalogNamesMatch(left: unknown, right: unknown) {
  const a = normalizedCatalogName(left);
  const b = normalizedCatalogName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 10 && (a.includes(b) || b.includes(a))) return true;
  const leftTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  const common = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return common >= 2 && common / Math.min(leftTokens.size, rightTokens.size) >= 0.75;
}

function normalizedCatalogText(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("es");
}

function isArra19Record(values: unknown[]) {
  return normalizedCatalogText(`${values[1] || ""} ${values[5] || ""} ${values[29] || ""}`).includes("ARRA 19")
    || normalizedCatalogText(values[1]).includes("LAS HACIENDAS");
}

function libraryDocumentScore(document: (typeof CONTRACT_DOCUMENTS)[number], values: unknown[]) {
  const crop = normalizedCatalogText(values[5]);
  const variety = normalizedCatalogText(values[29]);
  const campaign = String(values[6] || "").trim();
  const details = parseJsonRecord(values[34]);
  const buyer = normalizedCatalogText(details.buyerCompany);
  const company = normalizedCatalogText(document.company);
  let score = 0;
  if (campaign && document.campaign === campaign) score += 5;
  if (document.species.some((value) => crop && normalizedCatalogText(value).includes(crop))) score += 5;
  if (document.varieties.some((value) => variety && (variety.includes(normalizedCatalogText(value)) || normalizedCatalogText(value).includes(variety)))) score += 3;
  if (buyer && company && (buyer.includes(company) || company.includes(buyer))) score += 8;
  if (document.documentType === "Contrato firmado") score += 8;
  else if (document.documentType === "Contrato") score += 4;
  if (document.extension === "PDF") score += 2;
  if (/FDO\.?|FIRMAD|JUSTIFICANTE.*INSCRIPCI/i.test(document.filename)) score += 5;
  return score;
}

export function enrichRowsFromPrivateCatalog(rows: Array<{ index: number; values: unknown[]; revision?: string }>) {
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((row) => {
    const values = [...row.values];
    if (isArra19Record(values)) return { ...row, values };
    const provider = String(values[1] || "").trim();
    const existingDetails = parseJsonRecord(values[34]);
    const hasManagedContract = [
      existingDetails.contractOrigin,
      existingDetails.archiveId,
      existingDetails.signatureMethod,
      existingDetails.sellerSignedAt,
      existingDetails.buyerSignedAt,
    ].some((value) => String(value || "").trim());
    const documents = CONTRACT_DOCUMENTS
      .filter((document) => catalogNamesMatch(provider, document.farmer))
      .sort((left, right) => libraryDocumentScore(right, values) - libraryDocumentScore(left, values) || right.modified.localeCompare(left.modified));
    // La biblioteca histórica sirve para completar expedientes antiguos que
    // todavía no tienen gestión contractual propia. Un contrato recién creado
    // nunca debe heredar como firmado el PDF de una campaña anterior del mismo
    // agricultor.
    const signedDocument = hasManagedContract
      ? undefined
      : documents.find((document) => document.documentType === "Contrato firmado" && document.extension === "PDF")
        || documents.find((document) => document.documentType === "Contrato" && document.extension === "PDF")
        || documents.find((document) => document.extension === "PDF");
    const managedBuyer = normalizedCatalogText(existingDetails.buyerCompany);
    const selectedCompany = managedBuyer.includes("TONIFRUIT")
      ? "TOÑIFRUIT"
      : managedBuyer.includes("ORGANICA")
        ? "MR. ORGÁNICA"
        : signedDocument?.company;
    // La certificación pertenece al agricultor/titular, no a la carpeta de la
    // empresa compradora. Cruzar por selectedCompany hacía desaparecer, entre
    // otras, Naturland cuando el contrato estaba archivado en la otra empresa.
    const certificates = CERTIFICATE_RECORDS
      .filter((record) => catalogNamesMatch(provider, record.farmer))
      .sort((left, right) => {
        const leftScore = (left.expiry >= today ? 10 : 0) + (normalizedCatalogText(left.certification).includes("ECO") ? 4 : 0);
        const rightScore = (right.expiry >= today ? 10 : 0) + (normalizedCatalogText(right.certification).includes("ECO") ? 4 : 0);
        return rightScore - leftScore || right.expiry.localeCompare(left.expiry);
      });
    const support = SUPPORT_SUMMARIES.find((entry) => catalogNamesMatch(provider, entry.farmer) && (!selectedCompany || entry.company === selectedCompany));
    const farms = FARM_RECORDS.filter((farm) => catalogNamesMatch(provider, farm.holder));

    if (signedDocument) {
      values[7] = "Sí";
      values[24] = `Biblioteca contractual privada · ${documents.length} documento${documents.length === 1 ? "" : "s"}`;
      values[34] = JSON.stringify({
        ...existingDetails,
        contractOrigin: "existing",
        buyerCompany: signedDocument.company === "TOÑIFRUIT" ? "TOÑIFRUIT, S.L." : "MR. ORGÁNICA, S.L.",
        signatureDate: String(existingDetails.signatureDate || signedDocument.modified.slice(0, 10)),
        archiveId: signedDocument.id,
        archiveFilename: signedDocument.filename,
        archivedAt: signedDocument.modified,
        signatureMethod: "uploaded",
      });
    }
    if (documents.some((document) => document.documentType === "Justificante / registro")) values[32] = "Sí";
    if (certificates[0]) {
      values[17] = certificationSelection(certificates.map((record) => record.certification).join("; ")).join("; ");
      values[18] = certificates[0].expiry;
    }
    if (farms.length) {
      if (!String(values[3] || "").trim()) values[3] = [...new Set(farms.map((farm) => farm.farmName).filter(Boolean))].slice(0, 4).join(" · ") || "Fincas documentadas";
      if (!String(values[4] || "").trim()) values[4] = [...new Set(farms.map((farm) => farm.municipality).filter(Boolean))].join(" · ");
      values[12] = "Sí";
    }
    if (support) {
      if (support.notebookCount > 0) {
        values[13] = "Sí";
        values[14] = support.notebookLatest.slice(0, 10);
      }
      if (support.analysisCount > 0) {
        if (!String(values[15] || "").trim()) values[15] = "Pendiente de revisión";
        values[16] = support.analysisLatest.slice(0, 10);
      }
      if (support.otherCount > 0 || support.certificateFileCount > 0) values[19] = "Sí";
      if (!String(values[20] || "").trim()) values[20] = "Actualización documental 12/08/2026";
      values[21] = today;
    }
    return { ...row, values };
  });
}

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

async function issueSession(env: Env, user: Pick<ConfiguredUser, "username" | "displayName" | "role">) {
  const payload = base64Url(encoder.encode(JSON.stringify({
    sub: user.username,
    role: user.role,
    displayName: user.displayName,
    exp: Date.now() + 8 * 60 * 60 * 1000,
  })));
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
      (parsed.role !== "admin" && parsed.role !== "editor" && parsed.role !== "viewer") ||
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
  const users: ConfiguredUser[] = [
    {
      username: normalizeUsername(env.ADMIN_USERNAME || "ADMINISTRADOR"),
      displayName: "Administrador",
      passwordHash: env.ADMIN_PASSWORD_SHA256 || "",
      role: "admin" as const,
    },
  ];
  try {
    const parsed = JSON.parse(env.APP_USERS_JSON || "[]") as unknown;
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object") continue;
        const source = entry as Record<string, unknown>;
        const username = normalizeUsername(String(source.username || ""));
        const displayName = String(source.displayName || username).trim();
        const passwordHash = String(source.passwordHash || "").trim().toLocaleLowerCase("en");
        const role = source.role === "viewer" ? "viewer" : "editor";
        if (!username || !displayName || !/^[a-f0-9]{64}$/.test(passwordHash)) continue;
        if (!users.some((user) => user.username === username)) users.push({ username, displayName, passwordHash, role });
      }
    }
  } catch {
    // Una configuración no válida no debe impedir el acceso del Administrador.
  }
  const viewerUsername = normalizeUsername(env.VIEWER_USERNAME || "CONSULTAS");
  if (!users.some((user) => user.username === viewerUsername)) {
    users.push({
      username: viewerUsername,
      displayName: "Consultas",
      passwordHash: env.VIEWER_PASSWORD_SHA256 || "",
      role: "viewer",
    });
  }
  return users;
}

function profileFor(session: Pick<Session, "sub" | "role" | "displayName">) {
  return {
    displayName: session.displayName || (session.role === "admin" ? "Administrador" : session.role === "viewer" ? "Consultas" : session.sub),
    userPrincipalName: session.sub,
    role: session.role,
    canEdit: session.role === "admin" || session.role === "editor",
  };
}

function canEdit(session: Session) {
  return session.role === "admin" || session.role === "editor";
}

function auditKey(event: AuditEvent) {
  const sortableTimestamp = event.timestamp.replace(/[:.]/g, "-");
  return `audit/events/${sortableTimestamp}-${event.id}.json`;
}

async function storeAuditEvent(env: Env, event: AuditEvent) {
  if (!env.CONTRACT_FILES) throw new Error("El registro de actividad no está configurado.");
  const bytes = encoder.encode(JSON.stringify(event));
  await env.CONTRACT_FILES.put(auditKey(event), bytes.buffer as ArrayBuffer, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      actor: event.actorUsername,
      action: event.action,
      status: event.status,
      recordId: event.recordId || "",
    },
  });
}

async function runAuditedChange<T>(
  env: Env,
  session: Session,
  input: Pick<AuditEvent, "action" | "area" | "summary" | "recordId" | "row">,
  operation: () => Promise<T>,
) {
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actorUsername: session.sub,
    actorDisplayName: profileFor(session).displayName,
    role: session.role,
    action: input.action,
    area: input.area,
    summary: input.summary,
    recordId: input.recordId,
    row: input.row,
    status: "pending",
  };
  await storeAuditEvent(env, event);
  try {
    const result = await operation();
    await storeAuditEvent(env, { ...event, status: "completed", completedAt: new Date().toISOString() });
    return result;
  } catch (error) {
    await storeAuditEvent(env, {
      ...event,
      status: "failed",
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message.slice(0, 300) : "Error no identificado",
    }).catch(() => undefined);
    throw error;
  }
}

async function listAuditEvents(env: Env, limit: number) {
  if (!env.CONTRACT_FILES) throw new Error("El registro de actividad no está configurado.");
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.CONTRACT_FILES.list({ prefix: "audit/events/", cursor, limit: 1000 });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && keys.length < 5000);
  const latest = keys.sort().reverse().slice(0, Math.min(Math.max(limit, 1), 300));
  const events = await Promise.all(latest.map(async (key) => {
    const object = await env.CONTRACT_FILES!.get(key);
    if (!object) return null;
    return new Response(object.body).json().catch(() => null) as Promise<AuditEvent | null>;
  }));
  return events.filter((event): event is AuditEvent => Boolean(event));
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
  const configuredKey = env.CONTRACT_TEMPLATE_KEY;
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

type DriveBackupStatus = "stored" | "pending_configuration" | "failed";

type DriveBackupResult = {
  status: DriveBackupStatus;
  fileId: string;
  filename: string;
  folderId: string;
};

export function driveBackupFolderId(env: Env, buyerCompany: string, contractNumber: string) {
  const identity = `${buyerCompany} ${contractNumber}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es");
  if ((identity.includes("MR. ORGANICA") || /\bMRO?-/.test(identity)) && env.GOOGLE_DRIVE_MR_FOLDER_ID) {
    return env.GOOGLE_DRIVE_MR_FOLDER_ID;
  }
  if ((identity.includes("TONIFRUIT") || /\bTN-/.test(identity)) && env.GOOGLE_DRIVE_TN_FOLDER_ID) {
    return env.GOOGLE_DRIVE_TN_FOLDER_ID;
  }
  return env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || "";
}

function driveBackupFilename(filename: string, provider: string, contractNumber: string, documentKind: string) {
  const kind = documentKind === "previous_contract_reference"
    ? "ANTERIOR"
    : documentKind === "generated_draft" ? "BORRADOR" : "FIRMADO";
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
  return safeContractFilename(`${date} - ${contractNumber || "SIN REFERENCIA"} - ${provider} - ${kind} - ${filename}`);
}

async function uploadContractBackupToDrive(
  env: Env,
  bytes: ArrayBuffer,
  metadata: {
    archiveId: string;
    filename: string;
    contentType: string;
    provider: string;
    buyerCompany: string;
    contractNumber: string;
    documentKind: string;
  },
): Promise<DriveBackupResult> {
  const folderId = driveBackupFolderId(env, metadata.buyerCompany, metadata.contractNumber);
  if (!folderId || !env.GOOGLE_DRIVE_BACKUP_WEBHOOK_URL || !env.GOOGLE_DRIVE_BACKUP_WEBHOOK_TOKEN) {
    return { status: "pending_configuration", fileId: "", filename: "", folderId };
  }

  const filename = driveBackupFilename(metadata.filename, metadata.provider, metadata.contractNumber, metadata.documentKind);
  try {
    const source = new Uint8Array(bytes);
    let binary = "";
    for (let offset = 0; offset < source.length; offset += 0x8000) {
      binary += String.fromCharCode(...source.subarray(offset, Math.min(offset + 0x8000, source.length)));
    }
    const response = await fetch(env.GOOGLE_DRIVE_BACKUP_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        token: env.GOOGLE_DRIVE_BACKUP_WEBHOOK_TOKEN,
        action: "upload",
        folderId,
        filename,
        contentType: metadata.contentType,
        archiveId: metadata.archiveId,
        provider: metadata.provider,
        contractNumber: metadata.contractNumber,
        documentKind: metadata.documentKind,
        fileBase64: btoa(binary),
      }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; id?: string; name?: string; error?: string };
    if (!response.ok || !result.ok || !result.id) throw new Error(result.error || "Google Drive no ha aceptado la copia.");
    return { status: "stored", fileId: result.id, filename: result.name || filename, folderId };
  } catch (error) {
    console.error("Drive contract backup failed", error);
    return { status: "failed", fileId: "", filename, folderId };
  }
}

async function googleDriveBackupStatus(env: Env) {
  const configuredFolders = [
    ["Copia general", env.GOOGLE_DRIVE_BACKUP_FOLDER_ID],
    ["Toñifruit", env.GOOGLE_DRIVE_TN_FOLDER_ID],
    ["Mr. Orgánica", env.GOOGLE_DRIVE_MR_FOLDER_ID],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (!configuredFolders.length || !env.GOOGLE_DRIVE_BACKUP_WEBHOOK_URL || !env.GOOGLE_DRIVE_BACKUP_WEBHOOK_TOKEN) {
    return { configured: false, folders: [] };
  }
  const folders = await Promise.all(configuredFolders.map(async ([label, id]) => {
    const response = await fetch(env.GOOGLE_DRIVE_BACKUP_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ token: env.GOOGLE_DRIVE_BACKUP_WEBHOOK_TOKEN, action: "status", folderId: id }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; id?: string; name?: string; error?: string };
    if (!response.ok || !result.ok || !result.id) throw new Error(result.error || `No se puede acceder a ${label}.`);
    return { label, id: result.id, name: result.name || label };
  }));
  return { configured: true, folders };
}

async function sendContractCopies(
  env: Env,
  bytes: ArrayBuffer,
  metadata: { filename: string; contentType: string; provider: string; sellerEmail: string; companyEmail: string; contractNumber: string },
) {
  if (!env.CONTRACT_EMAIL_WEBHOOK_URL || !metadata.sellerEmail || !metadata.companyEmail) return "pending_configuration" as const;
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
  if (!(file instanceof File)) throw new InputError("Adjunta el contrato.");
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new InputError("El contrato debe ocupar entre 1 byte y 10 MB.");
  const allowed = [
    "application/pdf",
    "application/octet-stream",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  if (file.type && !allowed.includes(file.type)) throw new InputError("El contrato debe ser un archivo PDF o Word.");
  if (!/\.(pdf|docx)$/i.test(file.name)) throw new InputError("El archivo debe tener extensión PDF o DOCX.");

  const metadata = {
    filename: safeContractFilename(file.name),
    contentType: file.type || "application/octet-stream",
    provider: String(form.get("provider") || "").trim().slice(0, 180),
    sellerEmail: String(form.get("sellerEmail") || "").trim().slice(0, 254),
    companyEmail: String(form.get("companyEmail") || "").trim().slice(0, 254),
    contractNumber: String(form.get("contractNumber") || "").trim().slice(0, 80),
    buyerCompany: String(form.get("buyerCompany") || "").trim().slice(0, 120),
    documentKind: String(form.get("documentKind") || "signed_contract").trim().slice(0, 50),
  };
  if (!metadata.provider) throw new InputError("Falta identificar al agricultor o proveedor.");
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if ((metadata.sellerEmail && !emailPattern.test(metadata.sellerEmail)) || (metadata.companyEmail && !emailPattern.test(metadata.companyEmail))) {
    throw new InputError("Revisa el formato del correo del agricultor y del correo de la empresa.");
  }

  const bytes = await file.arrayBuffer();
  const archiveId = crypto.randomUUID();
  const archivedAt = new Date().toISOString();
  const putArchive = (
    emailStatus: "sent" | "pending_configuration" | "failed",
    driveBackup: DriveBackupResult,
  ) => env.CONTRACT_FILES!.put(archiveId, bytes, {
    httpMetadata: { contentType: metadata.contentType },
    customMetadata: {
      filename: metadata.filename,
      provider: metadata.provider,
      sellerEmail: metadata.sellerEmail,
      companyEmail: metadata.companyEmail,
      contractNumber: metadata.contractNumber,
      buyerCompany: metadata.buyerCompany,
      documentKind: metadata.documentKind,
      archivedAt,
      emailStatus,
      driveBackupStatus: driveBackup.status,
      driveBackupFileId: driveBackup.fileId,
      driveBackupFilename: driveBackup.filename,
      driveBackupFolderId: driveBackup.folderId,
    },
  });
  const pendingBackup: DriveBackupResult = { status: "pending_configuration", fileId: "", filename: "", folderId: "" };
  await putArchive("pending_configuration", pendingBackup);
  const sendCopies = String(form.get("sendCopies") || "true").toLocaleLowerCase("es") !== "false";
  const [emailStatus, driveBackup] = await Promise.all([
    sendCopies ? sendContractCopies(env, bytes, metadata) : Promise.resolve("pending_configuration" as const),
    uploadContractBackupToDrive(env, bytes, { ...metadata, archiveId }),
  ]);
  await putArchive(emailStatus, driveBackup);
  return {
    archiveId,
    archiveFilename: metadata.filename,
    archivedAt,
    emailStatus,
    driveBackupStatus: driveBackup.status,
    driveBackupFileId: driveBackup.fileId,
    driveBackupFilename: driveBackup.filename,
  };
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
  const document = await libraryDocumentById(id, env);
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
  const bytes = await file.arrayBuffer();
  const buyerCompany = String(form.get("buyerCompany") || "").trim().slice(0, 120);
  const contractNumber = String(form.get("contractNumber") || form.get("sourcePurchaseId") || "").trim().slice(0, 80);
  const driveBackup = await uploadContractBackupToDrive(env, bytes, {
    archiveId: previousContractArchiveId,
    filename: previousContractFilename,
    contentType: file.type || "application/pdf",
    provider,
    buyerCompany,
    contractNumber,
    documentKind: "previous_contract_reference",
  });
  await env.CONTRACT_FILES.put(previousContractArchiveId, bytes, {
    httpMetadata: { contentType: file.type || "application/pdf" },
    customMetadata: {
      filename: previousContractFilename,
      provider,
      sourcePurchaseId: String(form.get("sourcePurchaseId") || "").trim().slice(0, 80),
      buyerCompany,
      storedAt: previousContractStoredAt,
      kind: "previous_contract_reference",
      driveBackupStatus: driveBackup.status,
      driveBackupFileId: driveBackup.fileId,
      driveBackupFilename: driveBackup.filename,
      driveBackupFolderId: driveBackup.folderId,
    },
  });
  return { previousContractArchiveId, previousContractFilename, previousContractStoredAt, driveBackupStatus: driveBackup.status };
}

async function copyPreviousContract(value: unknown, env: Env) {
  if (!env.CONTRACT_FILES) throw new Error("El archivo central de contratos no está configurado.");
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const archiveId = String(source.archiveId || "").trim();
  const isArchivedContract = /^[0-9a-f-]{36}$/i.test(archiveId);
  const libraryDocument = /^[0-9a-f]{24}$/i.test(archiveId) ? await libraryDocumentById(archiveId, env) : undefined;
  if (!isArchivedContract && !libraryDocument) throw new InputError("Selecciona un contrato anterior válido.");
  const sourceKey = libraryDocument ? `document-library/${archiveId}` : archiveId;
  const original = await env.CONTRACT_FILES.get(sourceKey);
  if (!original) throw new InputError("El contrato anterior seleccionado ya no está disponible.");
  const previousContractArchiveId = crypto.randomUUID();
  const previousContractFilename = safeContractFilename(original.customMetadata?.filename || libraryDocument?.filename || "contrato-anterior.pdf");
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

export async function rowRevision(values: unknown[]) {
  const normalized = Array.from({ length: 40 }, (_, index) => values[index] ?? "");
  return sha256Hex(JSON.stringify(normalized));
}

export async function verifyExpectedRevision(values: unknown[], expectedRevision: string) {
  if (!expectedRevision) return;
  const currentRevision = await rowRevision(values);
  if (currentRevision !== expectedRevision) {
    throw new ConflictError("Este expediente ha cambiado en otro dispositivo. Actualiza los datos y revisa tus cambios antes de volver a guardar.");
  }
}

function backupPrefix(row: number, recordId: string) {
  const safeId = recordId.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "sin-id";
  return `backups/rows/${row}/${safeId}/`;
}

async function pruneRowBackups(bucket: ContractBucket, prefix: string) {
  const page = await bucket.list({ prefix, limit: 1000 });
  const keys = page.objects.map((object) => object.key).sort().reverse();
  const minimumBucket = Math.floor((Date.now() - 365 * 86_400_000) / 300_000);
  const expired = keys.filter((key, index) => {
    if (index >= 50) return true;
    const name = key.slice(prefix.length);
    const bucketNumber = Number(name.match(/^(\d+)/)?.[1] || "0");
    return bucketNumber > 0 && bucketNumber < minimumBucket;
  });
  if (expired.length) await bucket.delete(expired);
}

async function backupRow(
  env: Env,
  row: number,
  values: unknown[],
  session: Session,
  reason: string,
  force = false,
) {
  if (!env.CONTRACT_FILES) return;
  const recordId = String(values[0] || "").trim();
  if (!recordId) return;
  const prefix = backupPrefix(row, recordId);
  const bucket = Math.floor(Date.now() / 300_000);
  const key = `${prefix}${bucket}${force ? `-${crypto.randomUUID()}` : ""}.json`;
  if (!force && await env.CONTRACT_FILES.get(key)) return;
  const payload = encoder.encode(JSON.stringify({
    version: 1,
    row,
    recordId,
    savedAt: new Date().toISOString(),
    savedBy: session.sub,
    reason,
    values: Array.from({ length: 40 }, (_, index) => values[index] ?? ""),
  }));
  await env.CONTRACT_FILES.put(key, payload.buffer as ArrayBuffer, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { recordId, savedBy: session.sub, reason: reason.slice(0, 180) },
  });
  await pruneRowBackups(env.CONTRACT_FILES, prefix).catch(() => undefined);
}

async function prepareRowMutation(
  env: Env,
  row: number,
  source: Record<string, unknown>,
  session: Session,
  reason: string,
) {
  const values = await loadRowValues(env, row);
  verifyExpectedId(values, String(source.expectedId || ""));
  await verifyExpectedRevision(values, String(source.expectedRevision || ""));
  await backupRow(env, row, values, session, reason);
  return values;
}

async function mutationRevision(env: Env, row: number) {
  return rowRevision(await loadRowValues(env, row));
}

async function listRowBackups(env: Env, row: number, expectedId: string) {
  if (!env.CONTRACT_FILES) return [];
  const values = await loadRowValues(env, row);
  const recordId = verifyExpectedId(values, expectedId);
  const prefix = backupPrefix(row, recordId);
  const page = await env.CONTRACT_FILES.list({ prefix, limit: 1000 });
  const keys = page.objects.map((object) => object.key).sort().reverse().slice(0, 20);
  const backups = await Promise.all(keys.map(async (key) => {
    const object = await env.CONTRACT_FILES!.get(key);
    if (!object) return null;
    const payload = await new Response(object.body).json().catch(() => ({})) as Record<string, unknown>;
    return {
      key,
      savedAt: String(payload.savedAt || ""),
      savedBy: String(payload.savedBy || ""),
      reason: String(payload.reason || "Copia autom�tica"),
    };
  }));
  return backups.filter(Boolean);
}

async function restoreRowBackup(env: Env, row: number, value: unknown, session: Session) {
  if (!env.CONTRACT_FILES) throw new Error("Las copias recuperables no est�n configuradas.");
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const current = await prepareRowMutation(env, row, source, session, "Antes de restaurar una copia");
  const recordId = String(current[0] || "").trim();
  const prefix = backupPrefix(row, recordId);
  const key = String(source.key || "");
  if (!key.startsWith(prefix) || !key.endsWith(".json")) throw new InputError("La copia seleccionada no pertenece a este expediente.");
  const object = await env.CONTRACT_FILES.get(key);
  if (!object) throw new InputError("La copia seleccionada ya no est� disponible.");
  const payload = await new Response(object.body).json().catch(() => ({})) as { recordId?: string; values?: unknown[] };
  if (payload.recordId !== recordId || !Array.isArray(payload.values)) throw new InputError("La copia seleccionada no es v�lida.");
  await backupRow(env, row, current, session, "Estado anterior a la restauraci�n", true);
  await batchSave(env, [{
    range: `'${sheetName(env)}'!A${row}:AN${row}`,
    values: [Array.from({ length: 40 }, (_, index) => payload.values?.[index] ?? "")],
  }]);
  return { revision: await mutationRevision(env, row) };
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

export function validatePurchase(purchase: PurchasePayload, requireComplete = true) {
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
    ];
    const requiresSellerSignature = purchase.contractDetails.contractOrigin !== "existing"
      && purchase.contractDetails.signatureMethod !== "external_pending";
    const requiredContractFields = purchase.contractDetails.contractOrigin === "existing" ? commonContractFields : [
      ...commonContractFields,
      ["modality", "modalidad de compraventa"], ["collectionBy", "responsable de recolección"],
      ["transportBy", "responsable de transporte"], ["paymentDays", "plazo de pago"],
    ];
    if (requiresSellerSignature) requiredContractFields.push(["sellerSignedAt", "firma del vendedor"]);
    if (purchase.contractDetails.sellerRepresentative && !purchase.contractDetails.sellerDni) {
      requiredContractFields.push(["sellerDni", "DNI del representante"]);
    }
    if (purchase.contractDetails.contractOrigin !== "existing") {
      const priceField = purchase.contractDetails.modality === "POR TANTO" ? "totalPrice" : "pricePerKg";
      const priceLabel = purchase.contractDetails.modality === "POR TANTO" ? "precio total" : "precio por kg";
      if (!purchase.contractDetails[priceField]) requiredContractFields.push([priceField, priceLabel]);
      if (purchase.contractDetails.pricePerKg && purchase.contractDetails.totalPrice) {
        throw new InputError("Indica solo un tipo de precio: precio por kg o precio total.");
      }
      const cutMinMm = String(purchase.contractDetails.cutMinMm || "").trim();
      const cutMaxMm = String(purchase.contractDetails.cutMaxMm || "").trim();
      const minimum = cutMinMm ? Number(cutMinMm.replace(",", ".")) : null;
      const maximum = cutMaxMm ? Number(cutMaxMm.replace(",", ".")) : null;
      if ((minimum !== null && (!Number.isFinite(minimum) || minimum <= 0))
        || (maximum !== null && (!Number.isFinite(maximum) || maximum <= 0))) {
        throw new InputError("Los milímetros indicados deben ser números superiores a cero.");
      }
      if (minimum !== null && maximum !== null) {
        if (minimum > maximum) throw new InputError("El calibre mínimo no puede ser superior al máximo.");
      }
    }
    const missingContract = requiredContractFields.filter(([key]) => !purchase.contractDetails[key]).map(([, label]) => label);
    if (missingContract.length) throw new InputError(`Faltan datos del contrato: ${missingContract.join(", ")}.`);
    if (purchase.contractDetails.applyDestrio === "Sí") {
      const missingDestrio = ["destrioLocation", "destrioDefects"].filter((key) => !purchase.contractDetails[key]?.trim());
      if (missingDestrio.length) throw new InputError("Completa el lugar y los defectos del destrío.");
      if (!["Campo", "Almacén"].includes(purchase.contractDetails.destrioLocation)) throw new InputError("Selecciona Campo o Almacén como lugar del destrío.");
      const destrioPrice = purchase.contractDetails.destrioPrice?.trim();
      if (destrioPrice && (!Number.isFinite(Number(destrioPrice.replace(",", "."))) || Number(destrioPrice.replace(",", ".")) < 0)) {
        throw new InputError("El precio del destrío debe ser un número igual o superior a cero.");
      }
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
  if (normalizedCompany.includes("TONIFRUIT")) return "TN";
  if (normalizedCompany.includes("ORGANICA")) return "MR";
  throw new InputError("La empresa compradora no permite asignar una serie MR o TN.");
}

async function currentPurchaseIds(env: Env) {
  const { start, end } = dataBounds(env);
  const range = `'${sheetName(env)}'!A${start}:A${end}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const result = await sheetsRequest<{ values?: unknown[][] }>(env, url);
  return (result.values || []).map((row) => String(row[0] ?? "").trim()).filter(Boolean);
}

export function nextPurchaseIdForCompany(ids: string[], company: string) {
  const prefix = purchaseIdPrefix(company);
  const highest = ids.reduce((maximum, id) => {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(2, "0")}`;
}

async function generatedPurchaseId(env: Env, company: string) {
  return nextPurchaseIdForCompany(await currentPurchaseIds(env), company);
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
    if (!new RegExp(`^${expectedPrefix}-\\d{2,}$`, "i").test(generatedId)) {
      throw new InputError(`El identificador debe usar la serie ${expectedPrefix}-XX.`);
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
  const values = await prepareRowMutation(env, row, source, session, `Cambio de estado a ${status}`);
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
  return { recordStatus: status, statusReason: reason, statusUpdatedAt: changedAt, statusUpdatedBy: changedBy, statusHistoryJson, revision: await mutationRevision(env, row) };
}

async function replaceArchivedContract(env: Env, row: number, request: Request, session: Session) {
  const form = await request.formData();
  const reason = managementReason(form.get("reason"));
  const values = await prepareRowMutation(env, row, {
    expectedId: form.get("expectedId"),
    expectedRevision: form.get("expectedRevision"),
  }, session, "Sustituci�n del contrato firmado");
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
    driveBackupStatus: archived.driveBackupStatus,
    driveBackupFileId: archived.driveBackupFileId,
    driveBackupFilename: archived.driveBackupFilename,
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

  return { ...archived, historyCount: history.length, revision: await mutationRevision(env, row) };
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

  const values = await prepareRowMutation(env, row, source, session, "Antes del borrado definitivo");
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
    const profile = profileFor({ sub: user.username, role: user.role, displayName: user.displayName });
    return json(request, env, { token: await issueSession(env, user), profile });
  }

  const session = await verifySession(requestToken(request), env);
  if (!session) {
    return json(request, env, { error: "La sesión ha caducado. Vuelve a iniciar sesión." }, 401);
  }

  if (url.pathname === "/api/profile" && request.method === "GET") {
    return json(request, env, profileFor(session));
  }

  if (url.pathname === "/api/audit-events" && request.method === "GET") {
    if (session.role !== "admin") return json(request, env, { error: "El registro completo de actividad está restringido al Administrador." }, 403);
    const limit = Number(url.searchParams.get("limit") || "150");
    return json(request, env, { events: await listAuditEvents(env, Number.isFinite(limit) ? limit : 150) });
  }

  if (url.pathname === "/api/control-catalog" && request.method === "GET") {
    const catalog = await controlCatalogData(env);
    return json(request, env, session.role === "admin" ? catalog : {
      updatedAt: catalog.updatedAt,
      certificates: catalog.certificates.map((certificate) => ({
        ...certificate,
        taxId: "",
        opfhMember: false,
        farmType: "",
      })),
      opfhMembers: [],
      farms: [],
      documents: [],
      storedDocuments: 0,
    });
  }

  if (url.pathname === "/api/control-catalog" && request.method === "POST") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede actualizar el cat�logo." }, 403);
    const result = await runAuditedChange(env, session, {
      action: "catalog.update",
      area: "certificates",
      summary: "Actualización del catálogo documental",
    }, () => storeControlCatalog(request, env, session));
    return json(request, env, { ok: true, ...result });
  }

  if (url.pathname === "/api/document-library" && request.method === "POST") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede importar documentos." }, 403);
    const result = await runAuditedChange(env, session, {
      action: "document.upload",
      area: "documents",
      summary: "Documento incorporado a la biblioteca privada",
    }, () => storeLibraryDocument(request, env));
    return json(request, env, result, 201);
  }

  const libraryDocumentMatch = url.pathname.match(/^\/api\/document-library\/([0-9a-f]{24})$/i);
  if (libraryDocumentMatch && request.method === "GET") {
    if (session.role !== "admin") return json(request, env, { error: "La biblioteca contractual es confidencial y su descarga est� restringida al Administrador." }, 403);
    if (!env.CONTRACT_FILES) return json(request, env, { error: "La biblioteca documental no está configurada." }, 503);
    const document = await libraryDocumentById(libraryDocumentMatch[1], env);
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
    if (!canEdit(session)) return json(request, env, { error: "Este usuario es de consulta y no puede archivar contratos." }, 403);
    if (!env.CONTRACT_FILES) return json(request, env, { error: "El archivo central de contratos no está configurado." }, 500);
    const result = await runAuditedChange(env, session, {
      action: "contract.archive",
      area: "contracts",
      summary: "Contrato guardado en el archivo central",
    }, () => archiveContract(request, env));
    return json(request, env, result, 201);
  }

  if (url.pathname === "/api/drive-backup/status" && request.method === "GET") {
    if (session.role !== "admin") return json(request, env, { error: "La copia externa está restringida al Administrador." }, 403);
    return json(request, env, await googleDriveBackupStatus(env));
  }

  if (url.pathname === "/api/previous-contract-files" && request.method === "POST") {
    if (!canEdit(session)) return json(request, env, { error: "Este usuario es de consulta y no puede archivar contratos anteriores." }, 403);
    const result = await runAuditedChange(env, session, {
      action: "contract.previous.upload",
      area: "contracts",
      summary: "Contrato anterior guardado como referencia",
    }, () => storePreviousContract(request, env));
    return json(request, env, result, 201);
  }

  if (url.pathname === "/api/previous-contract-files/copy" && request.method === "POST") {
    if (!canEdit(session)) return json(request, env, { error: "Este usuario es de consulta y no puede reutilizar contratos anteriores." }, 403);
    const body = await request.json().catch(() => ({}));
    const result = await runAuditedChange(env, session, {
      action: "contract.previous.copy",
      area: "contracts",
      summary: "Contrato anterior reutilizado como referencia",
      recordId: String((body as Record<string, unknown>).purchaseId || ""),
    }, () => copyPreviousContract(body, env));
    return json(request, env, result, 201);
  }

  const archivedContractMatch = url.pathname.match(/^\/api\/contract-files\/([0-9a-f-]{36})$/i);
  if (archivedContractMatch && request.method === "GET") {
    if (!canEdit(session)) return json(request, env, { error: "Los contratos son confidenciales y su descarga está restringida a usuarios autorizados." }, 403);
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
    if (!canEdit(session)) return json(request, env, { error: "Los modelos contractuales están restringidos a usuarios autorizados." }, 403);
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
    const rows = await loadRows(env);
    const versionedRows = await Promise.all(rows.map(async (row) => ({ ...row, revision: await rowRevision(row.values) })));
    return json(request, env, { rows: enrichRowsFromPrivateCatalog(versionedRows) });
  }

  if (url.pathname === "/api/rows" && request.method === "POST") {
    if (!canEdit(session)) return json(request, env, { error: "Este usuario es de consulta y no puede añadir compras." }, 403);
    const body = (await request.json().catch(() => ({}))) as { purchase?: unknown };
    const purchase = purchaseValues(body.purchase);
    validatePurchase(purchase);
    const result = await runAuditedChange(env, session, {
      action: "purchase.create",
      area: "purchases",
      summary: `Nueva compra de ${purchase.provider || "proveedor sin indicar"}`,
      recordId: purchase.id,
    }, async () => {
      const row = await firstAvailableRow(env);
      const id = await savePurchase(env, row, purchase, true);
      return { row, id };
    });
    const { row, id } = result;
    return json(request, env, { ok: true, row, id }, 201);
  }

  const statusMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/status$/);
  if (statusMatch && request.method === "PATCH") {
    if (!canEdit(session)) return json(request, env, { error: "Este usuario es de consulta y no puede cambiar el estado de expedientes." }, 403);
    const body = await request.json().catch(() => ({}));
    const row = Number(statusMatch[1]);
    const result = await runAuditedChange(env, session, {
      action: "record.status",
      area: "purchases",
      summary: `Cambio de estado a ${String((body as Record<string, unknown>).status || "sin indicar")}`,
      recordId: String((body as Record<string, unknown>).expectedId || ""),
      row,
    }, () => updateRecordStatus(env, row, body, session));
    return json(request, env, { ok: true, ...result });
  }

  const backupsMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/backups$/);
  if (backupsMatch && request.method === "GET") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede acceder a copias recuperables." }, 403);
    const row = Number(backupsMatch[1]);
    const expectedId = url.searchParams.get("expectedId") || "";
    return json(request, env, { backups: await listRowBackups(env, row, expectedId) });
  }

  const restoreBackupMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/backups\/restore$/);
  if (restoreBackupMatch && request.method === "POST") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede restaurar copias." }, 403);
    const body = await request.json().catch(() => ({}));
    const row = Number(restoreBackupMatch[1]);
    const result = await runAuditedChange(env, session, {
      action: "record.backup.restore",
      area: "administration",
      summary: "Restauración de una copia recuperable",
      recordId: String((body as Record<string, unknown>).expectedId || ""),
      row,
    }, () => restoreRowBackup(env, row, body, session));
    return json(request, env, { ok: true, ...result });
  }

  const replacementMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/contract$/);
  if (replacementMatch && request.method === "POST") {
    if (!canEdit(session)) return json(request, env, { error: "Este usuario es de consulta y no puede sustituir contratos." }, 403);
    const row = Number(replacementMatch[1]);
    const result = await runAuditedChange(env, session, {
      action: "contract.replace",
      area: "contracts",
      summary: "Sustitución del contrato firmado",
      row,
    }, () => replaceArchivedContract(env, row, request, session));
    return json(request, env, { ok: true, ...result }, 201);
  }

  const deleteMatch = url.pathname.match(/^\/api\/rows\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") {
    if (session.role !== "admin") return json(request, env, { error: "Este usuario es de consulta y no puede eliminar expedientes." }, 403);
    const body = await request.json().catch(() => ({}));
    const row = Number(deleteMatch[1]);
    const result = await runAuditedChange(env, session, {
      action: "record.delete",
      area: "administration",
      summary: "Eliminación definitiva de un expediente",
      recordId: String((body as Record<string, unknown>).expectedId || ""),
      row,
    }, () => deleteRecordPermanently(env, row, body, session));
    return json(request, env, { ok: true, ...result });
  }

  const reviewMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/review$/);
  if (reviewMatch && request.method === "PATCH") {
    if (!canEdit(session)) {
      return json(request, env, { error: "Este usuario es de consulta y no puede modificar los datos." }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as { review?: unknown; expectedId?: unknown; expectedRevision?: unknown };
    const row = Number(reviewMatch[1]);
    const result = await runAuditedChange(env, session, {
      action: "review.update",
      area: "reviews",
      summary: "Actualización de la revisión documental",
      recordId: String(body.expectedId || ""),
      row,
    }, async () => {
      await prepareRowMutation(env, row, body as Record<string, unknown>, session, "Edición de la revisión documental");
      await saveReview(env, row, reviewValues(body.review));
      return { revision: await mutationRevision(env, row) };
    });
    return json(request, env, { ok: true, ...result });
  }

  const purchaseMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/purchase$/);
  if (purchaseMatch && request.method === "PATCH") {
    if (!canEdit(session)) return json(request, env, { error: "Este usuario es de consulta y no puede modificar compras." }, 403);
    const body = (await request.json().catch(() => ({}))) as { purchase?: unknown; expectedId?: unknown; expectedRevision?: unknown };
    const purchase = purchaseValues(body.purchase);
    validatePurchase(purchase, false);
    const row = Number(purchaseMatch[1]);
    const result = await runAuditedChange(env, session, {
      action: "purchase.update",
      area: "purchases",
      summary: `Actualización de la compra de ${purchase.provider || "proveedor sin indicar"}`,
      recordId: String(body.expectedId || purchase.id || ""),
      row,
    }, async () => {
      await prepareRowMutation(env, row, body as Record<string, unknown>, session, "Edición de la compra");
      await savePurchase(env, row, purchase);
      return { revision: await mutationRevision(env, row) };
    });
    return json(request, env, { ok: true, ...result });
  }

  const harvestMatch = url.pathname.match(/^\/api\/rows\/(\d+)\/harvest$/);
  if (harvestMatch && request.method === "PATCH") {
    if (!canEdit(session)) return json(request, env, { error: "Este usuario es de consulta y no puede modificar cortes." }, 403);
    const body = (await request.json().catch(() => ({}))) as { harvest?: unknown; expectedId?: unknown; expectedRevision?: unknown };
    const harvest = harvestValues(body.harvest);
    const row = Number(harvestMatch[1]);
    const result = await runAuditedChange(env, session, {
      action: "harvest.update",
      area: "harvest",
      summary: "Actualización de cortes y kilos recolectados",
      recordId: String(body.expectedId || ""),
      row,
    }, async () => {
      await prepareRowMutation(env, row, body as Record<string, unknown>, session, "Edición de cortes y kilos");
      await saveHarvest(env, row, harvest);
      return { revision: await mutationRevision(env, row) };
    });
    return json(request, env, { ok: true, ...result });
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
      return json(request, env, { error: message }, error instanceof ConflictError ? 409 : error instanceof InputError ? 400 : 500);
    }
  },
};
