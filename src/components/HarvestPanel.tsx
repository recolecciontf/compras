import { Archive, ArchiveRestore, ArrowLeft, CheckCircle2, PackageCheck, Save, Scale, ShieldCheck, Wheat } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { certificationSelection } from "../lib/catalog";
import { harvestFromRow, isRecordCancelled } from "../lib/workbook";
import type { ControlRow, HarvestForm } from "../types";

type CutFilter = "pending" | "cut" | "archived";

type Props = {
  rows: ControlRow[];
  readOnly: boolean;
  saving: boolean;
  onSave: (row: ControlRow, harvest: HarvestForm) => Promise<void>;
  onBack: () => void;
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

function isCut(row: ControlRow) {
  return normalized(row.cutStatus) === "sí";
}

function isArchived(row: ControlRow) {
  return normalized(row.archived) === "sí";
}

function kg(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatKg(value: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);
}

export function HarvestPanel({ rows, readOnly, saving, onSave, onBack }: Props) {
  const [filter, setFilter] = useState<CutFilter>("pending");
  const [certificationFilter, setCertificationFilter] = useState("all");
  const [editing, setEditing] = useState<ControlRow | null>(null);
  const [draft, setDraft] = useState<HarvestForm>({ cutStatus: "No", cutKgTotal: "", archived: "No" });

  const summary = useMemo(() => {
    const harvestRows = rows.filter((row) => !isRecordCancelled(row));
    const active = harvestRows.filter((row) => !isArchived(row));
    const cut = active.filter(isCut);
    return {
      pending: active.length - cut.length,
      cut: cut.length,
      archived: harvestRows.filter(isArchived).length,
      totalKg: cut.reduce((total, row) => total + kg(row.cutKgTotal), 0),
    };
  }, [rows]);

  const certificationOptions = useMemo(() => [...new Set(rows.flatMap((row) => certificationSelection(row.certificateType)))]
    .sort((left, right) => left.localeCompare(right, "es")), [rows]);

  const visible = useMemo(() => rows.filter((row) => {
    if (isRecordCancelled(row)) return false;
    if (certificationFilter !== "all" && !certificationSelection(row.certificateType).includes(certificationFilter)) return false;
    if (filter === "archived") return isArchived(row);
    if (isArchived(row)) return false;
    return filter === "cut" ? isCut(row) : !isCut(row);
  }), [certificationFilter, filter, rows]);

  const cutGroups = useMemo(() => {
    const groups = new Map<string, { crop: string; variety: string; rows: ControlRow[]; totalKg: number }>();
    for (const row of visible) {
      const crop = row.crop || "Especie pendiente";
      const variety = row.variety || "Variedad pendiente";
      const key = `${normalized(crop)}|${normalized(variety)}`;
      const current = groups.get(key) ?? { crop, variety, rows: [], totalKg: 0 };
      current.rows.push(row);
      current.totalKg += kg(row.cutKgTotal);
      groups.set(key, current);
    }
    return [...groups.values()].sort((left, right) => (
      left.crop.localeCompare(right.crop, "es") || left.variety.localeCompare(right.variety, "es")
    ));
  }, [visible]);

  function edit(row: ControlRow) {
    setEditing(row);
    setDraft(harvestFromRow(row));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    await onSave(editing, draft);
    setEditing(null);
  }

  async function changeArchive(row: ControlRow, archived: boolean) {
    await onSave(row, { ...harvestFromRow(row), archived: archived ? "Sí" : "No" });
  }

  function renderHarvestCard(row: ControlRow) {
    const certifications = certificationSelection(row.certificateType);
    return (
      <article className="harvest-card" key={`${row.id}-${row.tableIndex}`}>
        <div className="harvest-card-main">
          <span className={`cut-dot ${isCut(row) ? "done" : "pending"}`} />
          <div>
            <strong>{row.provider}</strong>
            {certifications.length > 0 && (
              <span className="certification-tags harvest-certifications" aria-label="Certificaciones">
                {certifications.map((certification) => <small key={certification}><ShieldCheck size={12} /> {certification}</small>)}
              </span>
            )}
            <span>{row.crop || "Especie pendiente"}{row.variety ? ` · ${row.variety}` : ""}</span>
            <small>{row.farm || "Finca sin indicar"} · Previstos: {row.expectedKg ? `${formatKg(kg(row.expectedKg))} kg` : "sin indicar"}</small>
          </div>
        </div>
        <div className="harvest-card-status"><span>{isCut(row) ? "Cortado" : "Pendiente"}</span><strong>{isCut(row) ? `${formatKg(kg(row.cutKgTotal))} kg` : "—"}</strong></div>
        <div className="harvest-card-actions">
          <button className="secondary-button" type="button" onClick={() => edit(row)}>{readOnly ? "Consultar" : "Actualizar corte"}</button>
          {!readOnly && isArchived(row) && <button className="text-button" type="button" disabled={saving} onClick={() => changeArchive(row, false)}><ArchiveRestore size={17} /> Restaurar</button>}
          {!readOnly && !isArchived(row) && isCut(row) && kg(row.cutKgTotal) > 0 && <button className="text-button archive-button" type="button" disabled={saving} onClick={() => changeArchive(row, true)}><Archive size={17} /> Archivar</button>}
        </div>
      </article>
    );
  }

  return (
    <div className="review-form harvest-page">
      <div className="review-header">
        <button className="back-button mobile-back" type="button" onClick={onBack}><ArrowLeft size={20} /> Compras</button>
        <div className="page-kicker"><Wheat size={18} /> Seguimiento de campo</div>
        <h2 className="page-title">Cortes y kilos</h2>
        <p className="page-subtitle">Controla la recolección real y aparta del trabajo diario las compras ya terminadas.</p>
      </div>

      <div className="harvest-summary">
        <article><PackageCheck size={20} /><span>Pendientes</span><strong>{summary.pending}</strong></article>
        <article><CheckCircle2 size={20} /><span>Cortadas</span><strong>{summary.cut}</strong></article>
        <article><Scale size={20} /><span>Kg cortados</span><strong>{formatKg(summary.totalKg)}</strong></article>
      </div>

      <div className="filter-tabs harvest-tabs" role="group" aria-label="Estado de los cortes">
        <button className={filter === "pending" ? "active" : ""} onClick={() => { setFilter("pending"); setEditing(null); }}>Pendientes · {summary.pending}</button>
        <button className={filter === "cut" ? "active" : ""} onClick={() => { setFilter("cut"); setEditing(null); }}>Cortadas · {summary.cut}</button>
        <button className={filter === "archived" ? "active" : ""} onClick={() => { setFilter("archived"); setEditing(null); }}>Archivadas · {summary.archived}</button>
      </div>

      <label className="harvest-certification-filter">
        <span>Filtrar por certificación</span>
        <select value={certificationFilter} onChange={(event) => setCertificationFilter(event.target.value)}>
          <option value="all">Todas las certificaciones</option>
          {certificationOptions.map((certification) => <option key={certification}>{certification}</option>)}
        </select>
      </label>

      {editing && (
        <form className="harvest-editor" onSubmit={submit}>
          <div className="harvest-editor-title"><div><span>Editando corte</span><strong>{editing.provider}</strong><small>{editing.crop}{editing.variety ? ` · ${editing.variety}` : ""}</small></div><button type="button" onClick={() => setEditing(null)} aria-label="Cerrar edición">×</button></div>
          <div className="two-columns">
            <label className="field required-field"><span>¿Se ha cortado?</span><select required disabled={readOnly || saving} value={draft.cutStatus} onChange={(event) => setDraft({ ...draft, cutStatus: event.target.value, cutKgTotal: event.target.value === "Sí" ? draft.cutKgTotal : "", archived: event.target.value === "Sí" ? draft.archived : "No" })}><option>No</option><option>Sí</option></select></label>
            <label className={`field ${draft.cutStatus === "Sí" ? "required-field" : ""}`}><span>Kg cortados totales</span><input required={draft.cutStatus === "Sí"} disabled={readOnly || saving || draft.cutStatus !== "Sí"} type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.cutKgTotal} onChange={(event) => setDraft({ ...draft, cutKgTotal: event.target.value })} placeholder="0" /></label>
          </div>
          {!readOnly && <button className="primary-button" type="submit" disabled={saving}><Save size={18} /> {saving ? "Guardando…" : "Guardar corte"}</button>}
        </form>
      )}

      <div className="harvest-list">
        {visible.length ? (
          filter === "cut" ? cutGroups.map((group) => (
            <section className="harvest-species-group" key={`${group.crop}-${group.variety}`}>
              <div className="harvest-species-heading">
                <div><small>Especie</small><strong>{group.crop}</strong></div>
                <div><small>Variedad</small><strong>{group.variety}</strong></div>
                <span>{group.rows.length} compra{group.rows.length === 1 ? "" : "s"} · {formatKg(group.totalKg)} kg</span>
              </div>
              <div className="harvest-species-list">{group.rows.map(renderHarvestCard)}</div>
            </section>
          )) : visible.map(renderHarvestCard)
        ) : <div className="empty-state compact-empty"><PackageCheck size={32} /><h3>No hay compras en este estado</h3><p>Cuando cambie un corte, aparecerá aquí automáticamente.</p></div>}
      </div>
    </div>
  );
}
