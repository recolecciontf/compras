import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const elementPrototype = Object.getPrototypeOf(new DOMParser().parseFromString("<root><child/></root>", "application/xml").documentElement);
if (!("children" in elementPrototype)) Object.defineProperty(elementPrototype, "children", {
  get() { return Array.from(this.childNodes).filter((node) => node.nodeType === 1); },
});
if (!("previousElementSibling" in elementPrototype)) Object.defineProperty(elementPrototype, "previousElementSibling", {
  get() {
    let node = this.previousSibling;
    while (node && node.nodeType !== 1) node = node.previousSibling;
    return node || null;
  },
});
if (!("append" in elementPrototype)) elementPrototype.append = function append(...nodes) { nodes.forEach((node) => this.appendChild(node)); };
if (!("prepend" in elementPrototype)) elementPrototype.prepend = function prepend(...nodes) { nodes.slice().reverse().forEach((node) => this.insertBefore(node, this.firstChild)); };
if (!("remove" in elementPrototype)) elementPrototype.remove = function remove() { this.parentNode?.removeChild(this); };

const templateDirectory = resolve(process.argv[2]);
const outputDirectory = resolve(process.argv[3] || "tmp/generated-contract-docx");
const generatorPath = resolve(process.argv[4] || "tmp-qa-compiled/lib/contractGenerator.js");
await mkdir(outputDirectory, { recursive: true });

const cases = [
  ["MR. ORGÁNICA, S.L.", "Limón", "Fino", "mro-limon"],
  ["MR. ORGÁNICA, S.L.", "Pomelo", "Star Ruby", "mro-pomelo"],
  ["MR. ORGÁNICA, S.L.", "Naranja", "Navelina", "mro-naranja"],
  ["MR. ORGÁNICA, S.L.", "Mandarina", "Nadorcott", "mro-mandarina"],
  ["MR. ORGÁNICA, S.L.", "Nectarina", "Flariba", "mro-fruta-hueso"],
  ["TOÑIFRUIT, S.L.", "Limón", "Fino", "tonifruit-limon"],
  ["TOÑIFRUIT, S.L.", "Pomelo", "Star Ruby", "tonifruit-pomelo"],
  ["TOÑIFRUIT, S.L.", "Naranja", "Navelina", "tonifruit-naranja"],
  ["TOÑIFRUIT, S.L.", "Mandarina", "Nadorcott", "tonifruit-mandarina"],
  ["TOÑIFRUIT, S.L.", "Uva", "Arra 19", "tonifruit-uva"],
  ["TOÑIFRUIT, S.L.", "Albaricoque", "Cebas Red", "tonifruit-fruta-hueso"],
];

function purchase(company, crop, variety) {
  const materials = [
    { id: "qa-1", crop, variety, expectedKg: "12500", situation: "Regadío", municipality: "Librilla", paraje: "Paraje de prueba", polygon: "12", plot: "34", hectares: "1.25" },
    { id: "qa-2", crop, variety, expectedKg: "7500", situation: "Regadío", municipality: "Librilla", paraje: "Segundo paraje", polygon: "12", plot: "35", hectares: "0.75" },
  ];
  return {
    id: company.startsWith("MR.") ? "MRO-QA-001" : "TON-QA-001",
    provider: "CÍTRICOS BIOLÓGICOS, C.B.",
    taxId: "E54967560",
    farm: "Fincas de prueba",
    municipality: "Librilla",
    crop,
    variety,
    expectedKg: "20000",
    materials,
    campaign: "2026/2027",
    registeredIca: "Pendiente",
    contractSigned: "Pendiente de firma",
    contractStart: "2026-09-01",
    contractEnd: "2027-08-31",
    documentPath: "",
    otherAgreements: "Avisar con 24 horas de antelación al inicio de la recolección.",
    contractDetails: {
      contractOrigin: "generated",
      buyerCompany: company,
      signatureDate: "2026-08-26",
      contractNumber: company.startsWith("MR.") ? "MRO-QA-001" : "TON-QA-001",
      sellerTreatment: "Dña.",
      sellerRepresentative: "HERMENEGILDA QUIRANTE RIVES",
      sellerDni: "74178814L",
      sellerRepresentativeAddress: "C/ MAYOR, 1, LIBRILLA",
      sellerAddress: "CTRA. NACIONAL 340, KM 695",
      organicOperatorCode: "MU-QA/E",
      certifierCode: "ES-ECO-QA",
      ailimpoRegepaCode: "REG-QA",
      modality: "A KILOS",
      collectionBy: "Comprador",
      transportBy: "Comprador",
      priceAgreement: crop === "Pomelo" ? "A RESULTAS" : "IMPORTE",
      pricePerKg: crop === "Pomelo" ? "" : "1.05",
      totalPrice: "",
      ivaPercent: "12",
      irpfPercent: "2",
      advancePayment: "0",
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
      signatureMethod: "external_pending",
      archiveHistoryJson: "",
      previousContractMode: "none",
      previousContractPurchaseId: "",
      previousContractArchiveId: "",
      previousContractSourceArchiveId: "",
      previousContractFilename: "",
      previousContractStoredAt: "",
    },
  };
}

const { generateContractPackage } = await import(pathToFileURL(generatorPath));
for (const [company, crop, variety, identifier] of cases) {
  const generated = await generateContractPackage(
    purchase(company, crop, variety),
    async (name) => {
      const bytes = await readFile(resolve(templateDirectory, name));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    undefined,
    "docx",
  );
  await writeFile(resolve(outputDirectory, `${identifier}.docx`), new Uint8Array(await generated.blob.arrayBuffer()));
}
process.stdout.write(`Generados ${cases.length} contratos Word de control en ${outputDirectory}.\n`);
