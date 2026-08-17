// Catálogos operativos de la instalación limpia.
// Los datos históricos se conservan únicamente en las copias externas de restauración.

export type CertificateRecord = {
  id: string;
  company: string;
  farmer: string;
  taxId: string;
  opfhMember: boolean;
  farmType: string;
  certification: string;
  expiry: string;
  crops: string[];
  preserved: boolean;
};

export type FarmRecord = {
  holder: string;
  farmName: string;
  municipality: string;
  [key: string]: unknown;
};

export type OpfhMember = Record<string, unknown>;

export type ContractDocument = {
  id: string;
  company: string;
  farmer: string;
  filename: string;
  campaign: string;
  documentType: string;
  species: string[];
  varieties: string[];
  extension: string;
  size: number;
  modified: string;
};

export type SupportSummary = {
  company: string;
  farmer: string;
  analysisCount: number;
  analysisLatest: string;
  notebookCount: number;
  notebookLatest: string;
  certificateFileCount: number;
  certificateFileLatest: string;
  otherCount: number;
  otherLatest: string;
};

export const CONTROL_DATA_UPDATED_AT = "2026-08-18";
export const CERTIFICATE_RECORDS: CertificateRecord[] = [];
export const FARM_RECORDS: FarmRecord[] = [];
export const OPFH_MEMBERS: OpfhMember[] = [];
export const CONTRACT_DOCUMENTS: ContractDocument[] = [];
export const SUPPORT_SUMMARIES: SupportSummary[] = [];
