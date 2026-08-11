import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  CloudOff,
  Download,
  FileCheck2,
  FileText,
  FileUp,
  History,
  ListChecks,
  LogIn,
  LogOut,
  Menu,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sprout,
  Trash2,
  Wifi,
  X,
  XCircle,
} from "lucide-react";
import { HarvestPanel } from "./components/HarvestPanel";
import { NewPurchasePanel, type ContractSubmission } from "./components/NewPurchasePanel";
import { PurchaseFields } from "./components/PurchaseFields";
import { DEMO_ROWS } from "./demo";
import { isConfigured, loadConfig } from "./lib/config";
import { CERTIFICATIONS } from "./lib/catalog";
import { downloadContracts, generateContractPackage, triggerDownload } from "./lib/contractGenerator";
import {
  contractArchiveHistory,
  isRecordCancelled,
  purchaseFromRow,
  recordStatusHistory,
  reviewBlockages,
  reviewFromRow,
  WorkbookClient,
} from "./lib/workbook";
import type { AppConfig, AppView, ContractOutputFormat, ControlRow, HarvestForm, PurchaseForm, RecordFilter, ReviewForm, UserProfile } from "./types";

function formatDate(value: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function purchaseIdPrefix(company: PurchaseForm["contractDetails"]["buyerCompany"]) {
  const normalizedCompany = company.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("es");
  if (normalizedCompany.includes("TONIFRUIT")) return "TON";
  if (normalizedCompany.includes("ORGANICA")) return "MRO";
  throw new Error("Selecciona la empresa compradora para asignar el identificador MRO o TON.");
}

function nextPurchaseId(rows: ControlRow[], company: PurchaseForm["contractDetails"]["buyerCompany"]) {
  const highest = rows.reduce((maximum, row) => {
    const match = row.id.trim().match(/^(?:MRO|TON)-(\d+)$/i);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `${purchaseIdPrefix(company)}-${String(highest + 1).padStart(3, "0")}`;
}

function certificationSelection(value: string | null | undefined) {
  return String(value ?? "")
    .split(/[;,]/)
    .map((item) => item.trim() === "ECO" ? "Ecológico" : item.trim())
    .filter(Boolean);
}

function authorized(row: ControlRow) {
  return reviewBlockages(row, reviewFromRow(row)).length === 0;
}

function currentBlockageReason(row: ControlRow) {
  return reviewBlockages(row, reviewFromRow(row)).join("; ");
}

function mergeReview(row: ControlRow, review: ReviewForm, isAuthorized: boolean, reasons: string[]): ControlRow {
  return {
    ...row,
    ...review,
    canHarvest: isAuthorized ? "SÍ" : "NO",
    blockageReason: isAuthorized ? "" : reasons.join("; "),
  };
}

function mergePurchase(row: ControlRow, purchase: PurchaseForm): ControlRow {
  return {
    ...row,
    ...purchase,
    materialsJson: JSON.stringify(purchase.materials),
    contractDetailsJson: JSON.stringify(purchase.contractDetails),
  };
}

function isArchived(row: ControlRow) {
  return row.archived.trim().toLocaleLowerCase("es") === "sí";
}

function isCancelled(row: ControlRow) {
  return isRecordCancelled(row);
}

type AutoSaveTask = {
  row: ControlRow;
  review: ReviewForm;
  purchase: PurchaseForm;
  reviewChanged: boolean;
  purchaseChanged: boolean;
};

function StatusBadge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`status-badge ${ok ? "status-ok" : "status-blocked"}`}>
      {ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
      {children}
    </span>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="brand-mark"><Sprout size={26} /></div>
      <div className="loading-ring" aria-label="Cargando" />
      <p>Preparando el control documental…</p>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [client, setClient] = useState<WorkbookClient | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [rows, setRows] = useState<ControlRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewForm | null>(null);
  const [purchase, setPurchase] = useState<PurchaseForm | null>(null);
  const [view, setView] = useState<AppView>("records");
  const [filter, setFilter] = useState<RecordFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  const autoSaveBusy = useRef(false);
  const pendingAutoSave = useRef<AutoSaveTask | null>(null);
  const reviewFingerprint = useRef("");
  const purchaseFingerprint = useRef("");
  const loadedRowIndex = useRef<number | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig);
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);

  useEffect(() => {
    if (!config || !isConfigured(config) || demoMode) {
      setClient(null);
      setSignedIn(false);
      setProfile(null);
      return;
    }
    let active = true;
    const nextClient = new WorkbookClient(config);
    setLoading(true);
    setError("");
    nextClient
      .initialize()
      .then(async (connected) => {
        if (!active) return;
        setClient(nextClient);
        setSignedIn(connected);
        if (connected) {
          const [user, workbookRows] = await Promise.all([nextClient.profile(), nextClient.rows()]);
          if (!active) return;
          setProfile(user);
          setRows(workbookRows);
          setLastSyncedAt(new Date());
          setSelectedIndex((current) => current ?? workbookRows[0]?.tableIndex ?? null);
        }
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "No se ha podido iniciar la aplicación."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [config, demoMode]);

  const selected = useMemo(
    () => rows.find((row) => row.tableIndex === selectedIndex) || null,
    [rows, selectedIndex],
  );
  const canEdit = demoMode || profile?.canEdit === true;

  useEffect(() => {
    if (!selected) {
      loadedRowIndex.current = null;
      setReview(null);
      setPurchase(null);
      return;
    }
    if (loadedRowIndex.current === selected.tableIndex) return;
    const nextReview = selected ? reviewFromRow(selected) : null;
    const nextPurchase = selected ? purchaseFromRow(selected) : null;
    const nextFingerprint = nextReview ? JSON.stringify(nextReview) : "";
    const nextPurchaseFingerprint = nextPurchase ? JSON.stringify(nextPurchase) : "";
    loadedRowIndex.current = selected?.tableIndex ?? null;
    reviewFingerprint.current = nextFingerprint;
    purchaseFingerprint.current = nextPurchaseFingerprint;
    setReview(nextReview);
    setPurchase(nextPurchase);
    setAutoSaveStatus("idle");
  }, [selected]);

  async function runAutoSaveQueue() {
    if (autoSaveBusy.current) return;
    autoSaveBusy.current = true;
    try {
      while (pendingAutoSave.current) {
        const task = pendingAutoSave.current;
        pendingAutoSave.current = null;
        const mergedPurchase = mergePurchase(task.row, task.purchase);
        const issues = reviewBlockages(mergedPurchase, task.review);
        setAutoSaveStatus("saving");

        if (!demoMode) {
          if (!client) throw new Error("No hay conexión con Google Sheets.");
          if (task.purchaseChanged) await client.savePurchase(task.row, task.purchase);
          if (task.reviewChanged) await client.saveReview(task.row, task.review);
        }

        const merged = mergeReview(mergedPurchase, task.review, issues.length === 0, issues);
        setRows((current) => current.map((row) => row.tableIndex === task.row.tableIndex ? merged : row));
        reviewFingerprint.current = JSON.stringify(task.review);
        purchaseFingerprint.current = JSON.stringify(task.purchase);
        setLastSyncedAt(new Date());
      }
      setAutoSaveStatus("saved");
    } catch (reason) {
      pendingAutoSave.current = null;
      setAutoSaveStatus("error");
      setError(reason instanceof Error ? reason.message : "No se ha podido guardar el avance.");
    } finally {
      autoSaveBusy.current = false;
      if (pendingAutoSave.current) void runAutoSaveQueue();
    }
  }

  useEffect(() => {
    if (!selected || !review || !purchase || (!signedIn && !demoMode) || !isOnline || view !== "review" || !canEdit) return;
    const nextFingerprint = JSON.stringify(review);
    const nextPurchaseFingerprint = JSON.stringify(purchase);
    const reviewChanged = nextFingerprint !== reviewFingerprint.current;
    const purchaseChanged = nextPurchaseFingerprint !== purchaseFingerprint.current;
    if (!reviewChanged && !purchaseChanged) return;

    if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
    const rowSnapshot = selected;
    const reviewSnapshot = review;
    const purchaseSnapshot = purchase;
    setAutoSaveStatus("pending");

    autoSaveTimer.current = window.setTimeout(() => {
      pendingAutoSave.current = {
        row: rowSnapshot,
        review: reviewSnapshot,
        purchase: purchaseSnapshot,
        reviewChanged,
        purchaseChanged,
      };
      void runAutoSaveQueue();
    }, 850);

    return () => {
      if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
    };
  }, [review, purchase, selected, signedIn, isOnline, view, demoMode, client, canEdit]);

  useEffect(() => {
    if (!client || !signedIn || demoMode || !isOnline || !["records", "harvest"].includes(view)) return;
    const interval = window.setInterval(() => {
      void refresh(true);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [client, signedIn, demoMode, isOnline, view]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return rows.filter((row) => {
      if (filter === "cancelled") {
        if (!isCancelled(row)) return false;
      } else {
        if (isArchived(row) || isCancelled(row)) return false;
      }
      if (filter === "blocked" && authorized(row)) return false;
      if (filter === "authorized" && !authorized(row)) return false;
      if (!normalizedQuery) return true;
      return [row.provider, row.id, row.taxId, row.farm, row.municipality, row.crop]
        .join(" ")
        .toLocaleLowerCase("es")
        .includes(normalizedQuery);
    });
  }, [rows, filter, query]);

  const counts = useMemo(() => {
    const cancelled = rows.filter(isCancelled).length;
    const active = rows.filter((row) => !isArchived(row) && !isCancelled(row));
    const yes = active.filter(authorized).length;
    return { total: active.length, authorized: yes, blocked: active.length - yes, cancelled };
  }, [rows]);

  const predictedRow = selected && purchase ? mergePurchase(selected, purchase) : selected;
  const predictedIssues = predictedRow && review ? reviewBlockages(predictedRow, review) : [];
  const predictedAuthorized = Boolean(selected && review && predictedIssues.length === 0);

  async function refresh(silent = false) {
    if (demoMode) {
      if (!silent) setToast("Datos ficticios actualizados");
      return;
    }
    if (!client || !signedIn) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const nextRows = await client.rows();
      setRows(nextRows);
      setLastSyncedAt(new Date());
      setSelectedIndex((current) => nextRows.some((row) => row.tableIndex === current) ? current : nextRows[0]?.tableIndex ?? null);
      if (!silent) setToast("Google Sheets sincronizado");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido sincronizar Google Sheets.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function connect(username: string, password: string) {
    if (!client) return;
    setLoading(true);
    setError("");
    try {
      await client.signIn(username, password);
      const [user, workbookRows] = await Promise.all([client.profile(), client.rows()]);
      setSignedIn(true);
      setProfile(user);
      setRows(workbookRows);
      setSelectedIndex(workbookRows[0]?.tableIndex ?? null);
      setLastSyncedAt(new Date());
      setView("records");
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    client?.signOut();
    setSignedIn(false);
    setProfile(null);
    setRows([]);
    setSelectedIndex(null);
    setView("records");
    setError("");
  }

  function startDemo() {
    setDemoMode(true);
    setRows(DEMO_ROWS);
    setSelectedIndex(DEMO_ROWS[0].tableIndex);
    setProfile({ displayName: "Modo demostración", userPrincipalName: "Datos ficticios", role: "admin", canEdit: true });
    setSignedIn(true);
    setView("records");
    window.scrollTo({ top: 0, behavior: "auto" });
    setError("");
  }

  function stopDemo() {
    setDemoMode(false);
    setRows([]);
    setSelectedIndex(null);
    setProfile(null);
    setSignedIn(false);
    setView("records");
  }

  function selectRow(row: ControlRow) {
    setSelectedIndex(row.tableIndex);
    setReview(reviewFromRow(row));
    setPurchase(purchaseFromRow(row));
    setView("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!selected || !review || !purchase) return;
    if (!canEdit) {
      setError("Este usuario es de consulta y no puede modificar los datos.");
      return;
    }
    if (autoSaveBusy.current || autoSaveStatus === "pending") {
      setError("Espera a que termine el guardado automático antes de finalizar la revisión.");
      return;
    }
    setSaving(true);
    pendingAutoSave.current = null;
    if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
    setError("");
    const completedReview = { ...review, lastReviewDate: localToday() };
    try {
      if (demoMode) {
        setRows((current) =>
          current.map((row) =>
            row.tableIndex === selected.tableIndex
              ? mergeReview(mergePurchase(row, purchase), completedReview, predictedAuthorized, predictedIssues)
              : row,
          ),
        );
      } else {
        if (!client) throw new Error("No hay conexión con Google Sheets.");
        await client.savePurchase(selected, purchase);
        await client.saveReview(selected, completedReview);
        const nextRows = await client.rows();
        setRows(nextRows);
      }
      setReview(completedReview);
      reviewFingerprint.current = JSON.stringify(completedReview);
      purchaseFingerprint.current = JSON.stringify(purchase);
      setLastSyncedAt(new Date());
      setAutoSaveStatus("saved");
      setToast(predictedAuthorized ? "Revisión finalizada: puede recolectarse" : "Datos obligatorios guardados: sigue bloqueado");
      setView("records");
    } catch (reason) {
      setAutoSaveStatus("error");
      setError(reason instanceof Error ? reason.message : "No se ha podido finalizar la revisión.");
    } finally {
      setSaving(false);
    }
  }

  async function createPurchase(nextPurchase: PurchaseForm, contractSubmission: ContractSubmission) {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    try {
      const assignedId = nextPurchase.id || nextPurchaseId(rows, nextPurchase.contractDetails.buyerCompany);
      let identifiedPurchase: PurchaseForm = {
        ...nextPurchase,
        id: assignedId,
        contractDetails: {
          ...nextPurchase.contractDetails,
          contractNumber: nextPurchase.contractDetails.contractNumber || assignedId,
        },
      };
      const previousReference = contractSubmission.previousContract;
      if (previousReference.mode !== "none") {
        let storedPrevious: {
          previousContractArchiveId: string;
          previousContractFilename: string;
          previousContractStoredAt: string;
        };
        if (demoMode) {
          storedPrevious = {
            previousContractArchiveId: crypto.randomUUID(),
            previousContractFilename: previousReference.mode === "uploaded" ? previousReference.file.name : previousReference.filename,
            previousContractStoredAt: new Date().toISOString(),
          };
        } else {
          if (!client) throw new Error("No hay conexión con Google Sheets.");
          storedPrevious = previousReference.mode === "uploaded"
            ? await client.archivePreviousContract(previousReference.file, identifiedPurchase)
            : await client.copyPreviousContract(previousReference.archiveId, previousReference.purchaseId, identifiedPurchase.provider);
        }
        identifiedPurchase = {
          ...identifiedPurchase,
          contractDetails: {
            ...identifiedPurchase.contractDetails,
            previousContractMode: previousReference.mode,
            previousContractPurchaseId: previousReference.mode === "archived" ? previousReference.purchaseId : "",
            previousContractArchiveId: storedPrevious.previousContractArchiveId,
            previousContractSourceArchiveId: previousReference.mode === "archived" ? previousReference.archiveId : "",
            previousContractFilename: storedPrevious.previousContractFilename,
            previousContractStoredAt: storedPrevious.previousContractStoredAt,
          },
        };
      } else {
        identifiedPurchase = {
          ...identifiedPurchase,
          contractDetails: {
            ...identifiedPurchase.contractDetails,
            previousContractMode: "none",
            previousContractPurchaseId: "",
            previousContractArchiveId: "",
            previousContractSourceArchiveId: "",
            previousContractFilename: "",
            previousContractStoredAt: "",
          },
        };
      }
      let preparedPurchase = identifiedPurchase;
      if (demoMode) {
        preparedPurchase = {
          ...identifiedPurchase,
          documentPath: contractSubmission.mode === "existing"
            ? "Archivo central de demostración"
            : contractSubmission.mode === "unsigned"
              ? "Contrato enviado para firma del vendedor. Pendiente de devolución y archivo"
              : "Pendiente de firma digital y archivo",
          contractDetails: {
            ...identifiedPurchase.contractDetails,
            archiveId: contractSubmission.mode === "existing" ? crypto.randomUUID() : "",
            archiveFilename: contractSubmission.mode === "existing" ? contractSubmission.file.name : "contrato-pendiente-demo.pdf",
            archivedAt: contractSubmission.mode === "existing" ? new Date().toISOString() : "",
            emailStatus: "pending_configuration",
          },
        };
      } else {
        if (!client) throw new Error("No hay conexión con Google Sheets.");
        if (contractSubmission.mode !== "existing") {
          const signatures = contractSubmission.mode === "generated" ? contractSubmission.signatures : undefined;
          const artifact = await generateContractPackage(identifiedPurchase, (name) => client.contractTemplate(name), signatures, contractSubmission.format);
          triggerDownload(artifact.blob, artifact.filename);
          preparedPurchase = {
            ...identifiedPurchase,
            documentPath: contractSubmission.mode === "unsigned"
              ? "Contrato enviado para firma del vendedor. Pendiente de devolución y archivo central"
              : "Pendiente de firma digital del comprador y archivo central",
            contractDetails: {
              ...identifiedPurchase.contractDetails,
              archiveId: "",
              archiveFilename: artifact.filename,
              archivedAt: "",
              emailStatus: "pending_configuration",
            },
          };
        } else {
          const artifact = { blob: contractSubmission.file as Blob, filename: contractSubmission.file.name };
          const archived = await client.archiveContract(artifact.blob, artifact.filename, identifiedPurchase);
          preparedPurchase = {
            ...identifiedPurchase,
            documentPath: `Archivo central: ${archived.archiveFilename}`,
            contractDetails: { ...identifiedPurchase.contractDetails, ...archived },
          };
        }
      }

      let createdIndex: number;
      if (demoMode) {
        createdIndex = Math.max(0, ...rows.map((row) => row.tableIndex)) + 1;
        const created: ControlRow = {
          ...preparedPurchase,
          id: preparedPurchase.id,
          tableIndex: createdIndex,
          contractAlert: "VIGENTE",
          plannedCutDate: "",
          farmChecked: "",
          fieldNotebook: "",
          notebookReviewDate: "",
          analysisStatus: "",
          analysisDate: "",
          certificateType: "",
          certificateExpiry: "",
          otherDocuments: "",
          reviewer: "",
          lastReviewDate: "",
          canHarvest: "NO",
          blockageReason: "Documentación pendiente",
          cutStatus: "No",
          cutKgTotal: "",
          archived: "No",
          materialsJson: JSON.stringify(preparedPurchase.materials),
          contractDetailsJson: JSON.stringify(preparedPurchase.contractDetails),
          recordStatus: "Activo",
          statusReason: "",
          statusUpdatedAt: "",
          statusUpdatedBy: "",
          statusHistoryJson: "",
        };
        setRows((current) => [...current, created]);
        setSelectedIndex(createdIndex);
        setPurchase(purchaseFromRow(created));
        setReview(reviewFromRow(created));
      } else {
        if (!client) throw new Error("No hay conexión con Google Sheets.");
        const created = await client.createPurchase(preparedPurchase);
        createdIndex = created.row;
        const nextRows = await client.rows();
        setRows(nextRows);
        const createdRow = nextRows.find((row) => row.tableIndex === createdIndex);
        if (createdRow) {
          setPurchase(purchaseFromRow(createdRow));
          setReview(reviewFromRow(createdRow));
        }
        setSelectedIndex(createdIndex);
      }
      setLastSyncedAt(new Date());
      const generatedFormat = contractSubmission.mode === "existing" ? "" : contractSubmission.format === "pdf" ? "PDF" : "Word";
      setToast(contractSubmission.mode === "generated"
        ? `Compra creada y ${generatedFormat} descargado. Pendiente de firma digital del comprador, archivo y AICA.`
        : contractSubmission.mode === "unsigned"
        ? `Compra creada y ${generatedFormat} descargado. Pendiente de firma del agricultor, devolución, archivo y AICA.`
        : preparedPurchase.contractDetails.emailStatus === "sent"
        ? "Compra creada, contrato archivado y copias enviadas."
        : preparedPurchase.contractDetails.archiveId
          ? "Compra creada y contrato firmado archivado."
          : "Compra creada. Contrato descargado y pendiente de archivo central.");
      setView("review");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido crear la compra.");
    } finally {
      setSaving(false);
    }
  }

  async function saveHarvest(row: ControlRow, harvest: HarvestForm) {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    try {
      if (demoMode) {
        setRows((current) => current.map((item) => item.tableIndex === row.tableIndex ? { ...item, ...harvest } : item));
      } else {
        if (!client) throw new Error("No hay conexión con Google Sheets.");
        await client.saveHarvest(row, harvest);
        setRows(await client.rows());
      }
      setLastSyncedAt(new Date());
      setToast(harvest.archived === "Sí" ? "Compra archivada" : "Estado del corte guardado");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido guardar el corte.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadPurchaseContracts(format: ContractOutputFormat = "pdf") {
    if (!purchase) return;
    setSaving(true);
    setError("");
    try {
      if (!client || demoMode) throw new Error("Inicia sesión con el usuario real para descargar los modelos contractuales protegidos.");
      if (purchase.contractDetails.archiveId) {
        const archived = await client.archivedContract(purchase.contractDetails.archiveId);
        triggerDownload(archived.blob, archived.filename);
        setToast("Contrato firmado descargado");
        return;
      }
      const count = await downloadContracts(purchase, (name) => client.contractTemplate(name), format);
      const formatLabel = format === "pdf" ? "PDF" : "Word";
      setToast(count === 1 ? `Contrato ${formatLabel} descargado` : `${count} contratos ${formatLabel} incluidos en el ZIP`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido generar el contrato.");
    } finally {
      setSaving(false);
    }
  }

  async function attachSignedContract(file: File) {
    if (!purchase || !selected) return;
    setSaving(true);
    setError("");
    try {
      if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
      pendingAutoSave.current = null;
      const waitStartedAt = Date.now();
      while (autoSaveBusy.current) {
        if (Date.now() - waitStartedAt > 15_000) throw new Error("El guardado anterior está tardando demasiado. Espera unos segundos y vuelve a adjuntar el contrato.");
        await new Promise((resolve) => window.setTimeout(resolve, 60));
      }
      let archived;
      if (demoMode) {
        archived = {
          archiveId: crypto.randomUUID(),
          archiveFilename: file.name,
          archivedAt: new Date().toISOString(),
          emailStatus: "pending_configuration" as const,
        };
      } else if (client) {
        archived = await client.archiveContract(file, file.name, purchase);
      } else {
        throw new Error("No hay conexión con Google Sheets.");
      }
      const updated: PurchaseForm = {
        ...purchase,
        contractSigned: "Sí",
        documentPath: `Archivo central: ${archived.archiveFilename}`,
        contractDetails: {
          ...purchase.contractDetails,
          contractOrigin: "existing",
          signatureMethod: "uploaded",
          ...archived,
        },
      };
      if (!demoMode) await client!.savePurchase(selected, updated);
      purchaseFingerprint.current = JSON.stringify(updated);
      setPurchase(updated);
      setRows((current) => current.map((row) => row.tableIndex === selected.tableIndex ? mergePurchase(row, updated) : row));
      setToast(archived.emailStatus === "sent"
        ? "Contrato firmado archivado y copias enviadas"
        : "Contrato firmado archivado");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido adjuntar el contrato firmado.");
    } finally {
      setSaving(false);
    }
  }

  async function persistOpenDraft() {
    if (!selected || !review || !purchase) return;
    if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = null;
    pendingAutoSave.current = null;
    const waitStartedAt = Date.now();
    while (autoSaveBusy.current) {
      if (Date.now() - waitStartedAt > 15_000) throw new Error("El guardado anterior está tardando demasiado. Espera unos segundos y vuelve a intentarlo.");
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }
    if (!demoMode) {
      if (!client) throw new Error("No hay conexión con Google Sheets.");
      if (JSON.stringify(purchase) !== purchaseFingerprint.current) await client.savePurchase(selected, purchase);
      if (JSON.stringify(review) !== reviewFingerprint.current) await client.saveReview(selected, review);
    }
    purchaseFingerprint.current = JSON.stringify(purchase);
    reviewFingerprint.current = JSON.stringify(review);
  }

  async function changeRecordStatus(status: "Activo" | "Anulado", reason: string) {
    if (!selected || !canEdit) return false;
    setSaving(true);
    setError("");
    try {
      await persistOpenDraft();
      let statusUpdate: Pick<ControlRow, "recordStatus" | "statusReason" | "statusUpdatedAt" | "statusUpdatedBy" | "statusHistoryJson">;
      if (demoMode) {
        const changedAt = new Date().toISOString();
        const history = [...recordStatusHistory(selected), { status, reason, changedAt, changedBy: "ADMINISTRADOR" }];
        statusUpdate = {
          recordStatus: status,
          statusReason: reason,
          statusUpdatedAt: changedAt,
          statusUpdatedBy: "ADMINISTRADOR",
          statusHistoryJson: JSON.stringify(history),
        };
      } else {
        if (!client) throw new Error("No hay conexión con Google Sheets.");
        statusUpdate = await client.updateRecordStatus(selected, status, reason);
      }
      setRows((current) => current.map((row) => row.tableIndex === selected.tableIndex ? { ...row, ...statusUpdate } : row));
      setLastSyncedAt(new Date());
      setToast(status === "Anulado" ? "Expediente anulado" : "Expediente restaurado");
      return true;
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se ha podido cambiar el estado del expediente.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function replaceSignedContract(file: File, reason: string) {
    if (!selected || !purchase || !canEdit) return false;
    setSaving(true);
    setError("");
    try {
      await persistOpenDraft();
      if (demoMode) {
        const previous = {
          archiveId: purchase.contractDetails.archiveId,
          archiveFilename: purchase.contractDetails.archiveFilename,
          archivedAt: purchase.contractDetails.archivedAt,
          replacedAt: new Date().toISOString(),
          replacedBy: "ADMINISTRADOR",
          reason,
        };
        const updated: PurchaseForm = {
          ...purchase,
          documentPath: `Archivo central: ${file.name}`,
          contractDetails: {
            ...purchase.contractDetails,
            archiveId: crypto.randomUUID(),
            archiveFilename: file.name,
            archivedAt: new Date().toISOString(),
            archiveHistoryJson: JSON.stringify([...contractArchiveHistory(purchase), previous]),
          },
        };
        setPurchase(updated);
        purchaseFingerprint.current = JSON.stringify(updated);
        setRows((current) => current.map((row) => row.tableIndex === selected.tableIndex ? mergePurchase(row, updated) : row));
      } else {
        if (!client) throw new Error("No hay conexión con Google Sheets.");
        await client.replaceContract(selected, file, reason, purchase);
        const nextRows = await client.rows();
        loadedRowIndex.current = null;
        setRows(nextRows);
      }
      setLastSyncedAt(new Date());
      setToast("Contrato sustituido; la versión anterior permanece en el historial");
      return true;
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se ha podido sustituir el contrato.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function downloadArchivedContract(archiveId: string) {
    setSaving(true);
    setError("");
    try {
      if (!client || demoMode) throw new Error("La descarga de versiones anteriores solo está disponible con la sesión real.");
      const archived = await client.archivedContract(archiveId);
      triggerDownload(archived.blob, archived.filename);
      setToast("Versión anterior descargada");
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se ha podido descargar la versión anterior.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(reason: string, confirmation: string, acknowledgement: string) {
    if (!selected || !canEdit) return false;
    setSaving(true);
    setError("");
    try {
      if (!isCancelled(selected)) throw new Error("Antes del borrado definitivo debes anular el expediente.");
      if (!demoMode) {
        if (!client) throw new Error("No hay conexión con Google Sheets.");
        await client.deleteRecord(selected, reason, confirmation, acknowledgement);
      }
      setRows((current) => current.filter((row) => row.tableIndex !== selected.tableIndex));
      setSelectedIndex(null);
      loadedRowIndex.current = null;
      setReview(null);
      setPurchase(null);
      setView("records");
      setLastSyncedAt(new Date());
      setToast("Expediente eliminado definitivamente");
      return true;
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se ha podido eliminar el expediente.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  if (!config) return <LoadingScreen />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img
            className="brand-logo"
            src="https://tonifruit.com/wp-content/uploads/2020/06/tonifruit-logo-1-250x90.png"
            alt="Toñifruit"
          />
          <span className="brand-divider" aria-hidden="true" />
          <div className="brand-app-name">
            <span>Departamento de compras</span>
            <strong>Compras de campo</strong>
          </div>
        </div>
        {(signedIn || demoMode) && (
          <nav className="desktop-nav" aria-label="Navegación principal">
            <button className={view === "records" || view === "review" ? "active" : ""} onClick={() => setView("records")}><ListChecks size={17} /> Expedientes</button>
            {canEdit && <button className={view === "new" ? "active" : ""} onClick={() => setView("new")}><Plus size={17} /> Nueva compra</button>}
            <button className={view === "harvest" ? "active" : ""} onClick={() => setView("harvest")}><PackageCheck size={17} /> Cortes</button>
          </nav>
        )}
        <div className="topbar-actions">
          {(signedIn || demoMode) && <span className="role-pill">{canEdit ? "Administrador" : "Consultas"}</span>}
          <span className={`connection ${isOnline ? "online" : "offline"}`} title={isOnline ? "Con conexión" : "Sin conexión"}>
            {isOnline ? <Wifi size={17} /> : <CloudOff size={17} />}
          </span>
          {installPrompt && (
            <button className="icon-button install-button" onClick={installApp} title="Instalar aplicación" aria-label="Instalar aplicación">
              <Download size={20} />
            </button>
          )}
          {(signedIn || demoMode) && (
            <button className="icon-button" onClick={() => refresh()} disabled={loading} title="Sincronizar datos" aria-label="Sincronizar datos">
              <RefreshCw className={loading ? "spinning" : ""} size={20} />
            </button>
          )}
          {(signedIn || demoMode) && (
            <button
              className="icon-button"
              onClick={demoMode ? stopDemo : logout}
              title={demoMode ? "Salir de la demostración" : "Cerrar sesión"}
              aria-label={demoMode ? "Salir de la demostración" : "Cerrar sesión"}
            >
              <LogOut size={20} />
            </button>
          )}
        </div>
      </header>

      {!isOnline && <div className="offline-banner"><CloudOff size={16} /> Sin conexión: consulta disponible; guarda cuando recuperes internet.</div>}
      {demoMode && <div className="demo-banner"><AlertTriangle size={16} /> Demostración activa · Los datos son ficticios y no llegan a Google Sheets.</div>}

      <main className="main-content">
        {error && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={19} />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Cerrar aviso"><X size={18} /></button>
          </div>
        )}

        {!isConfigured(config) && !demoMode ? (
          <ConfigurationUnavailablePanel onDemo={startDemo} />
        ) : !signedIn && !demoMode ? (
          <ConnectPanel
            loading={loading}
            onConnect={connect}
            onDemo={startDemo}
          />
        ) : (
          <div className="workspace">
            <section className={`records-pane ${view !== "records" ? "mobile-hidden" : ""}`}>
              <div className="dashboard-hero">
                <img src={`${import.meta.env.BASE_URL}og.png`} alt="Compras de campo: control documental, materia prima y cortes" />
                <span className="hero-status"><span /> Sistema operativo</span>
              </div>

              <div className="welcome-row">
                <div>
                  <p className="welcome">Hola, {profile?.displayName?.split(" ")[0] || "equipo"}</p>
                  <h1>{filter === "cancelled" ? "Expedientes anulados" : "Expedientes activos"}</h1>
                </div>
                <span className="sync-caption">
                  {loading ? "Sincronizando…" : lastSyncedAt ? `Actualizado ${lastSyncedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : `${counts.total} expedientes`}
                </span>
              </div>

              <div className="quick-actions">
                {canEdit && <button className="action-card action-card-primary" onClick={() => setView("new")}><span className="action-icon"><Plus size={20} /></span><span><strong>Nueva compra</strong><small>Agricultor, fruta y contrato</small></span><ChevronRight size={19} /></button>}
                <button className="action-card" onClick={() => setView("harvest")}><span className="action-icon"><PackageCheck size={20} /></span><span><strong>Cortes y kilos</strong><small>Seguimiento de recolección</small></span><ChevronRight size={19} /></button>
              </div>

              <div className="summary-grid">
                <article className="summary-card summary-total">
                  <ListChecks size={21} />
                  <span>Total</span>
                  <strong>{counts.total}</strong>
                </article>
                <article className="summary-card summary-ok">
                  <CheckCircle2 size={21} />
                  <span>Autorizados</span>
                  <strong>{counts.authorized}</strong>
                </article>
                <article className="summary-card summary-blocked">
                  <XCircle size={21} />
                  <span>Bloqueados</span>
                  <strong>{counts.blocked}</strong>
                </article>
                <article className="summary-card summary-cancelled">
                  <Ban size={21} />
                  <span>Anulados</span>
                  <strong>{counts.cancelled}</strong>
                </article>
              </div>

              <div className="search-box">
                <Search size={20} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar agricultor, finca o cultivo" />
                {query && <button onClick={() => setQuery("")} aria-label="Borrar búsqueda"><X size={18} /></button>}
              </div>

              <div className="filter-tabs" role="group" aria-label="Filtrar expedientes">
                <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todos</button>
                <button className={filter === "blocked" ? "active" : ""} onClick={() => setFilter("blocked")}>Bloqueados</button>
                <button className={filter === "authorized" ? "active" : ""} onClick={() => setFilter("authorized")}>Autorizados</button>
                <button className={filter === "cancelled" ? "active" : ""} onClick={() => setFilter("cancelled")}>Anulados</button>
              </div>

              <div className="records-list">
                {loading && !rows.length ? (
                  <div className="list-loading"><div className="loading-ring" /><p>Consultando Google Sheets…</p></div>
                ) : visibleRows.length ? (
                  visibleRows.map((row) => (
                    <button
                      key={`${row.id}-${row.tableIndex}`}
                      className={`record-card ${selectedIndex === row.tableIndex ? "selected" : ""} ${isCancelled(row) ? "record-cancelled" : ""}`}
                      onClick={() => selectRow(row)}
                    >
                      <span className={`record-stripe ${isCancelled(row) ? "stripe-cancelled" : authorized(row) ? "stripe-ok" : "stripe-blocked"}`} />
                      <span className="record-content">
                        <span className="record-heading">
                          <strong>{row.provider}</strong>
                          {isCancelled(row)
                            ? <span className="status-badge status-cancelled"><Ban size={15} /> ANULADO</span>
                            : <StatusBadge ok={authorized(row)}>{authorized(row) ? "SÍ" : "NO"}</StatusBadge>}
                        </span>
                        <span className="record-crop">{row.crop || "Especie sin indicar"}{row.variety ? ` · ${row.variety}` : ""}</span>
                        <span className="record-meta">
                          <span><Sprout size={15} /> {row.farm || "Finca sin indicar"}</span>
                          <span><CalendarDays size={15} /> {row.plannedCutDate ? formatDate(row.plannedCutDate) : "Corte pendiente"}</span>
                          {row.expectedKg && <span><PackageCheck size={15} /> {new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(Number(row.expectedKg))} kg previstos</span>}
                        </span>
                        {!authorized(row) && <span className="blockage-preview">{currentBlockageReason(row)}</span>}
                      </span>
                      <ChevronRight className="record-chevron" size={20} />
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <Search size={32} />
                    <h3>No hay resultados</h3>
                    <p>Prueba con otro nombre o cambia el filtro.</p>
                  </div>
                )}
              </div>
            </section>

            <section className={`review-pane ${view === "records" ? "mobile-hidden" : ""}`}>
              {view === "review" && selected && review && purchase ? (
                <ReviewPanel
                  row={selected}
                  purchase={purchase}
                  review={review}
                  issues={predictedIssues}
                  saving={saving}
                  autoSaveStatus={autoSaveStatus}
                  readOnly={!canEdit}
                  onPurchaseChange={setPurchase}
                  onChange={setReview}
                  onSubmit={submitReview}
                  onReset={() => { setReview(reviewFromRow(selected)); setPurchase(purchaseFromRow(selected)); }}
                  onContractDownload={downloadPurchaseContracts}
                  onContractUpload={attachSignedContract}
                  onArchivedContractDownload={downloadArchivedContract}
                  onStatusChange={changeRecordStatus}
                  onContractReplace={replaceSignedContract}
                  onDeleteRecord={deleteRecord}
                  onBack={() => setView("records")}
                />
              ) : view === "new" && canEdit ? (
                <NewPurchasePanel
                  saving={saving}
                  rows={rows}
                  onCreate={createPurchase}
                  onPreviousContractDownload={downloadArchivedContract}
                  onBack={() => setView("records")}
                />
              ) : view === "harvest" ? (
                <HarvestPanel rows={rows} readOnly={!canEdit} saving={saving} onSave={saveHarvest} onBack={() => setView("records")} />
              ) : (
                <div className="select-prompt">
                  <ClipboardCheck size={40} />
                  <h2>Selecciona un expediente</h2>
                  <p>Elige un agricultor para revisar su documentación.</p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {(signedIn || demoMode) && (
        <nav className="bottom-nav" aria-label="Navegación principal">
          <button className={view === "records" ? "active" : ""} onClick={() => setView("records")}>
            <Menu size={21} /><span>Registros</span>
          </button>
          <button className={view === "review" ? "active" : ""} onClick={() => selected && setView("review")} disabled={!selected}>
            <ClipboardCheck size={21} /><span>{canEdit ? "Revisión" : "Consulta"}</span>
          </button>
          {canEdit && <button className={view === "new" ? "active" : ""} onClick={() => setView("new")}>
            <Plus size={21} /><span>Nueva</span>
          </button>}
          <button className={view === "harvest" ? "active" : ""} onClick={() => setView("harvest")}>
            <PackageCheck size={21} /><span>Cortes</span>
          </button>
        </nav>
      )}

      {toast && <div className="toast" role="status"><Check size={18} /> {toast}</div>}
    </div>
  );
}

function ConnectPanel({
  loading,
  onConnect,
  onDemo,
}: {
  loading: boolean;
  onConnect: (username: string, password: string) => Promise<void>;
  onDemo: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <section className="login-layout">
      <div className="login-showcase">
        <div className="login-visual">
          <img src={`${import.meta.env.BASE_URL}og.png`} alt="Compras de campo de Toñifruit" />
        </div>
        <div className="login-showcase-copy">
          <span>Gestión de origen</span>
          <strong>La compra empieza con toda la información bajo control.</strong>
          <div className="showcase-points">
            <div><FileCheck2 size={19} /><span>Contratos y documentación</span></div>
            <div><Sprout size={19} /><span>Materia prima y fincas</span></div>
            <div><PackageCheck size={19} /><span>Cortes y kilos recolectados</span></div>
          </div>
        </div>
      </div>
      <div className="connect-card">
        <div className="connect-brand">
          <img src="https://tonifruit.com/wp-content/uploads/2020/06/tonifruit-logo-1-250x90.png" alt="Toñifruit" />
          <span>Herramienta interna</span>
        </div>
        <div className="connect-icon"><ShieldCheck size={30} /></div>
        <span className="eyebrow">Acceso seguro</span>
        <h1>Compras de campo</h1>
        <p>Gestiona contratos, documentación, materia prima y cortes desde un único lugar.</p>
        <form className="login-form" onSubmit={(event) => { event.preventDefault(); void onConnect(username, password); }}>
          <label className="field required-field"><span>Usuario</span><input required autoCapitalize="characters" autoComplete="username" placeholder="ADMINISTRADOR o CONSULTAS" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="field required-field"><span>Contraseña</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={loading || !username.trim() || !password}>
            <LogIn size={20} /> {loading ? "Comprobando…" : "Entrar"}
          </button>
        </form>
        <button className="secondary-button" onClick={onDemo}>Ver demostración</button>
        <div className="security-note"><ShieldCheck size={17} /><span>Acceso restringido al departamento de Compras. Los datos se sincronizan con el registro central.</span></div>
      </div>
    </section>
  );
}

function ConfigurationUnavailablePanel({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="connect-card">
      <div className="connect-icon"><AlertTriangle size={36} /></div>
      <span className="eyebrow">Servicio no disponible</span>
      <h1>No se puede abrir Compras de campo</h1>
      <p>La configuración central no está disponible. Contacta con la persona administradora.</p>
      <button className="secondary-button" onClick={onDemo}>Ver demostración</button>
    </section>
  );
}

type ManagementAction = "cancel" | "restore" | "replace" | "delete" | null;

function RecordManagementPanel({
  row,
  cancelled,
  hasArchivedContract,
  saving,
  onStatusChange,
  onContractReplace,
  onDeleteRecord,
}: {
  row: ControlRow;
  cancelled: boolean;
  hasArchivedContract: boolean;
  saving: boolean;
  onStatusChange: (status: "Activo" | "Anulado", reason: string) => Promise<boolean>;
  onContractReplace: (file: File, reason: string) => Promise<boolean>;
  onDeleteRecord: (reason: string, confirmation: string, acknowledgement: string) => Promise<boolean>;
}) {
  const [action, setAction] = useState<ManagementAction>(null);
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const statusHistory = recordStatusHistory(row);

  function resetAction() {
    setAction(null);
    setReason("");
    setReplacement(null);
    setConfirmation("");
    setAcknowledged(false);
  }

  useEffect(() => resetAction(), [row.tableIndex]);

  function choose(next: Exclude<ManagementAction, null>) {
    resetAction();
    setAction(next);
  }

  async function confirmAction() {
    if (reason.trim().length < 5) return;
    let completed = false;
    if (action === "cancel") completed = await onStatusChange("Anulado", reason.trim());
    if (action === "restore") completed = await onStatusChange("Activo", reason.trim());
    if (action === "replace" && replacement) completed = await onContractReplace(replacement, reason.trim());
    if (action === "delete") {
      completed = await onDeleteRecord(
        reason.trim(),
        confirmation.trim(),
        acknowledged ? "ELIMINAR DEFINITIVAMENTE" : "",
      );
    }
    if (completed) resetAction();
  }

  const canConfirm = reason.trim().length >= 5
    && (action !== "replace" || Boolean(replacement))
    && (action !== "delete" || (cancelled && confirmation.trim() === row.id && acknowledged));

  return (
    <section className="record-management" aria-labelledby="record-management-title">
      <div className="record-management-heading">
        <div><span className="step-number">G</span><span><strong id="record-management-title">Gestión del expediente</strong><small>Acciones reservadas al Administrador y registradas en el historial</small></span></div>
        <ShieldCheck size={20} />
      </div>
      <div className="management-actions">
        {cancelled ? (
          <button className="secondary-button" type="button" disabled={saving} onClick={() => choose("restore")}><RotateCcw size={17} /> Restaurar expediente</button>
        ) : (
          <button className="secondary-button cancel-button" type="button" disabled={saving} onClick={() => choose("cancel")}><Ban size={17} /> Anular expediente</button>
        )}
        {hasArchivedContract && (
          <button className="secondary-button" type="button" disabled={saving} onClick={() => choose("replace")}><FileUp size={17} /> Sustituir contrato</button>
        )}
        <button className="secondary-button delete-button" type="button" disabled={saving || !cancelled} onClick={() => choose("delete")} title={cancelled ? "Eliminar un registro creado por error" : "Primero debes anular el expediente"}><Trash2 size={17} /> Eliminar definitivamente</button>
      </div>
      {!cancelled && <p className="management-help">El borrado definitivo solo se habilita después de anular el expediente.</p>}

      {action && (
        <div className={`management-confirmation ${action === "delete" ? "danger-confirmation" : ""}`} role="dialog" aria-label="Confirmar acción de gestión">
          <div className="management-confirmation-title">
            <strong>{action === "cancel" ? "Anular expediente" : action === "restore" ? "Restaurar expediente" : action === "replace" ? "Sustituir contrato firmado" : "Eliminar definitivamente"}</strong>
            <button type="button" onClick={resetAction} aria-label="Cerrar"><X size={18} /></button>
          </div>
          <label className="field required-field"><span>Motivo</span><textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Indica el motivo de esta acción" /></label>
          {action === "replace" && (
            <label className="replacement-file">
              <FileUp size={18} />
              <span><strong>{replacement ? replacement.name : "Seleccionar nuevo contrato PDF"}</strong><small>La versión actual permanecerá disponible en el historial.</small></span>
              <input type="file" accept=".pdf,application/pdf" onChange={(event) => setReplacement(event.target.files?.[0] || null)} />
            </label>
          )}
          {action === "delete" && (
            <div className="delete-confirmations">
              <div className="danger-note"><AlertTriangle size={18} /><span>Esta operación vaciará la fila y eliminará los contratos asociados. No se puede deshacer.</span></div>
              <label className="field required-field"><span>Escribe {row.id} para confirmar</span><input value={confirmation} autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} /></label>
              <label className="acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.currentTarget.checked)} /><span>Confirmo que el expediente fue creado por error y debe eliminarse definitivamente.</span></label>
            </div>
          )}
          <div className="management-confirmation-actions">
            <button className="text-button" type="button" disabled={saving} onClick={resetAction}>Cancelar</button>
            <button className={action === "delete" ? "danger-button" : "primary-button"} type="button" disabled={saving || !canConfirm} onClick={() => void confirmAction()}>
              {action === "delete" ? <Trash2 size={17} /> : action === "replace" ? <FileUp size={17} /> : <Check size={17} />}
              {saving ? "Guardando…" : action === "delete" ? "Eliminar definitivamente" : "Confirmar"}
            </button>
          </div>
        </div>
      )}

      {statusHistory.length > 0 && (
        <details className="management-history status-history">
          <summary><History size={17} /> Historial del expediente <span>{statusHistory.length}</span></summary>
          <div className="history-list">
            {[...statusHistory].reverse().map((entry, index) => (
              <article key={`${entry.changedAt}-${index}`}>
                <div><strong>{entry.status}</strong><small>{entry.changedBy || "Administrador"}{entry.changedAt ? ` · ${formatDate(entry.changedAt.slice(0, 10))}` : ""}<br />Motivo: {entry.reason || "No indicado"}</small></div>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function ReviewPanel({
  row,
  purchase,
  review,
  issues,
  saving,
  autoSaveStatus,
  readOnly,
  onPurchaseChange,
  onChange,
  onSubmit,
  onReset,
  onContractDownload,
  onContractUpload,
  onArchivedContractDownload,
  onStatusChange,
  onContractReplace,
  onDeleteRecord,
  onBack,
}: {
  row: ControlRow;
  purchase: PurchaseForm;
  review: ReviewForm;
  issues: string[];
  saving: boolean;
  autoSaveStatus: "idle" | "pending" | "saving" | "saved" | "error";
  readOnly: boolean;
  onPurchaseChange: Dispatch<SetStateAction<PurchaseForm | null>>;
  onChange: Dispatch<SetStateAction<ReviewForm | null>>;
  onSubmit: (event: FormEvent) => void;
  onReset: () => void;
  onContractDownload: (format?: ContractOutputFormat) => Promise<void>;
  onContractUpload: (file: File) => Promise<void>;
  onArchivedContractDownload: (archiveId: string) => Promise<void>;
  onStatusChange: (status: "Activo" | "Anulado", reason: string) => Promise<boolean>;
  onContractReplace: (file: File, reason: string) => Promise<boolean>;
  onDeleteRecord: (reason: string, confirmation: string, acknowledgement: string) => Promise<boolean>;
  onBack: () => void;
}) {
  function update<K extends keyof ReviewForm>(key: K, value: ReviewForm[K]) {
    onChange((current) => current ? { ...current, [key]: value } : current);
  }

  function updatePurchase<K extends keyof PurchaseForm>(key: K, value: PurchaseForm[K]) {
    onPurchaseChange((current) => current ? { ...current, [key]: value } : current);
  }

  const hasSignedContract = ["sí", "si"].includes(purchase.contractSigned.trim().toLocaleLowerCase("es"));
  const hasArchivedContract = Boolean(purchase.contractDetails.archiveId);
  const awaitsExternalSignature = purchase.contractDetails.signatureMethod === "external_pending";
  const canAttachFinalContract = hasSignedContract || Boolean(purchase.contractDetails.sellerSignedAt) || awaitsExternalSignature;
  const selectedCertifications = certificationSelection(review.certificateType);
  const cancelled = isCancelled(row);
  const contractHistory = contractArchiveHistory(purchase);

  function toggleCertification(certificate: string) {
    // El botón alterna desde el estado más reciente. Así no dependemos del
    // estado transitorio de un checkbox oculto, que en algunos navegadores
    // móviles podía dejar la interfaz sin responder.
    onChange((current) => {
      if (!current) return current;
      const selected = certificationSelection(current.certificateType);
      const next = selected.includes(certificate)
        ? selected.filter((item) => item !== certificate)
        : [...selected, certificate];
      return { ...current, certificateType: next.join("; ") };
    });
  }

  return (
    <form className="review-form" onSubmit={onSubmit}>
      <div className="review-header">
        <button className="back-button mobile-back" type="button" onClick={onBack}><ArrowLeft size={20} /> Expedientes</button>
        <div className="review-title-row">
          <div>
            <span className="eyebrow">{row.id || "Expediente"}</span>
            <h2>{purchase.provider}</h2>
            <p>{purchase.crop || "Especie sin indicar"}{purchase.variety ? ` · ${purchase.variety}` : ""} · {purchase.farm || "Finca sin indicar"}</p>
          </div>
          {cancelled
            ? <span className="status-badge status-cancelled"><Ban size={15} /> Anulado</span>
            : <StatusBadge ok={issues.length === 0}>{issues.length === 0 ? "Autorizado" : "Bloqueado"}</StatusBadge>}
        </div>

        <div className="contract-strip">
          <span><CalendarDays size={17} /><strong>Contrato</strong></span>
          <span>{formatDate(purchase.contractStart)} — {formatDate(purchase.contractEnd)}</span>
          <span className={`contract-alert ${row.contractAlert.includes("VIGENTE") ? "contract-ok" : "contract-warning"}`}>{row.contractAlert || "Sin estado"}</span>
        </div>
      </div>

      {readOnly && <div className="readonly-note"><ShieldCheck size={18} /><span>Modo consulta: puedes revisar todos los datos, pero no modificarlos.</span></div>}
      {cancelled && (
        <div className="cancelled-note">
          <Ban size={19} />
          <span><strong>Expediente anulado</strong><small>{row.statusReason || "Sin motivo indicado"}{row.statusUpdatedAt ? ` · ${formatDate(row.statusUpdatedAt.slice(0, 10))}` : ""}</small></span>
        </div>
      )}

      <div className="autosave-row" role="status">
        <span className={`autosave-state autosave-${autoSaveStatus}`}>
          {autoSaveStatus === "saving" && <RefreshCw className="spinning" size={16} />}
          {autoSaveStatus === "pending" && <RefreshCw size={16} />}
          {autoSaveStatus === "saved" && <CheckCircle2 size={16} />}
          {autoSaveStatus === "error" && <AlertTriangle size={16} />}
          {autoSaveStatus === "idle" && <FileCheck2 size={16} />}
          {readOnly ? "Datos en modo consulta" : autoSaveStatus === "saving" ? "Guardando en Google Sheets…" : autoSaveStatus === "pending" ? "Cambio pendiente de guardar" : autoSaveStatus === "saved" ? "Guardado automáticamente" : autoSaveStatus === "error" ? "Error al guardar" : "Los cambios se guardan automáticamente"}
        </span>
        <span className={`completion-count ${issues.length ? "has-pending" : "is-complete"}`}>
          {issues.length ? `${issues.length} pendiente${issues.length === 1 ? "" : "s"}` : "Todos los obligatorios completos"}
        </span>
      </div>

      <fieldset className="purchase-fieldset" disabled={readOnly || cancelled}>
        <legend><span className="step-number">A</span><span>Compra y materia prima<small>Datos comerciales, fruta y vigencia contractual</small></span></legend>
        <PurchaseFields
          value={purchase}
          contractMode={purchase.contractDetails.contractOrigin === "existing" ? "existing" : awaitsExternalSignature ? "unsigned" : "editing"}
          onChange={(next) => onPurchaseChange((current) => current
            ? typeof next === "function" ? next(current) : next
            : current)}
          disabled={readOnly}
        />
      </fieldset>

      <div className={`contract-download-panel ${hasArchivedContract ? "contract-archived" : canAttachFinalContract ? "contract-awaiting-file" : "contract-draft"}`}>
        <div>
          {hasArchivedContract ? <FileCheck2 size={21} /> : canAttachFinalContract ? <FileUp size={21} /> : <FileCheck2 size={21} />}
          <span>
            <strong>{hasArchivedContract ? "Contrato firmado archivado" : awaitsExternalSignature ? "Pendiente de firma del agricultor" : canAttachFinalContract ? "Pendiente de firma del comprador y archivo" : "Contrato listo para generar"}</strong>
            <small>
              {hasArchivedContract
                ? `Copia central: ${purchase.contractDetails.archiveFilename || "contrato firmado"}. Disponible para los usuarios autorizados.`
                : awaitsExternalSignature
                  ? "Envía el PDF al agricultor. Cuando lo devuelva firmado, adjunta aquí la copia definitiva; después podrá completarse la firma de la empresa y validarse el registro en AICA."
                : canAttachFinalContract
                  ? "Tras la firma digital de la empresa, adjunta el PDF definitivo. Después podrá validarse el registro en AICA."
                  : "Puedes descargar una copia PDF estable o el documento Word. Si hay varias especies, se descarga un contrato por especie."}
            </small>
          </span>
        </div>
        {hasArchivedContract ? (
          <button className="secondary-button" type="button" disabled={saving} onClick={() => void onContractDownload()}><Download size={18} /> {saving ? "Descargando…" : "Descargar contrato firmado"}</button>
        ) : canAttachFinalContract && !readOnly ? (
          <div className="contract-panel-actions">
            {awaitsExternalSignature && <>
              <button className="secondary-button" type="button" disabled={saving} onClick={() => void onContractDownload("pdf")}><Download size={18} /> {saving ? "Generando…" : "Descargar PDF sin firmas"}</button>
              <button className="secondary-button" type="button" disabled={saving} onClick={() => void onContractDownload("docx")}><Download size={18} /> {saving ? "Generando…" : "Descargar Word sin firmas"}</button>
            </>}
            <label className={`secondary-button contract-upload-button ${saving ? "disabled" : ""}`}>
              <FileUp size={18} /> {saving ? "Archivando…" : awaitsExternalSignature ? "Adjuntar contrato devuelto" : "Adjuntar contrato firmado"}
              <input
                type="file"
                disabled={saving}
                accept=".pdf,application/pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void onContractUpload(file);
                }}
              />
            </label>
          </div>
        ) : !canAttachFinalContract ? (
          <div className="contract-panel-actions">
            <button className="secondary-button" type="button" disabled={saving} onClick={() => void onContractDownload("pdf")}><Download size={18} /> {saving ? "Generando…" : "Descargar borrador PDF"}</button>
            <button className="secondary-button" type="button" disabled={saving} onClick={() => void onContractDownload("docx")}><Download size={18} /> {saving ? "Generando…" : "Descargar borrador Word"}</button>
          </div>
        ) : null}
      </div>

      {purchase.contractDetails.previousContractArchiveId && (
        <div className="previous-contract-reference">
          <FileText size={20} />
          <span>
            <strong>Contrato anterior utilizado como referencia</strong>
            <small>{purchase.contractDetails.previousContractFilename || "Contrato anterior"}{purchase.contractDetails.previousContractPurchaseId ? ` · origen ${purchase.contractDetails.previousContractPurchaseId}` : " · subido manualmente"}</small>
          </span>
          <button className="text-button" type="button" disabled={saving} onClick={() => void onArchivedContractDownload(purchase.contractDetails.previousContractArchiveId)}><Download size={16} /> Descargar</button>
        </div>
      )}

      {contractHistory.length > 0 && (
        <details className="management-history">
          <summary><History size={17} /> Versiones anteriores del contrato <span>{contractHistory.length}</span></summary>
          <div className="history-list">
            {[...contractHistory].reverse().map((entry) => (
              <article key={`${entry.archiveId}-${entry.replacedAt}`}>
                <div><strong>{entry.archiveFilename || "Contrato anterior"}</strong><small>Sustituido por {entry.replacedBy || "Administrador"}{entry.replacedAt ? ` · ${formatDate(entry.replacedAt.slice(0, 10))}` : ""}<br />Motivo: {entry.reason || "No indicado"}</small></div>
                <button className="text-button" type="button" disabled={saving} onClick={() => void onArchivedContractDownload(entry.archiveId)}><Download size={16} /> Descargar</button>
              </article>
            ))}
          </div>
        </details>
      )}

      {!readOnly && (
        <RecordManagementPanel
          row={row}
          cancelled={cancelled}
          hasArchivedContract={hasArchivedContract}
          saving={saving}
          onStatusChange={onStatusChange}
          onContractReplace={onContractReplace}
          onDeleteRecord={onDeleteRecord}
        />
      )}

      <div className={`result-panel ${issues.length ? "result-blocked" : "result-ok"}`}>
        {issues.length ? <AlertTriangle size={23} /> : <CheckCircle2 size={23} />}
        <div>
          <span>{readOnly ? "Resultado documental actual" : "Resultado previsto al guardar"}</span>
          <strong>{issues.length ? "NO PUEDE RECOLECTARSE" : "SÍ PUEDE RECOLECTARSE"}</strong>
          {issues.length > 0 && <p>{issues.length} requisito{issues.length === 1 ? "" : "s"} pendiente{issues.length === 1 ? "" : "s"}</p>}
        </div>
      </div>

      {issues.length > 0 && (
        <details className="issues-panel">
          <summary>Ver motivos de bloqueo <span>{issues.length}</span></summary>
          <ul>{issues.map((issue) => <li key={issue}><XCircle size={16} /> {issue}</li>)}</ul>
        </details>
      )}

      <fieldset disabled={readOnly || cancelled}>
        <legend><span className="step-number">1</span><span>Planificación, finca y AICA<small>Comprobaciones posteriores a la firma y anteriores al corte</small></span></legend>
        <div className="three-columns">
          <label className="field required-field"><span>Fecha prevista de corte</span><input required type="date" value={review.plannedCutDate} min={purchase.contractStart || undefined} max={purchase.contractEnd || undefined} onInput={(event) => update("plannedCutDate", event.currentTarget.value)} /></label>
          <label className="field required-field"><span>Finca / parcela comprobada</span><select required value={review.farmChecked} onChange={(event) => update("farmChecked", event.target.value)}><option value="">Seleccionar</option><option>Sí</option><option>No</option></select></label>
          <label className="field required-field"><span>Situación en AICA</span><select required value={purchase.registeredIca || "Pendiente"} onChange={(event) => updatePurchase("registeredIca", event.target.value)}><option value="Pendiente">Pendiente de alta o validación</option><option value="Sí">Sí, registrado</option><option value="No">No registrado</option></select></label>
        </div>
      </fieldset>

      <fieldset disabled={readOnly || cancelled}>
        <legend><span className="step-number">2</span><span>Cuaderno de campo<small>Debe estar recibido y validado</small></span></legend>
        <div className="two-columns">
          <label className="field required-field"><span>Cuaderno de campo</span><select required value={review.fieldNotebook} onChange={(event) => update("fieldNotebook", event.target.value)}><option value="">Seleccionar</option><option>Sí</option><option>No</option></select></label>
          <label className="field required-field"><span>Fecha de revisión</span><input required type="date" value={review.notebookReviewDate} onInput={(event) => update("notebookReviewDate", event.currentTarget.value)} /></label>
        </div>
      </fieldset>

      <fieldset disabled={readOnly || cancelled}>
        <legend><span className="step-number">3</span><span>Análisis fitosanitario<small>Resultado revisado por Calidad</small></span></legend>
        <div className="two-columns">
          <label className="field required-field"><span>Estado del análisis</span><select required value={review.analysisStatus} onChange={(event) => update("analysisStatus", event.target.value)}><option value="">Seleccionar</option><option>No recibido</option><option>Pendiente de revisión</option><option>Apto</option><option>No apto</option></select></label>
          <label className="field required-field"><span>Fecha del análisis</span><input required type="date" value={review.analysisDate} onInput={(event) => update("analysisDate", event.currentTarget.value)} /></label>
        </div>
      </fieldset>

      <fieldset disabled={readOnly || cancelled}>
        <legend><span className="step-number">4</span><span>Certificación<small>Tipo y vigencia en la fecha de corte</small></span></legend>
        <div className="certification-checks" role="group" aria-label="Certificaciones de la finca">
          {CERTIFICATIONS.map((certificate) => {
            const selected = selectedCertifications.includes(certificate);
            return (
              <button
                key={certificate}
                className={`certification-check ${selected ? "checked" : ""}`}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleCertification(certificate)}
              >
                <Check size={16} />
                <span>{certificate}</span>
              </button>
            );
          })}
        </div>
        <div className="two-columns certification-validity">
          <label className="field required-field"><span>Caducidad más próxima</span><input required type="date" value={review.certificateExpiry} onInput={(event) => update("certificateExpiry", event.currentTarget.value)} /></label>
          <div className="field-help-card"><ShieldCheck size={18} /><span>Marca todas las certificaciones vigentes de la finca. La fecha más próxima es la que controla la autorización de corte.</span></div>
        </div>
      </fieldset>

      <fieldset disabled={readOnly || cancelled}>
        <legend><span className="step-number">5</span><span>Cierre de revisión<small>Otros documentos y responsable</small></span></legend>
        <div className="two-columns">
          <label className="field required-field"><span>Otros documentos exigidos</span><select required value={review.otherDocuments} onChange={(event) => update("otherDocuments", event.target.value)}><option value="">Seleccionar</option><option>Sí</option><option>No</option><option>Pendiente de revisión</option><option>No aplica</option></select></label>
          <label className="field required-field"><span>Responsable de revisión</span><input required value={review.reviewer} onChange={(event) => update("reviewer", event.target.value)} placeholder="Nombre y apellidos" /></label>
          <div className="automatic-review-date"><CalendarDays size={18} /><div><strong>Última fecha de revisión</strong><span>{readOnly && review.lastReviewDate ? formatDate(review.lastReviewDate) : "Se asignará automáticamente al guardar"}</span></div></div>
        </div>
      </fieldset>

      {purchase.otherAgreements && <div className="agreement-note"><FileCheck2 size={19} /><div><strong>Otros acuerdos</strong><p>{purchase.otherAgreements}</p></div></div>}

      {!readOnly && (
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={onReset} disabled={saving}><RotateCcw size={18} /> Deshacer cambios</button>
          <button className="primary-button" type="submit" disabled={saving || autoSaveStatus === "saving" || autoSaveStatus === "pending" || !navigator.onLine}><ShieldCheck size={19} /> {saving ? "Finalizando…" : "Finalizar revisión"}</button>
        </div>
      )}
    </form>
  );
}
