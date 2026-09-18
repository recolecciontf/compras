import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, History, RefreshCw, Search } from "lucide-react";
import type { AuditEvent } from "../types";

type Props = {
  onLoad: () => Promise<AuditEvent[]>;
  onBack: () => void;
};

const ACTION_LABELS: Record<string, string> = {
  "purchase.create": "Compra creada",
  "purchase.update": "Compra actualizada",
  "review.update": "Revisión actualizada",
  "harvest.update": "Cortes y kilos",
  "record.status": "Estado cambiado",
  "record.backup.restore": "Copia restaurada",
  "record.delete": "Expediente eliminado",
  "contract.archive": "Contrato archivado",
  "contract.replace": "Contrato sustituido",
  "contract.previous.upload": "Contrato anterior subido",
  "contract.previous.copy": "Contrato anterior reutilizado",
  "catalog.update": "Catálogo actualizado",
  "document.upload": "Documento incorporado",
};

function eventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Fecha no disponible"
    : new Intl.DateTimeFormat("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

export function ActivityLogPanel({ onLoad, onBack }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setEvents(await onLoad());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido abrir el registro de actividad.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return events;
    return events.filter((event) => [
      event.actorDisplayName,
      event.actorUsername,
      event.summary,
      event.recordId,
      ACTION_LABELS[event.action] || event.action,
    ].some((value) => String(value || "").toLocaleLowerCase("es").includes(normalized)));
  }, [events, query]);

  return (
    <section className="activity-panel">
      <header className="activity-header">
        <button className="back-button" type="button" onClick={onBack}><ArrowLeft size={19} /> Expedientes</button>
        <div>
          <span className="eyebrow">Solo administrador</span>
          <h1>Registro de actividad</h1>
          <p>Cada cambio queda asociado al usuario, la fecha y el expediente afectado.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={loading ? "spinning" : ""} size={17} /> Actualizar
        </button>
      </header>

      <div className="activity-toolbar">
        <label className="activity-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar usuario, expediente o acción" /></label>
        <span><History size={17} /> {filtered.length} movimientos</span>
      </div>

      {error && <div className="activity-error"><AlertTriangle size={18} /><span>{error}</span></div>}
      {!error && loading && <div className="activity-empty"><RefreshCw className="spinning" size={28} /><p>Cargando actividad…</p></div>}
      {!error && !loading && !filtered.length && <div className="activity-empty"><History size={30} /><h2>No hay movimientos</h2><p>No se han encontrado cambios con este criterio.</p></div>}
      {!error && !loading && filtered.length > 0 && (
        <div className="activity-list">
          {filtered.map((event) => (
            <article className={`activity-event activity-${event.status}`} key={event.id}>
              <span className="activity-status-icon">
                {event.status === "completed" ? <CheckCircle2 size={20} /> : event.status === "failed" ? <AlertTriangle size={20} /> : <Clock3 size={20} />}
              </span>
              <div className="activity-event-main">
                <div className="activity-event-title">
                  <strong>{ACTION_LABELS[event.action] || event.action}</strong>
                  <span>{event.status === "completed" ? "Registrado" : event.status === "failed" ? "No completado" : "En curso"}</span>
                </div>
                <p>{event.summary}</p>
                <small>
                  <b>{event.actorDisplayName || event.actorUsername}</b>
                  {event.recordId ? ` · ${event.recordId}` : ""}
                  {` · ${eventDate(event.completedAt || event.timestamp)}`}
                </small>
                {event.error && <em>{event.error}</em>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
