import type { AppConfig, ControlRow, ReviewForm, UserProfile } from "../types";

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

export function rowFromValues(row: ApiSheetRow): ControlRow {
  const v = row.values || [];
  return {
    tableIndex: row.index,
    id: text(v[0]),
    provider: text(v[1]),
    taxId: text(v[2]),
    farm: text(v[3]),
    municipality: text(v[4]),
    crop: text(v[5]),
    campaign: text(v[6]),
    contractSigned: text(v[7]),
    contractStart: excelDateToIso(v[8]),
    contractEnd: excelDateToIso(v[9]),
    contractAlert: text(v[10]),
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
  if (normalized(row.contractSigned) !== "sí") issues.push("Contrato no firmado");
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
  if (!form.lastReviewDate) issues.push("Falta la fecha de revisión");
  return issues;
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
}
