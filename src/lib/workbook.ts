import { canonicalMaterial, materialSummary } from "./catalog";
import type {
  AppConfig,
  ContractArchiveHistoryEntry,
  ContractDetails,
  ControlCatalogData,
  ControlRow,
  HarvestForm,
  MaterialItem,
  PurchaseForm,
  RecordStatusHistoryEntry,
  ReviewForm,
  UserProfile,
} from "../types";

type ApiSheetRow = { index: number; values: unknown[] };
type ApiError = { error?: string };

const TOKEN_KEY = "compras-de-campo-session-v1";

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function excelDateToIso(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value))) {
    const serial = Number(value);
    if (serial > 1000 && serial < 100000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return date.toISOString().slice(0, 10);
    }
  }
  const raw = String(value).trim();
  const spanish = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (spanish) return `${spanish[3]}-${spanish[2].padStart(2, "0")}-${spanish[1].padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function contractStatus(start: string, end: string) {
  if (!start || !end) return "SIN FECHAS";
  const today = new Date().toISOString().slice(0, 10);
  if (today < start) return "PENDIENTE";
  if (today > end) return "FUERA DE PLAZO";
  const days = Math.ceil((new Date(`${end}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
  return days <= 15 ? `VENCE EN ${days} DÍAS` : "VIGENTE";
}

export function rowFromValues(row: ApiSheetRow): ControlRow {
  const v = row.values || [];
  const contractStart = excelDateToIso(v[8]);
  const contractEnd = excelDateToIso(v[9]);
  const legacyMaterial = canonicalMaterial(text(v[5]), text(v[29]));
  return {
    tableIndex: row.index,
    id: text(v[0]),
    provider: text(v[1]),
    taxId: text(v[2]),
    farm: text(v[3]),
    municipality: text(v[4]),
    crop: legacyMaterial.crop,
    campaign: text(v[6]),
    contractSigned: text(v[7]),
    contractStart,
    contractEnd,
    contractAlert: text(v[10]) || contractStatus(contractStart, contractEnd),
    plannedCutDate: excelDateToIso(v[11]),
    farmChecked: text(v[12]),
    fieldNotebook: text(v[13]),
    notebookReviewDate: excelDateToIso(v[14]),
    analysisStatus: text(v[15]),
    analysisDate: excelDateToIso(v[16]),
    certificateType: text(v[17]),
    certificateExpiry: excelDateToIso(v[18]),
    otherDocuments: text(v[19]),
    reviewer: text(v[20]),
    lastReviewDate: excelDateToIso(v[21]),
    canHarvest: text(v[22]),
    blockageReason: text(v[23]),
    documentPath: text(v[24]),
    otherAgreements: text(v[25]),
    cutStatus: text(v[26]),
    cutKgTotal: text(v[27]),
    archived: text(v[28]),
    variety: legacyMaterial.variety,
    expectedKg: text(v[30]),
    materialsJson: text(v[31]),
    registeredIca: text(v[32]),
    contractDetailsJson: text(v[34]),
    recordStatus: text(v[35]) || "Activo",
    statusReason: text(v[36]),
    statusUpdatedAt: text(v[37]),
    statusUpdatedBy: text(v[38]),
    statusHistoryJson: text(v[39]),
  };
}

const CONTRACT_DEFAULTS: ContractDetails = {
  contractOrigin: "",
  buyerCompany: "",
  signatureDate: new Date().toISOString().slice(0, 10),
  contractNumber: "",
  sellerRepresentative: "",
  sellerDni: "",
  sellerAddress: "",
  organicOperatorCode: "",
  certifierCode: "",
  ailimpoRegepaCode: "",
  modality: "A KILOS",
  collectionBy: "Comprador",
  transportBy: "Comprador",
  pricePerKg: "",
  totalPrice: "",
  ivaPercent: "",
  irpfPercent: "",
  advancePayment: "",
  paymentDays: "30",
  insuranceProvider: "Agroseguro",
  insurancePolicy: "",
  applyDestrio: "No",
  destrioLocation: "",
  destrioDefects: "",
  destrioPrice: "",
  sellerEmail: "",
  companyEmail: "",
  buyerRepresentative: "",
  archiveId: "",
  archiveFilename: "",
  archivedAt: "",
  emailStatus: "",
  sellerSignedAt: "",
  buyerSignedAt: "",
  signatureMethod: "",
  archiveHistoryJson: "",
  previousContractMode: "",
  previousContractPurchaseId: "",
  previousContractArchiveId: "",
  previousContractSourceArchiveId: "",
  previousContractFilename: "",
  previousContractStoredAt: "",
};

