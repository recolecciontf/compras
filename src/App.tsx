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
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  CloudOff,
  Download,
  FileCheck2,
  ListChecks,
  LogIn,
  LogOut,
  Menu,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sprout,
  Wifi,
  X,
  XCircle,
} from "lucide-react";
import { DEMO_ROWS } from "./demo";
import { isConfigured, loadConfig } from "./lib/config";
import { reviewBlockages, reviewFromRow, WorkbookClient } from "./lib/workbook";
import type { AppConfig, AppView, ControlRow, RecordFilter, ReviewForm, UserProfile } from "./types";

function formatDate(value: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function authorized(row: ControlRow) {
  return row.canHarvest.trim().toLocaleUpperCase("es") === "SÍ";
}

function mergeReview(row: ControlRow, review: ReviewForm, isAuthorized: boolean, reasons: string[]): ControlRow {
  return {
    ...row,
    ...review,
    canHarvest: isAuthorized ? "SÍ" : "NO",
    blockageReason: isAuthorized ? "" : reasons.join("; "),
  };
}

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
  const reviewFingerprint = useRef("");
  const saveVersion = useRef(0);
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
    const nextReview = selected ? reviewFromRow(selected) : null;
    const nextFingerprint = nextReview ? JSON.stringify(nextReview) : "";
    if (selected && loadedRowIndex.current === selected.tableIndex && reviewFingerprint.current === nextFingerprint) return;
    loadedRowIndex.current = selected?.tableIndex ?? null;
    reviewFingerprint.current = nextFingerprint;
    setReview(nextReview);
    setAutoSaveStatus("idle");
  }, [selected]);

  useEffect(() => {
    if (!selected || !review || !signedIn || !isOnline || view !== "review" || !canEdit) return;
    const nextFingerprint = JSON.stringify(review);
    if (nextFingerprint === reviewFingerprint.current) return;

    if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
    const version = ++saveVersion.current;
    const rowSnapshot = selected;
    const reviewSnapshot = review;
    const issues = reviewBlockages(rowSnapshot, reviewSnapshot);
    setAutoSaveStatus("pending");

    autoSaveTimer.current = window.setTimeout(async () => {
      setAutoSaveStatus("saving");
      try {
        if (demoMode) {
          setRows((current) =>
            current.map((row) =>
              row.tableIndex === rowSnapshot.tableIndex
                ? mergeReview(row, reviewSnapshot, issues.length === 0, issues)
                : row,
            ),
          );
        } else {
          if (!client) throw new Error("No hay conexión con Google Sheets.");
          await client.saveReview(rowSnapshot, reviewSnapshot);
          if (version !== saveVersion.current) return;
          const nextRows = await client.rows();
          if (version !== saveVersion.current) return;
          setRows(nextRows);
        }
        if (version === saveVersion.current) {
          reviewFingerprint.current = JSON.stringify(reviewSnapshot);
          setLastSyncedAt(new Date());
          setAutoSaveStatus("saved");
        }
      } catch (reason) {
        if (version === saveVersion.current) {
          setAutoSaveStatus("error");
          setError(reason instanceof Error ? reason.message : "No se ha podido guardar el avance.");
        }
      }
    }, 850);

    return () => {
      if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
    };
  }, [review, selected, signedIn, isOnline, view, demoMode, client, canEdit]);

  useEffect(() => {
    if (!client || !signedIn || demoMode || !isOnline || view !== "records") return;
    const interval = window.setInterval(() => {
      void refresh(true);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [client, signedIn, demoMode, isOnline, view]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return rows.filter((row) => {
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
    const yes = rows.filter(authorized).length;
    return { total: rows.length, authorized: yes, blocked: rows.length - yes };
  }, [rows]);

  const predictedIssues = selected && review ? reviewBlockages(selected, review) : [];
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
    setView("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!selected || !review) return;
    if (!canEdit) {
      setError("Este usuario es de consulta y no puede modificar los datos.");
      return;
    }
    setSaving(true);
    saveVersion.current += 1;
    if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
    setError("");
    try {
      if (demoMode) {
        setRows((current) =>
          current.map((row) =>
            row.tableIndex === selected.tableIndex
              ? mergeReview(row, review, predictedAuthorized, predictedIssues)
              : row,
          ),
        );
      } else {
        if (!client) throw new Error("No hay conexión con Google Sheets.");
        await client.saveReview(selected, review);
        const nextRows = await client.rows();
        setRows(nextRows);
      }
      reviewFingerprint.current = JSON.stringify(review);
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
          <div className="brand-mark"><Sprout size={23} /></div>
          <div>
            <span className="eyebrow">Control previo</span>
            <strong>Compras de campo</strong>
          </div>
        </div>
        <div className="topbar-actions">
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
            <section className={`records-pane ${view === "review" ? "mobile-hidden" : ""}`}>
              <div className="welcome-row">
                <div>
                  <p className="welcome">Hola, {profile?.displayName?.split(" ")[0] || "equipo"}</p>
                  <h1>Control documental</h1>
                </div>
                <span className="sync-caption">
                  {loading ? "Sincronizando…" : lastSyncedAt ? `Actualizado ${lastSyncedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : `${counts.total} expedientes`}
                </span>
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
              </div>

              <div className="records-list">
                {loading && !rows.length ? (
                  <div className="list-loading"><div className="loading-ring" /><p>Consultando Google Sheets…</p></div>
                ) : visibleRows.length ? (
                  visibleRows.map((row) => (
                    <button
                      key={`${row.id}-${row.tableIndex}`}
                      className={`record-card ${selectedIndex === row.tableIndex ? "selected" : ""}`}
                      onClick={() => selectRow(row)}
                    >
                      <span className={`record-stripe ${authorized(row) ? "stripe-ok" : "stripe-blocked"}`} />
                      <span className="record-content">
                        <span className="record-heading">
                          <strong>{row.provider}</strong>
                          <StatusBadge ok={authorized(row)}>{authorized(row) ? "SÍ" : "NO"}</StatusBadge>
                        </span>
                        <span className="record-crop">{row.crop || "Cultivo sin indicar"}</span>
                        <span className="record-meta">
                          <span><Sprout size={15} /> {row.farm || "Finca sin indicar"}</span>
                          <span><CalendarDays size={15} /> {row.plannedCutDate ? formatDate(row.plannedCutDate) : "Corte pendiente"}</span>
                        </span>
                        {!authorized(row) && row.blockageReason && <span className="blockage-preview">{row.blockageReason}</span>}
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

            <section className={`review-pane ${view !== "review" ? "mobile-hidden" : ""}`}>
              {selected && review ? (
                <ReviewPanel
                  row={selected}
                  review={review}
                  issues={predictedIssues}
                  saving={saving}
                  autoSaveStatus={autoSaveStatus}
                  readOnly={!canEdit}
                  onChange={setReview}
                  onSubmit={submitReview}
                  onReset={() => setReview(reviewFromRow(selected))}
                  onBack={() => setView("records")}
                />
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
    <section className="connect-card">
      <div className="connect-icon"><ShieldCheck size={36} /></div>
      <span className="eyebrow">Acceso seguro</span>
      <h1>Compras de campo</h1>
      <p>Accede como ADMIN COMPRAS para modificar o como USUARIO COMPRAS para consultar el control documental.</p>
      <form className="login-form" onSubmit={(event) => { event.preventDefault(); void onConnect(username, password); }}>
        <label className="field required-field"><span>Usuario</span><input required autoCapitalize="characters" autoComplete="username" placeholder="ADMIN COMPRAS o USUARIO COMPRAS" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label className="field required-field"><span>Contraseña</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={loading || !username.trim() || !password}>
          <LogIn size={20} /> {loading ? "Comprobando…" : "Entrar"}
        </button>
      </form>
      <button className="secondary-button" onClick={onDemo}>Ver demostración</button>
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

function ReviewPanel({
  row,
  review,
  issues,
  saving,
  autoSaveStatus,
  readOnly,
  onChange,
  onSubmit,
  onReset,
  onBack,
}: {
  row: ControlRow;
  review: ReviewForm;
  issues: string[];
  saving: boolean;
  autoSaveStatus: "idle" | "pending" | "saving" | "saved" | "error";
  readOnly: boolean;
  onChange: Dispatch<SetStateAction<ReviewForm | null>>;
  onSubmit: (event: FormEvent) => void;
  onReset: () => void;
  onBack: () => void;
}) {
  function update<K extends keyof ReviewForm>(key: K, value: ReviewForm[K]) {
    onChange((current) => current ? { ...current, [key]: value } : current);
  }

  const completedFields = Object.values(review).filter((value) => value.trim() !== "").length;
  const requiredFields = Object.keys(review).length;

  return (
    <form className="review-form" onSubmit={onSubmit}>
      <div className="review-header">
        <button className="back-button mobile-back" type="button" onClick={onBack}><ArrowLeft size={20} /> Expedientes</button>
        <div className="review-title-row">
          <div>
            <span className="eyebrow">{row.id || "Expediente"}</span>
            <h2>{row.provider}</h2>
            <p>{row.crop || "Cultivo sin indicar"} · {row.farm || "Finca sin indicar"}</p>
          </div>
          <StatusBadge ok={authorized(row)}>{authorized(row) ? "Autorizado" : "Bloqueado"}</StatusBadge>
        </div>

        <div className="contract-strip">
          <span><CalendarDays size={17} /><strong>Contrato</strong></span>
          <span>{formatDate(row.contractStart)} — {formatDate(row.contractEnd)}</span>
          <span className={`contract-alert ${row.contractAlert.includes("VIGENTE") ? "contract-ok" : "contract-warning"}`}>{row.contractAlert || "Sin estado"}</span>
        </div>
      </div>

      {readOnly && <div className="readonly-note"><ShieldCheck size={18} /><span>Modo consulta: puedes revisar todos los datos, pero no modificarlos.</span></div>}

      <div className="autosave-row" role="status">
        <span className={`autosave-state autosave-${autoSaveStatus}`}>
          {autoSaveStatus === "saving" && <RefreshCw className="spinning" size={16} />}
          {autoSaveStatus === "pending" && <RefreshCw size={16} />}
          {autoSaveStatus === "saved" && <CheckCircle2 size={16} />}
          {autoSaveStatus === "error" && <AlertTriangle size={16} />}
          {autoSaveStatus === "idle" && <FileCheck2 size={16} />}
          {readOnly ? "Datos en modo consulta" : autoSaveStatus === "saving" ? "Guardando en Google Sheets…" : autoSaveStatus === "pending" ? "Cambio pendiente de guardar" : autoSaveStatus === "saved" ? "Guardado automáticamente" : autoSaveStatus === "error" ? "Error al guardar" : "Los cambios se guardan automáticamente"}
        </span>
        <span className="completion-count">Obligatorios: {completedFields}/{requiredFields}</span>
      </div>

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

      <fieldset disabled={readOnly}>
        <legend><span className="step-number">1</span><span>Planificación y finca<small>Fecha prevista y comprobación física</small></span></legend>
        <div className="two-columns">
          <label className="field required-field"><span>Fecha prevista de corte</span><input required type="date" value={review.plannedCutDate} min={row.contractStart || undefined} max={row.contractEnd || undefined} onInput={(event) => update("plannedCutDate", event.currentTarget.value)} /></label>
          <label className="field required-field"><span>Finca / parcela comprobada</span><select required value={review.farmChecked} onChange={(event) => update("farmChecked", event.target.value)}><option value="">Seleccionar</option><option>Sí</option><option>No</option></select></label>
        </div>
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend><span className="step-number">2</span><span>Cuaderno de campo<small>Debe estar recibido y validado</small></span></legend>
        <div className="two-columns">
          <label className="field required-field"><span>Cuaderno de campo</span><select required value={review.fieldNotebook} onChange={(event) => update("fieldNotebook", event.target.value)}><option value="">Seleccionar</option><option>Sí</option><option>No</option></select></label>
          <label className="field required-field"><span>Fecha de revisión</span><input required type="date" value={review.notebookReviewDate} onInput={(event) => update("notebookReviewDate", event.currentTarget.value)} /></label>
        </div>
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend><span className="step-number">3</span><span>Análisis fitosanitario<small>Resultado revisado por Calidad</small></span></legend>
        <div className="two-columns">
          <label className="field required-field"><span>Estado del análisis</span><select required value={review.analysisStatus} onChange={(event) => update("analysisStatus", event.target.value)}><option value="">Seleccionar</option><option>No recibido</option><option>Pendiente de revisión</option><option>Apto</option><option>No apto</option></select></label>
          <label className="field required-field"><span>Fecha del análisis</span><input required type="date" value={review.analysisDate} onInput={(event) => update("analysisDate", event.currentTarget.value)} /></label>
        </div>
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend><span className="step-number">4</span><span>Certificación<small>Tipo y vigencia en la fecha de corte</small></span></legend>
        <div className="two-columns">
          <label className="field required-field"><span>Tipo de certificado</span><input required list="certificate-types" value={review.certificateType} onChange={(event) => update("certificateType", event.target.value)} placeholder="ECO, Naturland, Demeter…" /><datalist id="certificate-types"><option value="ECO" /><option value="Naturland" /><option value="Demeter" /><option value="GlobalG.A.P." /><option value="GRASP" /><option value="Bio Suisse" /><option value="Pendiente de revisión" /><option value="No localizado" /></datalist></label>
          <label className="field required-field"><span>Caducidad del certificado</span><input required type="date" value={review.certificateExpiry} onInput={(event) => update("certificateExpiry", event.currentTarget.value)} /></label>
        </div>
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend><span className="step-number">5</span><span>Cierre de revisión<small>Otros documentos y responsable</small></span></legend>
        <div className="two-columns">
          <label className="field required-field"><span>Otros documentos exigidos</span><select required value={review.otherDocuments} onChange={(event) => update("otherDocuments", event.target.value)}><option value="">Seleccionar</option><option>Sí</option><option>No</option><option>Pendiente de revisión</option><option>No aplica</option></select></label>
          <label className="field required-field"><span>Responsable de revisión</span><input required value={review.reviewer} onChange={(event) => update("reviewer", event.target.value)} placeholder="Nombre y apellidos" /></label>
          <label className="field required-field"><span>Fecha de última revisión</span><input required type="date" value={review.lastReviewDate} onInput={(event) => update("lastReviewDate", event.currentTarget.value)} /></label>
        </div>
      </fieldset>

      {row.otherAgreements && <div className="agreement-note"><FileCheck2 size={19} /><div><strong>Otros acuerdos</strong><p>{row.otherAgreements}</p></div></div>}

      {!readOnly && (
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={onReset} disabled={saving}><RotateCcw size={18} /> Deshacer cambios</button>
          <button className="primary-button" type="submit" disabled={saving || autoSaveStatus === "saving" || !navigator.onLine}><ShieldCheck size={19} /> {saving ? "Finalizando…" : "Finalizar revisión"}</button>
        </div>
      )}
    </form>
  );
}
