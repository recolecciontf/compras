import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Download, FilePlus2, FileUp, PenLine, RefreshCw } from "lucide-react";
import type { WorkbookClient } from "../lib/workbook";
import { importPurchaseFromContract, type ContractImportProgress } from "../lib/contractImport";
import { EMPTY_EXTERNAL_CONTRACT, externalContractPurchase, externalDataFromPurchase, validateExternalContractData, type ExternalContract, type ExternalContractData } from "../lib/externalContract";
import { triggerDownload } from "../lib/contractGenerator";
import { EMPTY_PURCHASE } from "./PurchaseFields";
import { ContractAnnexPanel } from "./ContractAnnexPanel";
import { SavedContractPicker } from "./SavedContractPicker";

export function ExternalContractAnnexPanel({ client, demo, onBack }: { client: WorkbookClient | null; demo: boolean; onBack: () => void }) {
  const [records, setRecords] = useState<ExternalContract[]>([]);
  const [selected, setSelected] = useState<ExternalContract | null>(null);
  const [mode, setMode] = useState<"" | "import" | "manual">("");
  const [data, setData] = useState<ExternalContractData>(() => structuredClone(EMPTY_EXTERNAL_CONTRACT));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ContractImportProgress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    if (!client || demo) return;
    setLoading(true);
    void client.externalContracts().then(result => { if (active) setRecords(result); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "No se han podido cargar los contratos externos."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, demo]);

  function update<K extends keyof ExternalContractData>(key: K, value: ExternalContractData[K]) {
    setData(current => ({ ...current, [key]: value }));
  }
  function startNew() {
    setSelected(null); setMode(""); setData(structuredClone(EMPTY_EXTERNAL_CONTRACT)); setFile(null);
    setError(""); setNotice(""); setWarnings([]);
  }
  async function refresh() {
    if (!client || demo) return;
    setLoading(true); setError("");
    try { setRecords(await client.externalContracts()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se han podido actualizar los contratos."); }
    finally { setLoading(false); }
  }
  async function readContract(source: File) {
    setError(""); setNotice(""); setWarnings([]); setFile(source);
    if (!data.buyerCompany) { setError("Selecciona primero la empresa compradora."); return; }
    setBusy(true);
    try {
      const base = structuredClone(EMPTY_PURCHASE);
      base.campaign = ""; base.contractDetails.signatureDate = "";
      const report = await importPurchaseFromContract(source, data.buyerCompany, base, setProgress);
      setData(externalDataFromPurchase(report.purchase));
      setWarnings(report.warnings.filter(warning => /agricultor|NIF|domicilio|DNI|empresa|OCR/i.test(warning)));
      setNotice("Datos recuperados. Revisa la referencia y la fecha del contrato original antes de continuar.");
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "No se ha podido leer el contrato."} Puedes completar los datos a mano y conservar el archivo adjunto.`);
    } finally { setBusy(false); setProgress(null); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (demo || !client) { setError("La demostración no guarda contratos. Entra con tu usuario para guardar y crear el anexo."); return; }
    if (!navigator.onLine) { setError("Necesitas conexión para guardar el contrato y su anexo. Los datos permanecen en este formulario mientras no salgas."); return; }
    setBusy(true);
    try {
      const record = await client.saveExternalContract(validateExternalContractData(data), file);
      setRecords(current => [record, ...current.filter(item => item.id !== record.id)]);
      setSelected(record); setMode(""); setFile(null); setWarnings([]);
      setNotice("Contrato original guardado para futuros anexos. No se ha creado ninguna compra ni cambiado la numeración MR/TN.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se ha podido guardar el contrato."); }
    finally { setBusy(false); }
  }
  async function downloadSource() {
    if (!client || !selected?.source) return;
    setBusy(true); setError("");
    try { const document = await client.archivedContract(selected.source.archiveId); triggerDownload(document.blob, document.filename); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se ha podido descargar el contrato original."); }
    finally { setBusy(false); }
  }

  return <section className="external-annex-page">
    <div className="review-header">
      <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={18} /> Expedientes</button>
      <div className="page-kicker"><FilePlus2 size={18} /> Anexos</div>
      <h1 className="page-title">Contratos externos</h1>
      <p className="page-subtitle">Crea un anexo de un contrato hecho fuera de la app, sin registrar una compra completa.</p>
      <p className="annex-hint">Para una compra que ya está en la app, abre su expediente y pulsa «Crear anexo».</p>
    </div>
    {error && <div role="alert" className="annex-error">{error}</div>}
    {notice && <div role="status" className="annex-notice">{notice}</div>}
    <section className="annex-panel">
      <div className="annex-heading"><h2>Contratos guardados</h2><button type="button" className="text-button" onClick={() => void refresh()} disabled={loading || busy || demo}><RefreshCw size={16} /> Actualizar</button></div>
      <div className="annex-grid">
        <div className="annex-wide"><SavedContractPicker label="Contrato externo" disabled={busy || loading}
          value={selected?.id || ""} onChange={value => { const record = records.find(item => item.id === value); setSelected(record || null); setError(""); setNotice(""); }}
          placeholder={loading ? "Cargando contratos…" : "Seleccionar un contrato guardado"} searchPlaceholder="Agricultor, referencia o producto"
          options={records.map(record => ({ value: record.id,
            label: `${record.data.contractNumber} · ${record.data.provider} · ${record.data.buyerCompany}`,
            searchText: [record.data.taxId, record.data.campaign, record.data.originalDate, record.data.product, record.source?.archiveFilename || ""].join(" "),
          }))} /></div>
      </div>
      <p className="annex-hint">Los datos y anexos guardados están disponibles en los demás dispositivos autorizados.</p>
    </section>
    {selected ? <>
      <section className="annex-panel">
        <div className="annex-heading"><div><h2>{selected.data.contractNumber} · {selected.data.provider}</h2><p>{selected.data.buyerCompany} · Campaña {selected.data.campaign} · Fecha original {new Date(`${selected.data.originalDate}T12:00:00`).toLocaleDateString("es-ES")}</p></div><button type="button" className="secondary-button" onClick={startNew} disabled={busy}>Otro contrato externo</button></div>
        <details><summary>Ver datos del contrato original</summary><p>{selected.data.taxId} · {selected.data.sellerAddress}</p><p>{selected.data.product}</p>{selected.data.sellerRepresentative && <p>{selected.data.sellerTreatment} {selected.data.sellerRepresentative} · DNI {selected.data.sellerDni}</p>}</details>
        {selected.source ? <button type="button" className="secondary-button" onClick={() => void downloadSource()} disabled={busy}><Download size={16} /> Descargar contrato original</button> : <p className="annex-hint">Datos introducidos manualmente; no se adjuntó el contrato original.</p>}
      </section>
      <ContractAnnexPanel key={selected.id} externalContract={selected} purchase={externalContractPurchase(selected, EMPTY_PURCHASE)} client={client} demo={demo} disabled={busy} readOnly={false} autoOpen />
    </> : <section className="annex-panel">
      <h2>Crear anexo de otro contrato</h2>
      <div className="external-annex-choices" role="group" aria-label="Origen del contrato externo">
        <button type="button" className={`secondary-button ${mode === "import" ? "selected" : ""}`} onClick={() => setMode("import")} disabled={busy}><FileUp size={20} /><span><strong>Importar contrato</strong><small>Leer un PDF o Word y recuperar sus datos</small></span></button>
        <button type="button" className={`secondary-button ${mode === "manual" ? "selected" : ""}`} onClick={() => setMode("manual")} disabled={busy}><PenLine size={20} /><span><strong>Introducir datos</strong><small>Solo lo necesario para el anexo</small></span></button>
      </div>
      {mode && <form onSubmit={event => void save(event)}>
        <fieldset className="annex-fields" disabled={busy}>
          <legend>Contrato original</legend>
          <div className="annex-grid">
            <label className="annex-wide">Empresa compradora *<select required value={data.buyerCompany} onChange={event => update("buyerCompany", event.target.value as ExternalContractData["buyerCompany"])}><option value="">Seleccionar empresa</option><option>MR. ORGÁNICA, S.L.</option><option>TOÑIFRUIT, S.L.</option></select></label>
            {mode === "import" && <div className="annex-wide"><label className="secondary-button contract-upload-button"><FileUp size={18} /> Seleccionar contrato PDF o Word<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={!data.buyerCompany || busy} onChange={event => { const source = event.target.files?.[0]; event.currentTarget.value = ""; if (source) void readContract(source); }} /></label><p className="annex-hint">Máximo 10 MB. Selecciona la empresa antes de subirlo. Revisa siempre los datos recuperados.</p></div>}
            {file && <p className="annex-wide annex-hint">Original adjunto: {file.name}</p>}
            <label>Referencia del contrato original *<input required maxLength={80} value={data.contractNumber} onChange={event => update("contractNumber", event.target.value)} placeholder="La que figura en el contrato, no una referencia nueva" /></label>
            <label>Fecha del contrato original *<input required type="date" value={data.originalDate} onChange={event => update("originalDate", event.target.value)} /></label>
            <label>Campaña *<input required maxLength={180} value={data.campaign} onChange={event => update("campaign", event.target.value)} /></label>
            <label>Agricultor / razón social *<input required maxLength={180} value={data.provider} onChange={event => update("provider", event.target.value)} /></label>
            <label>NIF / CIF del vendedor *<input required maxLength={180} value={data.taxId} onChange={event => update("taxId", event.target.value)} /></label>
            <label className="annex-wide">Domicilio del vendedor *<input required maxLength={500} value={data.sellerAddress} onChange={event => update("sellerAddress", event.target.value)} /></label>
            <label className="annex-wide">Producto / variedades y kilos del contrato *<textarea required rows={3} maxLength={500} value={data.product} onChange={event => update("product", event.target.value)} placeholder="Describe únicamente lo que figura en el contrato original" /></label>
            <label>Tratamiento del representante<select value={data.sellerTreatment} onChange={event => update("sellerTreatment", event.target.value as ExternalContractData["sellerTreatment"])}><option value="">Sin indicar</option><option>D.</option><option>Dña.</option></select></label>
            <label>Representante del vendedor (si lo hay)<input maxLength={180} value={data.sellerRepresentative} onChange={event => update("sellerRepresentative", event.target.value)} /></label>
            <label>DNI del representante{data.sellerRepresentative ? " *" : ""}<input required={Boolean(data.sellerRepresentative)} maxLength={180} value={data.sellerDni} onChange={event => update("sellerDni", event.target.value)} /></label>
            <label>Domicilio del representante (opcional)<input maxLength={500} value={data.sellerRepresentativeAddress} onChange={event => update("sellerRepresentativeAddress", event.target.value)} /></label>
          </div>
          {warnings.length > 0 && <ul className="annex-hint">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          <button type="submit" className="primary-button"><FilePlus2 size={18} /> Guardar datos y crear anexo</button>
          <p className="annex-hint">Después solo indicarás el cambio de precio o la variedad a anular y el número real de inscripción en AICA. El contrato original no se modifica.</p>
        </fieldset>
      </form>}
      {progress && <p role="status">{progress.message}</p>}
    </section>}
  </section>;
}