function materialsFromRow(row: ControlRow): MaterialItem[] {
  if (row.materialsJson) {
    try {
      const parsed = JSON.parse(row.materialsJson) as Partial<MaterialItem>[];
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((item, index) => {
          const canonical = canonicalMaterial(text(item.crop), text(item.variety));
          return {
            id: text(item.id) || `material-${row.tableIndex}-${index}`,
            crop: canonical.crop,
            variety: canonical.variety,
            expectedKg: text(item.expectedKg),
            situation: text(item.situation),
            municipality: text(item.municipality) || row.municipality,
            paraje: text(item.paraje),
            polygon: text(item.polygon),
            plot: text(item.plot),
            hectares: text(item.hectares),
          };
        });
      }
    } catch {
      // Conserva la compatibilidad con las filas creadas antes del formato multiespecie.
    }
  }
  const canonical = canonicalMaterial(row.crop, row.variety);
  return [{
    id: `material-${row.tableIndex}-0`,
    crop: canonical.crop,
    variety: canonical.variety,
    expectedKg: row.expectedKg,
    situation: "",
    municipality: row.municipality,
    paraje: row.farm,
    polygon: "",
    plot: "",
    hectares: "",
  }];
}

function contractDetailsFromRow(row: ControlRow): ContractDetails {
  if (!row.contractDetailsJson) {
    return { ...CONTRACT_DEFAULTS, contractOrigin: normalized(row.contractSigned) === "sí" ? "existing" : "" };
  }
  try {
    const parsed = JSON.parse(row.contractDetailsJson) as Partial<ContractDetails>;
    return {
      ...CONTRACT_DEFAULTS,
      ...parsed,
      contractOrigin: parsed.contractOrigin || (normalized(row.contractSigned) === "sí" ? "existing" : ""),
    };
  } catch {
    return { ...CONTRACT_DEFAULTS };
  }
}

function safeJsonArray<T>(value: string) {
  if (!value) return [] as T[];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [] as T[];
  }
}

export function contractArchiveHistory(purchase: PurchaseForm) {
  return safeJsonArray<ContractArchiveHistoryEntry>(purchase.contractDetails.archiveHistoryJson)
    .filter((entry) => entry && typeof entry.archiveId === "string" && Boolean(entry.archiveId));
}

export function recordStatusHistory(row: ControlRow) {
  return safeJsonArray<RecordStatusHistoryEntry>(row.statusHistoryJson)
    .filter((entry) => entry && (entry.status === "Activo" || entry.status === "Anulado"));
}

export function isRecordCancelled(row: ControlRow) {
  return normalized(row.recordStatus) === "anulado";
}

export function purchaseFromRow(row: ControlRow): PurchaseForm {
  const materials = materialsFromRow(row);
  const summary = materialSummary(materials);
  return {
    id: row.id,
    provider: row.provider,
    taxId: row.taxId,
    farm: row.farm,
    municipality: row.municipality,
    ...summary,
    materials,
    campaign: row.campaign,
    registeredIca: row.registeredIca,
    contractSigned: row.contractSigned,
    contractStart: row.contractStart,
    contractEnd: row.contractEnd,
    documentPath: row.documentPath,
    otherAgreements: row.otherAgreements,
    contractDetails: contractDetailsFromRow(row),
  };
}

export function harvestFromRow(row: ControlRow): HarvestForm {
  return {
    cutStatus: normalized(row.cutStatus) === "sí" ? "Sí" : "No",
    cutKgTotal: row.cutKgTotal,
    archived: normalized(row.archived) === "sí" ? "Sí" : "No",
  };
}

