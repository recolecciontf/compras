import type { PurchaseForm } from "../types";
import type { AnnexFile } from "./contractAnnexData";

export type ExternalContractData = {
  buyerCompany: "" | "MR. ORGÁNICA, S.L." | "TOÑIFRUIT, S.L.";
  contractNumber: string;
  originalDate: string;
  campaign: string;
  provider: string;
  taxId: string;
  sellerAddress: string;
  sellerTreatment: "" | "D." | "Dña.";
  sellerRepresentative: string;
  sellerDni: string;
  sellerRepresentativeAddress: string;
  product: string;
};

export type ExternalContract = {
  id: string;
  revision: string;
  data: ExternalContractData;
  source: AnnexFile | null;
  createdAt: string;
  createdBy: string;
};

export const EMPTY_EXTERNAL_CONTRACT: ExternalContractData = {
  buyerCompany: "", contractNumber: "", originalDate: "", campaign: "", provider: "", taxId: "",
  sellerAddress: "", sellerTreatment: "", sellerRepresentative: "", sellerDni: "", sellerRepresentativeAddress: "", product: "",
};

export function externalDataFromPurchase(purchase: PurchaseForm): ExternalContractData {
  const details = purchase.contractDetails;
  return {
    buyerCompany: details.buyerCompany, contractNumber: details.contractNumber, originalDate: details.signatureDate,
    campaign: purchase.campaign, provider: purchase.provider, taxId: purchase.taxId, sellerAddress: details.sellerAddress,
    sellerTreatment: details.sellerTreatment, sellerRepresentative: details.sellerRepresentative, sellerDni: details.sellerDni,
    sellerRepresentativeAddress: details.sellerRepresentativeAddress || "",
    product: purchase.materials.map(item => [item.expectedKg ? `${item.expectedKg} kg` : "", item.crop, item.variety].filter(Boolean).join(" ")).join("; "),
  };
}

export function externalContractPurchase(record: ExternalContract, base: PurchaseForm): PurchaseForm {
  const data = record.data;
  return {
    ...structuredClone(base), id: record.id, provider: data.provider, taxId: data.taxId, campaign: data.campaign,
    materials: [], crop: "", variety: "", expectedKg: "",
    contractDetails: {
      ...structuredClone(base.contractDetails), buyerCompany: data.buyerCompany, contractNumber: data.contractNumber,
      signatureDate: data.originalDate, sellerAddress: data.sellerAddress, sellerTreatment: data.sellerTreatment,
      sellerRepresentative: data.sellerRepresentative, sellerDni: data.sellerDni,
      sellerRepresentativeAddress: data.sellerRepresentativeAddress,
    },
  };
}

export function validateExternalContractData(value: unknown): ExternalContractData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Revisa los datos del contrato original.");
  const input = value as Record<string, unknown>;
  const data = {} as ExternalContractData;
  for (const key of Object.keys(EMPTY_EXTERNAL_CONTRACT) as (keyof ExternalContractData)[]) {
    const text = input[key];
    const maximum = key === "product" || key.endsWith("Address") ? 500 : key === "contractNumber" ? 80 : 180;
    if (typeof text !== "string" || text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]|\{\{|\}\}/.test(text)) throw new Error("Hay datos del contrato que no son válidos o son demasiado largos.");
    (data as Record<string, string>)[key] = text.trim();
  }
  if (!["MR. ORGÁNICA, S.L.", "TOÑIFRUIT, S.L."].includes(data.buyerCompany)) throw new Error("Selecciona la empresa compradora del contrato original.");
  if (!["", "D.", "Dña."].includes(data.sellerTreatment)) throw new Error("Revisa el tratamiento del representante.");
  if (!data.contractNumber || !data.campaign || !data.provider || !data.taxId || !data.sellerAddress || !data.product) throw new Error("Completa la referencia, campaña, vendedor, NIF/CIF, domicilio y producto del contrato original.");
  const date = new Date(`${data.originalDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.originalDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== data.originalDate) throw new Error("Indica la fecha real del contrato original.");
  if (data.sellerRepresentative && !data.sellerDni) throw new Error("Completa el DNI del representante del vendedor.");
  return data;
}
