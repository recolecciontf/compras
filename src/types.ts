export type AppConfig = {
  apiBaseUrl: string;
};

export type UserProfile = {
  displayName: string;
  userPrincipalName: string;
  role: "admin" | "viewer";
  canEdit: boolean;
};

export type MaterialItem = {
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
};

export type ContractDetails = {
  contractOrigin: "" | "existing" | "generated";
  buyerCompany: "" | "MR. ORGÁNICA, S.L." | "TOÑIFRUIT, S.L.";
  signatureDate: string;
  contractNumber: string;
  sellerRepresentative: string;
  sellerDni: string;
  sellerAddress: string;
  organicOperatorCode: string;
  certifierCode: string;
  ailimpoRegepaCode: string;
  modality: "" | "A KILOS" | "POR TANTO";
  collectionBy: "" | "Vendedor" | "Comprador";
  transportBy: "" | "Vendedor" | "Comprador";
  pricePerKg: string;
  totalPrice: string;
  ivaPercent: string;
  irpfPercent: string;
  advancePayment: string;
  paymentDays: string;
  insuranceProvider: string;
  insurancePolicy: string;
  applyDestrio: "No" | "Sí";
  destrioLocation: "" | "Campo" | "Almacén";
  destrioDefects: string;
  destrioPrice: string;
  sellerEmail: string;
  companyEmail: string;
  buyerRepresentative: string;
  archiveId: string;
  archiveFilename: string;
  archivedAt: string;
  emailStatus: "" | "sent" | "pending_configuration" | "failed";
  sellerSignedAt: string;
  buyerSignedAt: string;
  signatureMethod: "" | "uploaded" | "in_app" | "external_pending";
  archiveHistoryJson: string;
  previousContractMode: "" | "none" | "archived" | "uploaded";
  previousContractPurchaseId: string;
  previousContractArchiveId: string;
  previousContractSourceArchiveId: string;
  previousContractFilename: string;
  previousContractStoredAt: string;
};

export type ContractArchiveHistoryEntry = {
  archiveId: string;
  archiveFilename: string;
  archivedAt: string;
  replacedAt: string;
  replacedBy: string;
  reason: string;
};

export type RecordStatusHistoryEntry = {
  status: "Activo" | "Anulado";
  reason: string;
  changedAt: string;
  changedBy: string;
};

export type ContractSignatures = {
  sellerDataUrl: string;
  sellerName: string;
  signedAt: string;
};

export type ContractOutputFormat = "pdf" | "docx";

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
  materialsJson: string;
  registeredIca: string;
  contractDetailsJson: string;
  recordStatus: string;
  statusReason: string;
  statusUpdatedAt: string;
  statusUpdatedBy: string;
  statusHistoryJson: string;
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
  | "registeredIca"
> & {
  materials: MaterialItem[];
  contractDetails: ContractDetails;
};

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
export type RecordFilter = "all" | "blocked" | "authorized" | "cancelled";
