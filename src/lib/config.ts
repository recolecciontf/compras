import type { AppConfig } from "../types";

export const EMPTY_CONFIG: AppConfig = {
  apiBaseUrl: "https://compras-campo-tonifruit.rrhh-0223.chatgpt.site",
};

export async function loadConfig(): Promise<AppConfig> {
  const sameOriginApi = window.location.hostname.endsWith(".chatgpt.site")
    ? window.location.origin
    : "";
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}app-config.json`, { cache: "no-store" });
    if (response.ok) {
      const published = await response.json() as Partial<AppConfig>;
      return {
        ...EMPTY_CONFIG,
        ...published,
        apiBaseUrl: sameOriginApi || published.apiBaseUrl?.trim() || EMPTY_CONFIG.apiBaseUrl,
      };
    }
  } catch {
    // En el alojamiento integrado la API está en el mismo dominio.
  }
  return sameOriginApi ? { apiBaseUrl: sameOriginApi } : EMPTY_CONFIG;
}

export function isConfigured(config: AppConfig) {
  return /^https:\/\//i.test(config.apiBaseUrl.trim());
}
