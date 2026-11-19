export async function copyReference(value: string, clipboard?: Pick<Clipboard, "writeText">) {
  const reference = value.trim();
  if (!reference) throw new Error("Este expediente no tiene referencia.");
  const destination = clipboard || (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
  if (!destination) throw new Error("No se puede acceder al portapapeles. Puedes seleccionar y copiar la referencia manualmente.");
  await destination.writeText(reference);
}
