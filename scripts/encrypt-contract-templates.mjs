import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourceDirectory = resolve(process.argv[2] || "public/contract-templates");
const outputDirectory = resolve(process.argv[3] || "worker/contract-templates");
const suppliedKey = process.env.CONTRACT_TEMPLATE_KEY || "";
if (!suppliedKey) throw new Error("Define CONTRACT_TEMPLATE_KEY antes de cifrar los modelos.");
const key = Buffer.from(suppliedKey, "base64");
if (key.length !== 32) throw new Error("CONTRACT_TEMPLATE_KEY debe contener 32 bytes en Base64.");

await mkdir(outputDirectory, { recursive: true });
const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".docx")).sort();
for (const name of names) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(await readFile(resolve(sourceDirectory, name))), cipher.final(), cipher.getAuthTag()]);
  await writeFile(resolve(outputDirectory, `${name}.enc`), Buffer.concat([iv, encrypted]));
}

process.stdout.write(`Cifrados ${names.length} modelos contractuales.\n`);
