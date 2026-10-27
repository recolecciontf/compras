export type AnnexKind = "price" | "partial_cancellation";
export type AnnexFields = {
  kind: AnnexKind;
  place: string;
  date: string;
  originalDate: string;
  aicaReference: string;
  product: string;
  priceMode: "fixed" | "variable";
  price: string;
  unit: string;
  vat: "included" | "excluded";
  priceFormula: string;
  removedVariety: string;
  remainingVarietiesConfirmed: boolean;
};

export type AnnexFile = {
  archiveId: string;
  archiveFilename: string;
  archivedAt: string;
  driveBackupStatus: string;
};

export type ContractAnnex = {
  id: string;
  purchaseId: string;
  company: string;
  contractReference: string;
  fields: AnnexFields;
  createdAt: string;
  createdBy: string;
  draft: AnnexFile;
  signedCopies: (AnnexFile & { attachedBy: string })[];
};

export const ANNEX_LABELS: Record<AnnexKind, string> = {
  price: "Cambio de precio",
  partial_cancellation: "Anulación parcial",
};
export const ANNEX_TEMPLATE_NAMES = ["mro-anexo-precio.docx", "tonifruit-anexo-precio.docx", "mro-anexo-anulacion.docx", "tonifruit-anexo-anulacion.docx"];

function validDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateAnnexFields(value: unknown): AnnexFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Revisa los datos del anexo.");
  const data = value as Record<string, unknown>;
  const fields = {} as AnnexFields;
  for (const key of ["place", "date", "originalDate", "aicaReference", "product", "price", "unit", "priceFormula", "removedVariety"] as const) {
    if (typeof data[key] !== "string" || data[key].length > (key === "priceFormula" ? 1800 : 500)) throw new Error("Revisa los campos del anexo: algún dato no es válido o es demasiado largo.");
    fields[key] = data[key].trim();
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|\{\{|\}\}/.test(fields[key])) throw new Error("El anexo contiene caracteres no admitidos.");
  }
  if (data.kind !== "price" && data.kind !== "partial_cancellation") throw new Error("Selecciona un tipo de anexo.");
  fields.kind = data.kind;
  fields.priceMode = data.priceMode === "variable" ? "variable" : "fixed";
  fields.vat = data.vat === "included" ? "included" : "excluded";
  fields.remainingVarietiesConfirmed = data.remainingVarietiesConfirmed === true;
  if (!fields.place || !fields.aicaReference) throw new Error("Indica el lugar y el número real de inscripción del contrato original en AICA.");
  if (!validDate(fields.date) || !validDate(fields.originalDate)) throw new Error("Indica la fecha del anexo y la fecha del contrato original.");
  if (fields.date < fields.originalDate) throw new Error("El anexo no puede ser anterior al contrato original.");
  if (fields.kind === "price") {
    if (!fields.product) throw new Error("Indica el producto al que se aplica el nuevo precio.");
    if (fields.priceMode === "fixed" && (!/^\d+(?:[.,]\d{1,6})?$/.test(fields.price) || Number(fields.price.replace(",", ".")) <= 0 || !fields.unit)) throw new Error("Indica un precio positivo y su unidad de medida.");
    if (fields.priceMode === "variable" && !fields.priceFormula) throw new Error("El precio variable necesita una fórmula objetiva expresa; no basta indicar «a resultas».");
  } else if (!fields.removedVariety || !fields.product || !fields.remainingVarietiesConfirmed) {
    throw new Error("Describe el objeto original, la variedad que se elimina y confirma que el resto continúa vigente.");
  }
  return fields;
}
