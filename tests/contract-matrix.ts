import { PRODUCT_CATALOG, certificationSelection } from "../src/lib/catalog";
import { batchesFor, contractKind, generateContractPackage, templateName, validateContractGeneration } from "../src/lib/contractGenerator";
import { companyTaxId } from "../src/lib/fiscal";
import type { ContractDetails, ContractOutputFormat, ContractSignatures, MaterialItem, PurchaseForm } from "../src/types";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

const companyIds = ["B30236137", "B04784419", "B73636086", "F04192563"];
const personalIds = ["52808088L", "22449292G", "00103201T", "X1234567L"];
record("Identificadores de empresa visibles", companyIds.every((value) => companyTaxId(value) === value), companyIds.join(", "));
record("DNI y NIE ocultos", personalIds.every((value) => companyTaxId(value) === ""), personalIds.join(", "));

const normalizedCertificates = certificationSelection("Global G.A.P.; GlobalG.A.P.; GLOBAL GAP; Naturland; NATURLAND");
record(
  "Certificaciones normalizadas sin duplicados",
  normalizedCertificates.join("|") === "GlobalG.A.P.|Naturland",
  normalizedCertificates.join(", "),
);

const companies: ContractDetails["buyerCompany"][] = ["TOÑIFRUIT, S.L.", "MR. ORGÁNICA, S.L."];
const modelSpecies = [
  ["Limón", "Fino", "limon"],
  ["Pomelo", "Star Ruby", "pomelo"],
  ["Naranja", "Navelina", "naranja"],
  ["Mandarina", "Nadorcott", "mandarina"],
  ["Clementina", "Clemenules", "mandarina"],
  ["Uva", "Arra 19", "uva"],
] as const;

function material(crop: string, variety: string, id = `${crop}-${variety}`): MaterialItem {
  return { id, crop, variety, expectedKg: "12500", situation: "Regadío", municipality: "Murcia", paraje: "Finca demo", polygon: "1", plot: "2", hectares: "1.5" };
}

function purchase(company: ContractDetails["buyerCompany"], crop = "Uva", variety = "Arra 19"): PurchaseForm {
  const materials = [material(crop, variety)];
  return {
    id: company.startsWith("TOÑ") ? "TON-QA-001" : "MRO-QA-001",
    provider: "AGRICULTOR DE DEMOSTRACIÓN",
    taxId: "00000000T",
    farm: "Finca demo",
    municipality: "Murcia",
    crop,
    variety,
    expectedKg: "12500",
    materials,
    campaign: "2026/2027",
    registeredIca: "Pendiente",
    contractSigned: "Pendiente de firma",
    contractStart: "2026-08-01",
    contractEnd: "2027-07-31",
    documentPath: "",
    otherAgreements: "Avisar 24 horas antes del corte.",
    contractDetails: {
      contractOrigin: "generated", buyerCompany: company, signatureDate: "2026-08-12", contractNumber: company.startsWith("TOÑ") ? "TON-QA-001" : "MRO-QA-001",
      sellerRepresentative: "Representante de demostración", sellerDni: "00000000T", sellerAddress: "Finca demo, Murcia", organicOperatorCode: "MU-QA/E", certifierCode: "CAAE-QA", ailimpoRegepaCode: "REG-QA",
      modality: "A KILOS", collectionBy: "Comprador", transportBy: "Comprador", pricePerKg: "0.55", totalPrice: "", ivaPercent: "12", irpfPercent: "2", advancePayment: "0", paymentDays: "30",
      insuranceProvider: "Agroseguro", insurancePolicy: "", applyDestrio: "No", destrioLocation: "", destrioDefects: "", destrioPrice: "", sellerEmail: "", companyEmail: "",
      buyerRepresentative: "Responsable de Compras", archiveId: "", archiveFilename: "", archivedAt: "", emailStatus: "", sellerSignedAt: "", buyerSignedAt: "", signatureMethod: "", archiveHistoryJson: "",
      previousContractMode: "none", previousContractPurchaseId: "", previousContractArchiveId: "", previousContractSourceArchiveId: "", previousContractFilename: "", previousContractStoredAt: "",
    },
  };
}

