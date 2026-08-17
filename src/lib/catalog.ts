import type { MaterialItem } from "../types";

// Catálogo publicado por Toñifruit. "Otra" se conserva únicamente como vía
// controlada para altas excepcionales que todavía no aparezcan en la web.
export const PRODUCT_CATALOG: Record<string, string[]> = {
  "Limón": ["Fino", "Fino chaparro", "Primofiori", "Fino 49", "Fino 95", "Rodrejo", "Verdelli", "Verna", "Segundos", "Segundos rodrejos"],
  "Lima": ["Bearss"],
  "Naranja": [
    "Navelina",
    "Lane Late",
    "Salustiana",
    "Valencia Late",
    "Midknight",
    "Summer Navel Powell",
    "Summer Navel Chislett",
    "Sanguina",
  ],
  "Mandarina": [
    "Satsuma Iwasaki",
    "Clemenruby",
    "Oronules",
    "Clemenules",
    "Clemenvilla / Nova",
    "Tango",
    "Nadorcott",
    "Orri",
    "Murcott Seedless",
  ],
  "Clementina": ["Clemenruby", "Oronules", "Clemenules", "Clemenvilla / Nova"],
  "Pomelo": ["Redblush", "Star Ruby"],
  "Granada": ["Smith", "Acco", "Valenciana", "Rubí", "Wonderful", "Mollar"],
  "Uva": ["Itum 17 Blanca", "Sugraone Blanca", "Itum 5 Blanca", "Itum 15 Roja", "Arra 19", "Red Globe", "Red Crimson"],
  "Paraguayo": ["Zodiac", "Carioca", "Samantha", "Contessa", "Babylone"],
  "Nectarina": ["Flariba", "Patagonia", "Garcima", "Copacabana"],
  "Melocotón": ["Astoria", "Pompadour", "Artemis"],
  "Albaricoque": ["Cebas Red", "Mirlo Naranja", "Flopria", "Lady Cot"],
  "Kumquat": ["Kumquat"],
  "Caviar cítrico": ["Caviar cítrico"],
};

export const CERTIFICATIONS = [
  "Ecológico",
  "GlobalG.A.P.",
  "GRASP",
  "SPRING",
  "Naturland",
  "Bio Suisse",
  "Demeter",
  "BRCGS Food Safety",
  "IFS Food",
] as const;

export const OTHER_VALUE = "__other__";

const CERTIFICATION_ALIASES: Record<string, (typeof CERTIFICATIONS)[number]> = {
  eco: "Ecológico",
  ecologico: "Ecológico",
  globalgap: "GlobalG.A.P.",
  grasp: "GRASP",
  spring: "SPRING",
  naturland: "Naturland",
  biosuisse: "Bio Suisse",
  demeter: "Demeter",
  demetersoloalmacen: "Demeter",
  brcgsfoodsafety: "BRCGS Food Safety",
  ifsfood: "IFS Food",
};

function certificationKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "");
}

export function canonicalCertification(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return CERTIFICATION_ALIASES[certificationKey(trimmed)] ?? trimmed;
}

export function certificationSelection(value: string | null | undefined) {
  const seen = new Set<string>();
  return String(value ?? "")
    .split(/[;,·|/+]+/)
    .map(canonicalCertification)
    .filter((item) => {
      const key = certificationKey(item);
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function canonicalMaterial(crop: string, variety: string) {
  return { crop: crop.trim(), variety: variety.trim() };
}

export function emptyMaterial(seed: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: seed.id || crypto.randomUUID(),
    crop: seed.crop || "",
    variety: seed.variety || "",
    expectedKg: seed.expectedKg || "",
    situation: seed.situation || "",
    municipality: seed.municipality || "",
    paraje: seed.paraje || "",
    polygon: seed.polygon || "",
    plot: seed.plot || "",
    hectares: seed.hectares || "",
  };
}

export function materialSummary(materials: MaterialItem[]) {
  const crops = [...new Set(materials.map((item) => item.crop).filter(Boolean))];
  const varieties = materials.map((item) => item.variety).filter(Boolean);
  const kilograms = materials.reduce((total, item) => total + (Number(item.expectedKg.replace(",", ".")) || 0), 0);
  return {
    crop: crops.join(" + "),
    variety: varieties.join(" · "),
    expectedKg: kilograms ? String(kilograms) : "",
  };
}
