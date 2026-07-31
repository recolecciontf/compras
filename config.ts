export type AppConfig = {
  tenantId: string;
  clientId: string;
  workbookShareUrl: string;
  workbookDriveId: string;
  workbookItemId: string;
  tableName: string;
  worksheetName: string;
};

export type UserProfile = {
  displayName: string;
  userPrincipalName: string;
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
};

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

export type AppView = "records" | "review" | "settings";
export type RecordFilter = "all" | "blocked" | "authorized";
