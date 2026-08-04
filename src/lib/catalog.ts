import type { MaterialItem } from "../types";

// Catálogo publicado por Toñifruit. "Otra" se conserva únicamente como vía
// controlada para altas excepcionales que todavía no aparezcan en la web.
export const PRODUCT_CATALOG: Record<string, string[]> = {
  "Limón": ["Fino / Primofiori 49 y 95", "Fino / Primofiori", "Rodrejo / Verdelli", "Verna"],
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
  "Mandarina / Clementina": [
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
  "Pomelo": ["Redblush", "Star Ruby"],
  "Granada": ["Smith", "Acco", "Valenciana", "Rubí", "Wonderful", "Mollar"],
  "Uva": ["Itum 17 Blanca", "Sugraone Blanca", "Itum 5 Blanca", "Itum 15 Roja", "Red Globe", "Red Crimson"],
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

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}

export function canonicalMaterial(crop: string, variety: string) {
  const normalizedCrop = normalized(crop);
  const normalizedVariety = normalized(variety);
  const lemonVarieties = ["rodrejo", "rodrejos", "verdelli", "fino", "primofiori", "eureka"];

  let nextCrop = crop.trim();
  let nextVariety = variety.trim();
  if (
    lemonVarieties.some((item) => normalizedCrop.includes(item)) ||
    (["", "otra", "otra especie"].includes(normalizedCrop) && lemonVarieties.some((item) => normalizedVariety.includes(item)))
  ) {
    nextCrop = "Limón";
    if (!nextVariety || ["otra", "otra variedad"].includes(normalizedVariety)) nextVariety = crop;
  }

  const normalizedNextVariety = normalized(nextVariety);
  if (normalizedNextVariety === "rodrejo" || normalizedNextVariety === "rodrejos" || normalizedNextVariety === "verdelli") {
    nextVariety = "Rodrejo / Verdelli";
  } else if (normalizedNextVariety === "fino" || normalizedNextVariety === "primofiori") {
    nextVariety = "Fino / Primofiori";
  } else if (normalizedNextVariety === "fino 49" || normalizedNextVariety === "fino 95") {
    nextVariety = "Fino / Primofiori 49 y 95";
  }

  if (normalized(nextCrop) === "mandarina" || normalized(nextCrop) === "clementina") {
    nextCrop = "Mandarina / Clementina";
  }
  return { crop: nextCrop, variety: nextVariety };
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
