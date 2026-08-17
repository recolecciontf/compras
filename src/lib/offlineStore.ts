import type { ControlRow, HarvestForm, PurchaseForm, ReviewForm, UserProfile } from "../types";

const DB_NAME = "compras-de-campo-offline-v2-clean-2026-08-18";
const DB_VERSION = 1;
const STATE_STORE = "state";
const QUEUE_STORE = "queue";

const ROWS_KEY = "rows";
const PROFILE_KEY = "profile";
const CREDENTIALS_KEY_PREFIX = "credentials";
const OFFLINE_KEY_ITERATIONS = 150_000;
const LEGACY_DB_NAMES = ["compras-de-campo-offline-v1"];

function discardLegacyOfflineData() {
  if (typeof indexedDB === "undefined") return;
  for (const name of LEGACY_DB_NAMES) {
    if (name === DB_NAME) continue;
    try {
      indexedDB.deleteDatabase(name);
    } catch {
      // La base nueva utiliza otro nombre y no depende de que una pestaña antigua libere esta copia.
    }
  }
}

discardLegacyOfflineData();

type OfflineCredentials = {
  username: string;
  salt: string;
  iv: string;
  encryptedToken: string;
  iterations: number;
  profile: UserProfile;
};

export type OfflineOperation =
  | {
      id: string;
      kind: "update";
      rowIndex: number;
      recordId: string;
      purchase?: PurchaseForm;
      review?: ReviewForm;
      harvest?: HarvestForm;
      createdAt: string;
    }
  | {
      id: string;
      kind: "create";
      purchase: PurchaseForm;
      temporaryRowIndex: number;
      createdAt: string;
    };

type StoredValue<T> = { key: string; value: T; savedAt: string };

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE)) database.createObjectStore(STATE_STORE, { keyPath: "key" });
      if (!database.objectStoreNames.contains(QUEUE_STORE)) database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se ha podido abrir el almacenamiento sin conexión."));
  });
}

async function withStore<T>(
  storeName: typeof STATE_STORE | typeof QUEUE_STORE,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No se ha podido guardar la copia sin conexión."));
    });
  } finally {
    database.close();
  }
}

async function putState<T>(key: string, value: T) {
  await withStore(STATE_STORE, "readwrite", (store) => store.put({ key, value, savedAt: new Date().toISOString() }));
}

async function getState<T>(key: string) {
  return withStore<StoredValue<T> | undefined>(STATE_STORE, "readonly", (store) => store.get(key));
}

function normalizedUsername(value: string) {
  return value.trim().toLocaleUpperCase("es");
}

function bytesToBase64(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asArrayBuffer(value: Uint8Array) {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

async function offlineEncryptionKey(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: asArrayBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function cacheOfflineSession(profile: UserProfile, rows: ControlRow[]) {
  await Promise.all([putState(PROFILE_KEY, profile), putState(ROWS_KEY, rows)]);
}

export async function cacheOfflineRows(rows: ControlRow[]) {
  await putState(ROWS_KEY, rows);
}

export async function cacheOfflineCredentials(username: string, password: string, sessionToken: string, profile: UserProfile) {
  if (!sessionToken) throw new Error("No se ha podido preparar el acceso sin conexión.");
  const normalized = normalizedUsername(username);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await offlineEncryptionKey(password, salt, OFFLINE_KEY_ITERATIONS);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(iv), additionalData: new TextEncoder().encode(normalized) },
    key,
    new TextEncoder().encode(sessionToken),
  );
  const credentials: OfflineCredentials = {
    username: normalized,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    encryptedToken: bytesToBase64(new Uint8Array(encrypted)),
    iterations: OFFLINE_KEY_ITERATIONS,
    profile,
  };
  await putState(`${CREDENTIALS_KEY_PREFIX}:${normalized}`, credentials);
}

export async function unlockOfflineSession(username: string, password: string) {
  const normalized = normalizedUsername(username);
  const stored = await getState<OfflineCredentials>(`${CREDENTIALS_KEY_PREFIX}:${normalized}`);
  const credentials = stored?.value;
  if (!credentials || credentials.username !== normalized) return null;
  try {
    const iv = base64ToBytes(credentials.iv);
    const key = await offlineEncryptionKey(password, base64ToBytes(credentials.salt), credentials.iterations);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(iv), additionalData: new TextEncoder().encode(normalized) },
      key,
      base64ToBytes(credentials.encryptedToken),
    );
    const token = new TextDecoder().decode(decrypted);
    return token ? { token, profile: credentials.profile } : null;
  } catch {
    return null;
  }
}

export async function loadOfflineSession() {
  const [profile, rows] = await Promise.all([
    getState<UserProfile>(PROFILE_KEY),
    getState<ControlRow[]>(ROWS_KEY),
  ]);
  if (!profile?.value || !Array.isArray(rows?.value)) return null;
  return {
    profile: profile.value,
    rows: rows.value,
    savedAt: rows.savedAt,
  };
}

export async function clearOfflineSession() {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([STATE_STORE, QUEUE_STORE], "readwrite");
      transaction.objectStore(STATE_STORE).clear();
      transaction.objectStore(QUEUE_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("No se ha podido borrar la copia local."));
    });
  } finally {
    database.close();
  }
}

export async function listOfflineOperations() {
  const operations = await withStore<OfflineOperation[]>(QUEUE_STORE, "readonly", (store) => store.getAll());
  return operations.sort((left, right) => {
    const byDate = left.createdAt.localeCompare(right.createdAt);
    if (byDate) return byDate;
    if (left.kind === right.kind) return 0;
    return left.kind === "create" ? -1 : 1;
  });
}

export async function offlineOperationCount() {
  return withStore<number>(QUEUE_STORE, "readonly", (store) => store.count());
}

export async function removeOfflineOperation(id: string) {
  await withStore(QUEUE_STORE, "readwrite", (store) => store.delete(id));
}

export async function queueOfflineUpdate(
  row: ControlRow,
  change: Pick<Extract<OfflineOperation, { kind: "update" }>, "purchase" | "review" | "harvest">,
) {
  const operations = await listOfflineOperations();
  const existing = operations.find((operation) => operation.kind === "update" && operation.rowIndex === row.tableIndex);
  const operation: Extract<OfflineOperation, { kind: "update" }> = {
    id: existing?.id || crypto.randomUUID(),
    kind: "update",
    rowIndex: row.tableIndex,
    recordId: row.id,
    purchase: change.purchase || (existing?.kind === "update" ? existing.purchase : undefined),
    review: change.review || (existing?.kind === "update" ? existing.review : undefined),
    harvest: change.harvest || (existing?.kind === "update" ? existing.harvest : undefined),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  await withStore(QUEUE_STORE, "readwrite", (store) => store.put(operation));
  return operation;
}

export async function queueOfflineCreate(purchase: PurchaseForm, temporaryRowIndex: number) {
  const operation: Extract<OfflineOperation, { kind: "create" }> = {
    id: crypto.randomUUID(),
    kind: "create",
    purchase,
    temporaryRowIndex,
    createdAt: new Date().toISOString(),
  };
  await withStore(QUEUE_STORE, "readwrite", (store) => store.put(operation));
  return operation;
}