export function reviewFromRow(row: ControlRow): ReviewForm {
  return {
    plannedCutDate: row.plannedCutDate,
    farmChecked: row.farmChecked,
    fieldNotebook: row.fieldNotebook,
    notebookReviewDate: row.notebookReviewDate,
    analysisStatus: row.analysisStatus,
    analysisDate: row.analysisDate,
    certificateType: row.certificateType,
    certificateExpiry: row.certificateExpiry,
    otherDocuments: row.otherDocuments,
    reviewer: row.reviewer,
    lastReviewDate: row.lastReviewDate,
  };
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

export function reviewBlockages(row: ControlRow, form: ReviewForm) {
  const issues: string[] = [];
  const contract = contractDetailsFromRow(row);
  const materials = materialsFromRow(row);
  if (isRecordCancelled(row)) issues.push("Expediente anulado");
  if (!row.provider.trim()) issues.push("Falta el agricultor o proveedor");
  if (!row.taxId.trim()) issues.push("Falta el NIF o CIF");
  if (!row.farm.trim()) issues.push("Falta la finca o parcela");
  if (!row.municipality.trim()) issues.push("Falta el municipio");
  if (!row.crop.trim()) issues.push("Falta la especie");
  if (!row.variety.trim()) issues.push("Falta la variedad");
  if (!row.expectedKg.trim()) issues.push("Faltan los kg previstos");
  materials.forEach((material, index) => {
    const suffix = materials.length > 1 ? ` en la materia prima ${index + 1}` : "";
    if (!material.crop.trim()) issues.push(`Falta la especie${suffix}`);
    if (!material.variety.trim()) issues.push(`Falta la variedad${suffix}`);
    if (!material.expectedKg.trim()) issues.push(`Faltan los kg previstos${suffix}`);
  });
  if (!row.campaign.trim()) issues.push("Falta la campaña");
  if (!["sí", "si"].includes(normalized(row.registeredIca))) issues.push("Registro en AICA pendiente de validación");
  if (normalized(row.contractSigned) !== "sí") issues.push("Contrato no firmado");
  if (!contract.buyerCompany) issues.push("Falta la empresa compradora");
  if (!contract.signatureDate) issues.push("Falta la fecha de firma del contrato");
  if (!contract.sellerEmail) issues.push("Falta el correo del agricultor");
  if (!contract.companyEmail) issues.push("Falta el correo de la empresa");
  if (contract.contractOrigin !== "existing") {
    if (!contract.modality) issues.push("Falta la modalidad de compraventa");
    if (!contract.collectionBy) issues.push("Falta indicar quién asume la recolección");
    if (!contract.transportBy) issues.push("Falta indicar quién asume el transporte");
    if (contract.modality === "POR TANTO" ? !contract.totalPrice : !contract.pricePerKg) issues.push(contract.modality === "POR TANTO" ? "Falta el precio total" : "Falta el precio por kg");
    if (contract.pricePerKg && contract.totalPrice) issues.push("Hay dos tipos de precio; debe indicarse solo uno");
    if (!contract.paymentDays) issues.push("Falta el plazo de pago");
  }
  if (contract.applyDestrio === "Sí") {
    if (!contract.destrioLocation) issues.push("Falta el lugar del destrío");
    if (!contract.destrioDefects) issues.push("Faltan los defectos a destriar");
    if (!contract.destrioPrice) issues.push("Falta el precio del destrío");
  }
  if (!contract.archiveId) issues.push("Falta archivar la copia firmada del contrato");
  if (!row.contractStart) issues.push("Falta el inicio del contrato");
  if (!row.contractEnd) issues.push("Falta el fin del contrato");
  if (!form.plannedCutDate) issues.push("Falta la fecha prevista de corte");
  if (form.plannedCutDate && row.contractStart && form.plannedCutDate < row.contractStart) {
    issues.push("El corte es anterior al inicio del contrato");
  }
  if (form.plannedCutDate && row.contractEnd && form.plannedCutDate > row.contractEnd) {
    issues.push("El corte queda fuera de contrato");
  }
  if (normalized(form.farmChecked) !== "sí") issues.push("Finca o parcela sin comprobar");
  if (normalized(form.fieldNotebook) !== "sí") issues.push("Cuaderno de campo no validado");
  if (!form.notebookReviewDate) issues.push("Falta la fecha de revisión del cuaderno");
  if (normalized(form.analysisStatus) !== "apto") issues.push("Análisis no apto o pendiente");
  if (!form.analysisDate) issues.push("Falta la fecha del análisis");
  const certificate = normalized(form.certificateType);
  if (!certificate || certificate === "no localizado" || certificate === "pendiente de revisión") {
    issues.push("Certificado no identificado");
  }
  if (!form.certificateExpiry) issues.push("Falta la caducidad del certificado");
  if (form.plannedCutDate && form.certificateExpiry && form.certificateExpiry < form.plannedCutDate) {
    issues.push("El certificado caduca antes del corte");
  }
  if (!["sí", "no aplica"].includes(normalized(form.otherDocuments))) {
    issues.push("Otros documentos exigidos sin validar");
  }
  if (!form.reviewer.trim()) issues.push("Falta el responsable de revisión");
  return [...new Set(issues)];
}

export class ArchiveUnavailableError extends Error {
  constructor() {
    super("El archivo central de contratos no está disponible. El PDF no se ha marcado como archivado ni firmado; vuelve a intentarlo cuando se restablezca el servicio.");
    this.name = "ArchiveUnavailableError";
  }
}

export class WorkbookClient {
  private token = localStorage.getItem(TOKEN_KEY) || "";
  private cachedProfile: UserProfile | null = null;
  private readonly baseUrl: string;

  constructor(config: AppConfig) {
    this.baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  }

  private endpoint(path: string) {
    return `${this.baseUrl}${path}`;
  }

  private async request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const response = await fetch(this.endpoint(path), {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated && this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ApiError;
      if (response.status === 401 && authenticated) {
        this.token = "";
        localStorage.removeItem(TOKEN_KEY);
      }
      if (response.status === 405) {
        throw new Error("La aplicación conserva una configuración antigua. Ciérrala por completo, vuelve a abrirla y reintenta el acceso.");
      }
      throw new Error(detail.error || `El servicio ha respondido con el error ${response.status}.`);
    }
    return response.json() as Promise<T>;
  }

  async initialize() {
    if (!this.token) return false;
    try {
      this.cachedProfile = await this.request<UserProfile>("/api/profile");
      return true;
    } catch {
      return false;
    }
  }

  async signIn(username: string, password: string) {
    const result = await this.request<{ token: string; profile: UserProfile }>(
      "/api/login",
      { method: "POST", body: JSON.stringify({ username: username.trim(), password }) },
      false,
    );
    this.token = result.token;
    this.cachedProfile = result.profile;
    localStorage.setItem(TOKEN_KEY, result.token);
  }

  signOut() {
    this.token = "";
    this.cachedProfile = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  async profile(): Promise<UserProfile> {
    if (this.cachedProfile) return this.cachedProfile;
    this.cachedProfile = await this.request<UserProfile>("/api/profile");
    return this.cachedProfile;
  }

  async rows() {
    const result = await this.request<{ rows: ApiSheetRow[] }>("/api/rows");
    return result.rows.map(rowFromValues).filter((row) => row.provider);
  }

  async controlCatalog() {
    return this.request<ControlCatalogData>("/api/control-catalog");
  }

  async saveReview(row: ControlRow, review: ReviewForm) {
    await this.request<{ ok: true }>(`/api/rows/${row.tableIndex}/review`, {
      method: "PATCH",
      body: JSON.stringify({ review }),
    });
  }

  async createPurchase(purchase: PurchaseForm) {
    const awaitsGeneratedSignature = purchase.contractDetails.contractOrigin === "generated"
      && !["sí", "si"].includes(purchase.contractSigned.toLocaleLowerCase("es"));
    const awaitsExternalSignature = awaitsGeneratedSignature
      && purchase.contractDetails.signatureMethod === "external_pending";
    // Compatibilidad transitoria con la versión anterior del servicio central, que exigía
    // dos firmas al crear la fila. La corrección real se guarda inmediatamente después y
    // el expediente sigue bloqueado por falta de PDF definitivo, archivo y AICA.
    const creationPayload = awaitsGeneratedSignature ? {
      ...purchase,
      contractSigned: "Sí",
      contractDetails: {
        ...purchase.contractDetails,
        ...(awaitsExternalSignature
          ? { contractOrigin: "existing" as const, signatureMethod: "uploaded" as const }
          : {
            buyerRepresentative: "Pendiente de firma digital en oficina",
            buyerSignedAt: new Date().toISOString(),
          }),
      },
    } : purchase;
    const created = await this.request<{ ok: true; row: number; id: string }>("/api/rows", {
      method: "POST",
      body: JSON.stringify({ purchase: creationPayload }),
    });
    if (awaitsGeneratedSignature) {
      await this.request<{ ok: true }>(`/api/rows/${created.row}/purchase`, {
        method: "PATCH",
        body: JSON.stringify({ purchase }),
      });
    }
    return created;
  }

  async savePurchase(row: ControlRow, purchase: PurchaseForm) {
    await this.request<{ ok: true }>(`/api/rows/${row.tableIndex}/purchase`, {
      method: "PATCH",
      body: JSON.stringify({ purchase }),
    });
  }

  async saveHarvest(row: ControlRow, harvest: HarvestForm) {
    await this.request<{ ok: true }>(`/api/rows/${row.tableIndex}/harvest`, {
      method: "PATCH",
      body: JSON.stringify({ harvest }),
    });
  }

  async updateRecordStatus(row: ControlRow, status: "Activo" | "Anulado", reason: string) {
    return this.request<{
      ok: true;
      recordStatus: string;
      statusReason: string;
      statusUpdatedAt: string;
      statusUpdatedBy: string;
      statusHistoryJson: string;
    }>(`/api/rows/${row.tableIndex}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason, expectedId: row.id }),
    });
  }

  async replaceContract(row: ControlRow, file: File, reason: string, purchase: PurchaseForm) {
    const form = new FormData();
    form.set("file", file, file.name);
    form.set("reason", reason);
    form.set("expectedId", row.id);
    form.set("provider", purchase.provider);
    form.set("sellerEmail", purchase.contractDetails.sellerEmail);
    form.set("companyEmail", purchase.contractDetails.companyEmail);
    form.set("contractNumber", purchase.contractDetails.contractNumber || purchase.id);
    const response = await fetch(this.endpoint(`/api/rows/${row.tableIndex}/contract`), {
      method: "POST",
      cache: "no-store",
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: form,
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ApiError;
      throw new Error(detail.error || "No se ha podido sustituir el contrato firmado.");
    }
    return response.json() as Promise<{ ok: true; archiveFilename: string }>;
  }

  async deleteRecord(row: ControlRow, reason: string, confirmation: string, acknowledgement: string) {
    return this.request<{ ok: true; deletedId: string; deletedArchives: number; archiveCleanupPending: boolean }>(
      `/api/rows/${row.tableIndex}`,
      {
        method: "DELETE",
        body: JSON.stringify({ expectedId: row.id, confirmation, acknowledgement, reason }),
      },
    );
  }

  async contractTemplate(name: string) {
    if (name === "tonifruit-uva.docx") {
      const publicTemplate = await fetch(`${import.meta.env.BASE_URL}contract-templates/${encodeURIComponent(name)}`, {
        cache: "no-store",
      });
      if (publicTemplate.ok) return publicTemplate.arrayBuffer();
    }
    const response = await fetch(this.endpoint(`/api/contract-templates/${encodeURIComponent(name)}`), {
      cache: "no-store",
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ApiError;
      throw new Error(detail.error || "No se ha podido abrir el modelo contractual.");
    }
    return response.arrayBuffer();
  }

  async archiveContract(file: Blob, filename: string, purchase: PurchaseForm) {
    const form = new FormData();
    form.set("file", file, filename);
    form.set("provider", purchase.provider);
    form.set("sellerEmail", purchase.contractDetails.sellerEmail);
    form.set("companyEmail", purchase.contractDetails.companyEmail);
    form.set("contractNumber", purchase.contractDetails.contractNumber || purchase.id);
    const response = await fetch(this.endpoint("/api/contract-files"), {
      method: "POST",
      cache: "no-store",
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: form,
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ApiError;
      if (response.status === 404 || response.status === 503 || detail.error?.includes("archivo central")) {
        throw new ArchiveUnavailableError();
      }
      throw new Error(detail.error || "No se ha podido archivar el contrato firmado.");
    }
    const archived = await response.json() as {
      archiveId: string;
      archiveFilename: string;
      archivedAt: string;
      emailStatus: "sent" | "pending_configuration" | "failed";
    };
    if (!archived.archiveId || !archived.archiveFilename || !archived.archivedAt) {
      throw new Error("El servidor no ha confirmado el archivo del contrato. El expediente no se ha modificado.");
    }
    return archived;
  }

  async archivePreviousContract(file: File, purchase: PurchaseForm) {
    const form = new FormData();
    form.set("file", file, file.name);
    form.set("provider", purchase.provider);
    form.set("sourcePurchaseId", purchase.contractDetails.previousContractPurchaseId || "");
    const response = await fetch(this.endpoint("/api/previous-contract-files"), {
      method: "POST",
      cache: "no-store",
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: form,
    });
    if (response.status === 404) {
      // Compatibilidad con el servicio anterior: conserva el PDF en el mismo R2,
      // pero usa direcciones reservadas para que nunca se envíe como contrato actual.
      const referenceOnlyPurchase: PurchaseForm = {
        ...purchase,
        contractDetails: {
          ...purchase.contractDetails,
          sellerEmail: "archivo@referencia.invalid",
          companyEmail: "archivo@referencia.invalid",
          contractNumber: `REF-${purchase.id || "ANTERIOR"}`,
        },
      };
      const archived = await this.archiveContract(file, file.name, referenceOnlyPurchase);
      return {
        previousContractArchiveId: archived.archiveId,
        previousContractFilename: archived.archiveFilename,
        previousContractStoredAt: archived.archivedAt,
      };
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ApiError;
      throw new Error(detail.error || "No se ha podido guardar el contrato anterior.");
    }
    return response.json() as Promise<{
      previousContractArchiveId: string;
      previousContractFilename: string;
      previousContractStoredAt: string;
    }>;
  }

  async copyPreviousContract(archiveId: string, purchaseId: string, provider: string) {
    const response = await fetch(this.endpoint("/api/previous-contract-files/copy"), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ archiveId, purchaseId, provider }),
    });
    if (response.status === 404) {
      // El archivo original ya está protegido y disponible en R2. Hasta que el
      // servicio admita copias independientes, se guarda una referencia segura.
      return {
        previousContractArchiveId: archiveId,
        previousContractFilename: "contrato-anterior.pdf",
        previousContractStoredAt: new Date().toISOString(),
      };
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ApiError;
      throw new Error(detail.error || "No se ha podido reutilizar el contrato anterior.");
    }
    return response.json() as Promise<{
      previousContractArchiveId: string;
      previousContractFilename: string;
      previousContractStoredAt: string;
    }>;
  }

  async archivedContract(archiveId: string) {
    const response = await fetch(this.endpoint(`/api/contract-files/${encodeURIComponent(archiveId)}`), {
      cache: "no-store",
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ApiError;
      throw new Error(detail.error || "No se ha podido descargar el contrato firmado.");
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename="([^"]+)"/i)?.[1];
    return { blob: await response.blob(), filename: encoded ? decodeURIComponent(encoded) : plain || "contrato-firmado" };
  }

  async uploadLibraryDocument(file: File, id: string) {
    const form = new FormData();
    form.set("file", file, file.name);
    form.set("id", id);
    const response = await fetch(this.endpoint("/api/document-library"), {
      method: "POST",
      cache: "no-store",
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: form,
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ApiError;
      throw new Error(detail.error || `No se ha podido subir ${file.name}.`);
    }
    return response.json() as Promise<{ ok: true; id: string }>;
  }

  async libraryDocument(id: string) {
    const response = await fetch(this.endpoint(`/api/document-library/${encodeURIComponent(id)}`), {
      cache: "no-store",
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ApiError;
      throw new Error(detail.error || "No se ha podido descargar el documento contractual.");
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename="([^"]+)"/i)?.[1];
    return { blob: await response.blob(), filename: encoded ? decodeURIComponent(encoded) : plain || "documento-contractual" };
  }
}
