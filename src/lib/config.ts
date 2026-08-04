import type { AppConfig } from "../types";

export const EMPTY_CONFIG: AppConfig = {
  apiBaseUrl: "",
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}app-config.json`, { cache: "no-store" });
    if (response.ok) return { ...EMPTY_CONFIG, ...(await response.json()) };
  } catch {
    // En el alojamiento integrado la API está en el mismo dominio.
  }
  return EMPTY_CONFIG;
}

export function isConfigured(config: AppConfig) {
  return typeof config.apiBaseUrl === "string";
}
