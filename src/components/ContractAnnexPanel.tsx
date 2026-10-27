import { useEffect, useState } from "react";
import { Download, FilePlus2, FileUp, RefreshCw } from "lucide-react";
import type { ControlRow, PurchaseForm } from "../types";
import type { WorkbookClient } from "../lib/workbook";
import { annexTemplateName, generateContractAnnex, convertAnnexToPdf } from "../lib/contractAnnex";
import { ANNEX_LABELS, validateAnnexFields, type AnnexFields, type ContractAnnex } from "../lib/contractAnnexData";
import { triggerDownload } from "../lib/contractGenerator";

function initialFields(purchase: PurchaseForm): AnnexFields {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return {
    kind: "price", place: "Librilla (Murcia)", date, originalDate: purchase.contractDetails.signatureDate || "", aicaReference: "",
    product: purchase.materials.map(item => [item.expectedKg ? `${item.expectedKg} kg` : "", item.crop, item.variety].filter(Boolean).join(" ")).join("; ") || [purchase.crop, purchase.variety].filter(Boolean).join(" "),
    priceMode: "fixed", price: "", unit: "kg", vat: "excluded", priceFormula: "", removedVariety: "", remainingVarietiesConfirmed: false,
  };
}

export function ContractAnnexPanel({ row, purchase, client, disabled, readOnly, demo }: {
  row: ControlRow; purchase: PurchaseForm; client: WorkbookClient | null; disabled: boolean; readOnly: boolean; demo: boolean;
}) {
  const [annexes, setAnnexes] = useState<ContractAnnex[]>([]);
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(() => initialFields(purchase));
  const [id, setId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    if (readOnly || demo || !client) return;
    setLoading(true);
    void client.contractAnnexes(row).then(result => { if (active) setAnnexes(result); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "No se han podido cargar los anexos."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, row.id, row.tableIndex, readOnly, demo]);

  function update<K extends keyof AnnexFields>(key: K, value: AnnexFields[K]) {
    setFields(current => ({ ...current, [key]: value }));
    setConfirmed(false); setNotice("");
  }
  async function refresh() {
    if (!client || demo) return;
    setLoading(true); setError("");
    try { setAnnexes(await client.contractAnnexes(row)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se han podido cargar los anexos."); }
    finally { setLoading(false); }
  }
  async function generate(format: "docx" | "pdf") {
    setError(""); setNotice("");
    if (demo || !client) { setError("La demostración no archiva documentos. Entra con tu usuario para crear el anexo."); return; }
    if (!navigator.onLine) { setError("Necesitas conexión para guardar el anexo en el archivo central. Los datos introducidos se mantienen mientras no salgas de este expediente."); return; }
    if (!confirmed) { setError("Confirma que has revisado los datos antes de generar el anexo."); return; }
    setBusy(true);
    try {
      const checked = validateAnnexFields(fields);
      const template = await client.contractTemplate(annexTemplateName(purchase.contractDetails.buyerCompany, checked));
      const generated = await generateContractAnnex(template, purchase, checked, "docx");
      const download = format === "pdf" ? await convertAnnexToPdf(generated.blob) : generated.blob;
      const saved = await client.saveContractAnnex(row, id, checked, generated.blob, generated.filename);
      setAnnexes(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      setNotice("Anexo guardado en el archivo central. El contrato original no ha cambiado. Está pendiente de firma e inscripción de la modificación en AICA.");
      triggerDownload(download, generated.filename.replace(/\.docx$/, `.${format}`));
      setOpen(false); setConfirmed(false); setId(crypto.randomUUID());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se ha podido generar y guardar el anexo.");
    } finally { setBusy(false); }
  }
  async function download(annex: ContractAnnex, format: "docx" | "pdf", signedArchiveId?: string) {
    if (!client) return;
    setBusy(true); setError("");
    try {
      const file = await client.archivedContract(signedArchiveId || annex.draft.archiveId);
      const blob = format === "pdf" && !signedArchiveId ? await convertAnnexToPdf(file.blob) : file.blob;
      triggerDownload(blob, file.filename.replace(/\.docx$/i, `.${format}`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se ha podido descargar el anexo."); }
    finally { setBusy(false); }
  }
  async function attachSigned(annex: ContractAnnex, file: File) {
    if (!client || demo) return;
    if (!/\.pdf$/i.test(file.name) || file.size > 10 * 1024 * 1024) { setError("Adjunta un PDF de hasta 10 MB."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await client.saveContractAnnex(row, annex.id, annex.fields, file, file.name, true);
      setAnnexes(current => current.map(item => item.id === saved.id ? saved : item));
      setNotice("Copia firmada del anexo guardada. No se ha sustituido el contrato original ni se ha marcado el anexo como inscrito en AICA.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se ha podido adjuntar el anexo firmado."); }
    finally { setBusy(false); }
  }

  return <section className="annex-panel" aria-label="Anexos del contrato">
    <div className="annex-heading"><div><h3>Anexos del contrato</h3><p>Cambio de precio o anulación de una variedad, sin sustituir el contrato original.</p></div>
      {!readOnly && <button type="button" className="secondary-button" disabled={disabled || busy} onClick={() => { setOpen(!open); setFields(initialFields(purchase)); setConfirmed(false); setError(""); setId(crypto.randomUUID()); }}><FilePlus2 size={18} /> {open ? "Cerrar" : "Crear anexo"}</button>}
    </div>
    {readOnly ? <p>Documentación contractual confidencial. Acceso restringido a usuarios autorizados.</p> : <>
      {disabled && <p className="annex-hint">Guarda los cambios de la compra antes de crear o adjuntar un anexo. Los expedientes anulados no admiten nuevos anexos.</p>}
      {error && <div role="alert" className="annex-error">{error}</div>}
      {notice && <div role="status" className="annex-notice">{notice}</div>}
      {open && <fieldset className="annex-fields" disabled={busy || disabled}>
        <legend>Datos del anexo</legend>
        <p><strong>{purchase.contractDetails.buyerCompany || "Empresa pendiente"}</strong> · Contrato {purchase.contractDetails.contractNumber || row.id} · {purchase.provider}</p>
        <div className="annex-grid">
          <label>Tipo de anexo<select value={fields.kind} onChange={e => update("kind", e.target.value as AnnexFields["kind"])}><option value="price">Cambio de precio</option><option value="partial_cancellation">Anulación parcial</option></select></label>
          <label>Lugar<input value={fields.place} maxLength={180} onChange={e => update("place", e.target.value)} /></label>
          <label>Fecha del anexo<input type="date" value={fields.date} onChange={e => update("date", e.target.value)} /></label>
          <label>Fecha del contrato original<input type="date" value={fields.originalDate} onChange={e => update("originalDate", e.target.value)} /></label>
          <label className="annex-wide">Número de inscripción del contrato original en AICA<input value={fields.aicaReference} maxLength={180} placeholder="Número real del RCA, no la referencia MR/TN" onChange={e => update("aicaReference", e.target.value)} /></label>
          <label className="annex-wide">{fields.kind === "price" ? "Producto al que se aplica el precio" : "Productos y kilos del contrato original"}<textarea rows={3} value={fields.product} maxLength={500} onChange={e => update("product", e.target.value)} /></label>
          {fields.kind === "price" ? <>
            <label>Modalidad de precio<select value={fields.priceMode} onChange={e => update("priceMode", e.target.value as AnnexFields["priceMode"])}><option value="fixed">Precio fijo</option><option value="variable">Precio variable con fórmula objetiva</option></select></label>
            {fields.priceMode === "fixed" ? <>
              <label>Nuevo precio en euros<input inputMode="decimal" value={fields.price} placeholder="Ej.: 0,45" onChange={e => update("price", e.target.value)} /></label>
              <label>Unidad de medida<input value={fields.unit} maxLength={80} onChange={e => update("unit", e.target.value)} /></label>
              <label>IVA<select value={fields.vat} onChange={e => update("vat", e.target.value as AnnexFields["vat"])}><option value="excluded">No incluido</option><option value="included">Incluido</option></select></label>
            </> : <label className="annex-wide">Fórmula de precio variable<textarea rows={4} maxLength={1800} value={fields.priceFormula} onChange={e => update("priceFormula", e.target.value)} placeholder="Factores objetivos y forma de cálculo acordados entre las partes" /></label>}
          </> : <>
            <label className="annex-wide">Variedad que se elimina íntegramente del contrato<input value={fields.removedVariety} maxLength={300} onChange={e => update("removedVariety", e.target.value)} /></label>
            <p className="annex-wide annex-hint">Este modelo elimina una variedad completa; no sirve para reducir solo una parte de sus kilos ni para anular todo el contrato.</p>
            <label className="annex-wide annex-check"><input type="checkbox" checked={fields.remainingVarietiesConfirmed} onChange={e => update("remainingVarietiesConfirmed", e.target.checked)} /> Confirmo que quedan otras variedades vigentes en el contrato original.</label>
          </>}
        </div>
        <label className="annex-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> He revisado los datos, el contrato original y el alcance de la modificación. Las cláusulas del modelo se mantienen.</label>
        <div className="contract-panel-actions"><button type="button" className="primary-button" onClick={() => void generate("docx")} disabled={!confirmed}>Guardar y descargar Word</button><button type="button" className="secondary-button" onClick={() => void generate("pdf")} disabled={!confirmed}>Guardar y descargar PDF</button></div>
        <p className="annex-hint">Se genera sin firmas. Adjunta después el PDF firmado. La app no registra automáticamente la modificación en AICA ni cambia los kilos o el precio de la compra.</p>
      </fieldset>}
      <div className="annex-list">
        {loading ? <p>Cargando anexos…</p> : annexes.length === 0 ? (!error && <p>No hay anexos archivados.</p>) : annexes.map(annex => <article key={annex.id}>
          <strong>{ANNEX_LABELS[annex.fields.kind]} · {new Date(`${annex.fields.date}T12:00:00`).toLocaleDateString("es-ES")}</strong>
          <small>Creado por {annex.createdBy} · {new Date(annex.createdAt).toLocaleString("es-ES")} · {annex.signedCopies.length ? "Copia firmada adjuntada" : "Pendiente de firma"}</small>
          <p>{annex.fields.kind === "price" ? `${annex.fields.product} · ${annex.fields.priceMode === "fixed" ? `${annex.fields.price} €/${annex.fields.unit}` : "Precio variable"}` : `Variedad eliminada: ${annex.fields.removedVariety}`}</p>
          <div className="contract-panel-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void download(annex, "docx")}><Download size={16} /> Word</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void download(annex, "pdf")}><Download size={16} /> PDF</button>
            <label className="secondary-button contract-upload-button"><FileUp size={16} /> Adjuntar firmado<input type="file" accept=".pdf,application/pdf" disabled={busy || disabled} onChange={e => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (file) void attachSigned(annex, file); }} /></label>
          </div>
          {annex.signedCopies.map(copy => <div className="annex-signed" key={copy.archiveId}><small>{copy.archiveFilename} · {copy.attachedBy} · {new Date(copy.archivedAt).toLocaleString("es-ES")}</small><button type="button" className="text-button" disabled={busy} onClick={() => void download(annex, "pdf", copy.archiveId)}>Descargar firmado</button></div>)}
          {annex.draft.driveBackupStatus !== "stored" && <small>Guardado central confirmado. Copia adicional externa: {annex.draft.driveBackupStatus === "failed" ? "no realizada" : "sin configurar"}.</small>}
        </article>)}
      </div>
      {!demo && <button type="button" className="text-button" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={15} /> Actualizar anexos</button>}
      {busy && <p role="status">Procesando el anexo…</p>}
    </>}
  </section>;
}
