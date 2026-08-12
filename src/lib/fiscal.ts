export function companyTaxId(value: string) {
  const normalized = value.trim().toLocaleUpperCase("es").replace(/[\s-]+/g, "");
  return /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(normalized) ? normalized : "";
}

export function hasCompanyTaxId(value: string) {
  return Boolean(companyTaxId(value));
}
