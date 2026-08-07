import { canonicalMaterial, materialSummary } from "./catalog";
import type { AppConfig, ContractDetails, ControlRow, HarvestForm, MaterialItem, PurchaseForm, ReviewForm, UserProfile } from "../types";

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
    if (!contract.sellerRepresentative) issues.push("Falta el representante del vendedor");
    if (!contract.sellerDni) issues.push("Falta el DNI del representante del vendedor");
    if (!contract.sellerAddress) issues.push("Falta el domicilio del vendedor");
    if (!contract.organicOperatorCode) issues.push("Falta el código de operador ecológico");
    if (!contract.pricePerKg && !contract.totalPrice) issues.push("Falta el precio por kg o el precio total");
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
    super("El archivo central de contratos no está disponible en este momento.");
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

  async saveReview(row: ControlRow, review: ReviewForm) {
    await this.request<{ ok: true }>(`/api/rows/${row.tableIndex}/review`, {
      method: "PATCH",
      body: JSON.stringify({ review }),
    });
  }

  async createPurchase(purchase: PurchaseForm) {
    const awaitsBuyerSignature = purchase.contractDetails.contractOrigin === "generated"
      && !["sí", "si"].includes(purchase.contractSigned.toLocaleLowerCase("es"));
    // Compatibilidad transitoria con la versión anterior del servicio central, que exigía
    // dos firmas al crear la fila. La corrección real se guarda inmediatamente después y
    // el expediente sigue bloqueado por falta de PDF definitivo, archivo y AICA.
    const creationPayload = awaitsBuyerSignature ? {
      ...purchase,
      contractSigned: "Sí",
      contractDetails: {
        ...purchase.contractDetails,
        buyerRepresentative: "Pendiente de firma digital en oficina",
        buyerSignedAt: new Date().toISOString(),
      },
    } : purchase;
    const created = await this.request<{ ok: true; row: number; id: string }>("/api/rows", {
      method: "POST",
      body: JSON.stringify({ purchase: creationPayload }),
    });
    if (awaitsBuyerSignature) {
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

  async contractTemplate(name: string) {
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
      if (response.status === 404) throw new ArchiveUnavailableError();
      throw new Error(detail.error || "No se ha podido archivar el contrato firmado.");
    }
    return response.json() as Promise<{
      archiveId: string;
      archiveFilename: string;
      archivedAt: string;
      emailStatus: "sent" | "pending_configuration" | "failed";
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
}
