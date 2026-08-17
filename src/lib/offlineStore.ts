import type { ControlRow, HarvestForm, PurchaseForm, ReviewForm, UserProfile } from "../types";

const DB_NAME = "compras-de-campo-offline-v1";
const DB_VERSION = 1;
const STATE_STORE = "state";
const QUEUE_STORE = "queue";

const ROWS_KEY = "rows";
const PROFILE_KEY = "profile";

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

export async function cacheOfflineSession(profile: UserProfile, rows: ControlRow[]) {
  await Promise.all([putState(PROFILE_KEY, profile), putState(ROWS_KEY, rows)]);
}

export async function cacheOfflineRows(rows: ControlRow[]) {
  await putState(ROWS_KEY, rows);
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
