export type AppConfig = {
  apiBaseUrl: string;
};

export type UserProfile = {
  displayName: string;
  userPrincipalName: string;
  role: "admin" | "viewer";
  canEdit: boolean;
};

export type ControlRow = {
  tableIndex: number;
  id: string;
  provider: string;
  taxId: string;
  farm: string;
  municipality: string;
  crop: string;
  campaign: string;
  contractSigned: string;
  contractStart: string;
  contractEnd: string;
  contractAlert: string;
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
  canHarvest: string;
  blockageReason: string;
  documentPath: string;
  otherAgreements: string;
  cutStatus: string;
  cutKgTotal: string;
  archived: string;
  variety: string;
  expectedKg: string;
};

export type PurchaseForm = Pick<
  ControlRow,
  | "id"
  | "provider"
  | "taxId"
  | "farm"
  | "municipality"
  | "crop"
  | "variety"
  | "expectedKg"
  | "campaign"
  | "contractSigned"
  | "contractStart"
  | "contractEnd"
  | "documentPath"
  | "otherAgreements"
>;

export type HarvestForm = Pick<ControlRow, "cutStatus" | "cutKgTotal" | "archived">;

export type ReviewForm = Pick<
  ControlRow,
  | "plannedCutDate"
  | "farmChecked"
  | "fieldNotebook"
  | "notebookReviewDate"
  | "analysisStatus"
  | "analysisDate"
  | "certificateType"
  | "certificateExpiry"
  | "otherDocuments"
  | "reviewer"
  | "lastReviewDate"
>;

export type AppView = "records" | "review" | "new" | "harvest";
export type RecordFilter = "all" | "blocked" | "authorized";