for (const company of companies) {
  for (const [crop, variety, expectedKind] of modelSpecies) {
    const kind = contractKind(crop);
    const name = kind ? templateName(company, kind) : "";
    record(`${company} · ${crop}/${variety}`, kind === expectedKind && Boolean(name), name || "sin modelo");
  }
}

for (const [crop, varieties] of Object.entries(PRODUCT_CATALOG)) {
  record(`Catálogo · ${crop}`, varieties.length > 0 && new Set(varieties).size === varieties.length, `${varieties.length} variedades`);
}

const workflowMatrix = [
  { start: "new", current: "existing", previous: "none", signature: "uploaded", format: "pdf" },
  ...(["none", "archived", "uploaded"] as const).flatMap((previous) =>
    (["now", "later"] as const).flatMap((signature) =>
      (["pdf", "docx"] as const).map((format) => ({ start: "new", current: "generated", previous, signature, format })))),
  ...(["saved", "file"] as const).flatMap((start) => [
    { start, current: "existing", previous: start === "saved" ? "archived" : "uploaded", signature: "uploaded", format: "pdf" },
    ...(["now", "later"] as const).flatMap((signature) =>
      (["pdf", "docx"] as const).map((format) => ({ start, current: "generated", previous: start === "saved" ? "archived" : "uploaded", signature, format }))),
  ]),
];
record("Matriz de flujos", workflowMatrix.length === 23 && new Set(workflowMatrix.map((item) => JSON.stringify(item))).size === 23, `${workflowMatrix.length} alternativas únicas`);

for (const company of companies) {
  const multiVariety = purchase(company);
  multiVariety.materials.push(material("Uva", "Red Globe", "uva-red-globe"));
  multiVariety.variety = "Arra 19 · Red Globe";
  multiVariety.expectedKg = "25000";
  try {
    validateContractGeneration(multiVariety);
    const batches = batchesFor(multiVariety);
    record(`Agrupación de variedades · ${company}`, batches.length === 1 && batches[0].materials.length === 2, `${batches.length} contrato, ${batches[0]?.materials.length || 0} variedades`);
  } catch (error) {
    record(`Agrupación de variedades · ${company}`, false, error instanceof Error ? error.message : String(error));
  }
}

const signature: ContractSignatures = {
  sellerDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  sellerName: "Representante de demostración",
  signedAt: "2026-08-12T10:00:00.000Z",
};

async function uvaTemplate() {
  const response = await fetch("/contract-templates/tonifruit-uva.docx");
  if (!response.ok) throw new Error(`Plantilla de uva no disponible (${response.status})`);
  return response.arrayBuffer();
}

for (const company of companies) {
  for (const format of ["docx", "pdf"] as ContractOutputFormat[]) {
    for (const signed of [false, true]) {
      try {
        const artifact = await generateContractPackage(purchase(company), uvaTemplate, signed ? signature : undefined, format);
        const minimumBytes = format === "pdf" ? 1000 : 10000;
        record(`Generación real · ${company} · ${format.toUpperCase()} · ${signed ? "con firma" : "sin firma"}`, artifact.blob.size > minimumBytes && artifact.filename.endsWith(`.${format}`), `${artifact.filename} · ${artifact.blob.size} bytes`);
      } catch (error) {
        record(`Generación real · ${company} · ${format.toUpperCase()} · ${signed ? "con firma" : "sin firma"}`, false, error instanceof Error ? error.message : String(error));
      }
    }
  }
}

const summary = { total: checks.length, passed: checks.filter((check) => check.ok).length, failed: checks.filter((check) => !check.ok), workflows: workflowMatrix };
document.querySelector("#results")!.textContent = JSON.stringify(summary, null, 2);
document.documentElement.dataset.status = summary.failed.length ? "failed" : "passed";
