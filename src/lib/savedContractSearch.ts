import type { PurchaseForm } from "../types";

export type SavedContractOption = { value: string; label: string; searchText: string };

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, " ").trim();
}

export function savedContractResults(options: SavedContractOption[], query: string, selectedValue = "") {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = options.filter(option => {
    const text = normalize(`${option.label} ${option.searchText}`);
    const compact = text.replace(/\s/g, "");
    return terms.every(term => text.includes(term) || compact.includes(term));
  });
  const selectedOutsideResults = options.find(option => option.value === selectedValue && !matches.some(match => match.value === option.value));
  return { matches, selectedOutsideResults };
}

export function purchaseContractOption({ row, purchase }: { row: { tableIndex: number }; purchase: PurchaseForm }): SavedContractOption {
  const details = purchase.contractDetails;
  return {
    value: String(row.tableIndex),
    label: [purchase.id, purchase.provider, purchase.farm, `${purchase.crop}${purchase.variety ? ` / ${purchase.variety}` : ""}`].filter(Boolean).join(" · "),
    searchText: [purchase.taxId, purchase.municipality, purchase.campaign, purchase.contractStart, purchase.contractEnd,
      details.contractNumber, details.signatureDate, details.archiveFilename, details.draftArchiveFilename,
      ...purchase.materials.flatMap(material => [material.crop, material.variety, material.municipality, material.paraje, material.polygon, material.plot]),
    ].join(" "),
  };
}
