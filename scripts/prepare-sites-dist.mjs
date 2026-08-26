import { mkdir, copyFile, rm } from "node:fs/promises";

await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
// Los modelos contractuales se sirven cifrados por el Worker. Nunca deben
// quedar copias Word descargables dentro del alojamiento estático.
await rm("dist/contract-templates", { recursive: true, force: true });
