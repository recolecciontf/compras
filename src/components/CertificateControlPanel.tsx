import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  FileCheck2,
  FileText,
  LoaderCircle,
  MapPin,
  Search,
  ShieldCheck,
  Sprout,
  Users,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CertificateCatalogRecord, ControlCatalogData } from "../types";
import { PRODUCT_CATALOG } from "../lib/catalog";
import { companyTaxId, hasCompanyTaxId } from "../lib/fiscal";

type CatalogTab = "certificates" | "farms" | "members" | "documents";
type CompanyFilter = "all" | "MR. ORGÁNICA" | "TOÑIFRUIT";
type MemberFilter = "all" | "yes" | "no";
type FarmTypeFilter = "all" | "Propia" | "De terceros";
type CertificateStatusFilter = "all" | "expired" | "soon" | "valid" | "missing";
type CertificateRecord = CertificateCatalogRecord;

type Props = {
  canEdit: boolean;
  onLoadCatalog: () => Promise<ControlCatalogData>;
  onDownloadDocument: (id: string) => Promise<void>;
  onUploadDocument: (file: File, id: string) => Promise<void>;
  onBack: () => void;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

function certificateStatus(expiry: string) {
  if (!expiry) return { key: "missing" as const, label: "Sin fecha" };
  const today = new Date();
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const date = new Date(`${expiry}T12:00:00`);
  const days = Math.ceil((date.getTime() - localToday.getTime()) / 86_400_000);
  if (days < 0) return { key: "expired" as const, label: "Vencido" };
  if (days <= 15) return { key: "soon" as const, label: days === 0 ? "Vence hoy" : `Vence en ${days} días` };
  return { key: "valid" as const, label: "Vigente" };
}

function formatDate(value: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function formatSurface(value: number) {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function OpfhMark({ selected }: { selected: boolean }) {
  return (
    <span className={`catalog-opfh-mark ${selected ? "selected" : ""}`} role="checkbox" aria-checked={selected}>
      <span>{selected && <Check size={14} />}</span>
      {selected ? "Socio OPFH" : "No socio"}
    </span>
  );
}

const EMPTY_CATALOG: ControlCatalogData = {
  updatedAt: "",
  certificates: [],
  opfhMembers: [],
  farms: [],
  documents: [],
  storedDocuments: 0,
};

export function CertificateControlPanel({ canEdit, onBack, onLoadCatalog, onDownloadDocument, onUploadDocument }: Props) {
  const [tab, setTab] = useState<CatalogTab>("certificates");
  const [catalog, setCatalog] = useState<ControlCatalogData>(EMPTY_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<CompanyFilter>("all");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [farmType, setFarmType] = useState<FarmTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<CertificateStatusFilter>("all");
  const [campaign, setCampaign] = useState("all");
  const [documentType, setDocumentType] = useState("all");
  const [documentSpecies, setDocumentSpecies] = useState("all");
  const [documentVariety, setDocumentVariety] = useState("all");
  const [downloadingId, setDownloadingId] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const { certificates, opfhMembers, farms, documents } = catalog;

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError("");
    onLoadCatalog()
      .then((data) => {
        if (active) setCatalog(data);
      })
      .catch((reason) => {
        if (active) setCatalogError(reason instanceof Error ? reason.message : "No se ha podido cargar el control documental.");
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, [catalogRevision, onLoadCatalog]);

  useEffect(() => {
    let active = true;
    const refreshCatalog = () => {
      onLoadCatalog()
        .then((data) => {
          if (active) {
            setCatalog(data);
            setCatalogError("");
          }
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(refreshCatalog, 5 * 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshCatalog();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onLoadCatalog]);

  const summary = useMemo(() => {
    const uniqueFarmers = new Set(certificates.map((record) => `${record.company}|${record.farmer}`)).size;
    const expired = certificates.filter((record) => certificateStatus(record.expiry).key === "expired").length;
    const soon = certificates.filter((record) => certificateStatus(record.expiry).key === "soon").length;
    return {
      farmers: uniqueFarmers,
      opfh: opfhMembers.length,
      expired,
      soon,
      farms: farms.length,
      documents: documents.length,
      storedDocuments: catalog.storedDocuments,
    };
  }, [catalog.storedDocuments, certificates, documents, farms, opfhMembers]);

  const filteredCertificates = useMemo(() => {
    const search = normalize(query);
    return certificates.filter((record) => {
      if (company !== "all" && record.company !== company) return false;
      if (memberFilter === "yes" && !record.opfhMember) return false;
      if (memberFilter === "no" && record.opfhMember) return false;
      if (farmType !== "all" && record.farmType !== farmType) return false;
      if (statusFilter !== "all" && certificateStatus(record.expiry).key !== statusFilter) return false;
      if (!search) return true;
      return normalize([
        record.farmer,
        companyTaxId(record.taxId),
        record.certification,
        record.company,
        ...record.crops,
      ].join(" ")).includes(search);
    });
  }, [certificates, company, farmType, memberFilter, query, statusFilter]);

  const farmerGroups = useMemo(() => {
    const groups = new Map<string, { base: CertificateRecord; certificates: CertificateRecord[] }>();
    for (const record of filteredCertificates) {
      const key = `${record.company}|${record.farmer}`;
      const current = groups.get(key);
      if (current) current.certificates.push(record);
      else groups.set(key, { base: record, certificates: [record] });
    }
    return [...groups.values()].sort((left, right) => left.base.farmer.localeCompare(right.base.farmer, "es"));
  }, [filteredCertificates]);

  const filteredFarms = useMemo(() => {
    const search = normalize(query);
    return farms.filter((farm) => {
      if (farmType !== "all" && farm.farmType !== farmType) return false;
      if (!search) return true;
      return normalize([
        farm.holder,
        companyTaxId(farm.taxId),
        farm.farmName,
        farm.municipality,
        farm.polygon,
        farm.parcel,
        farm.crop,
        farm.variety,
        farm.ownerLessor,
      ].join(" ")).includes(search);
    });
  }, [farms, farmType, query]);

  const farmGroups = useMemo(() => {
    const groups = new Map<string, { holder: string; taxId: string; farmType: string; farmName: string; crop: string; records: typeof filteredFarms; surface: number }>();
    for (const farm of filteredFarms) {
      const farmName = farm.farmName || "Finca sin nombre";
      const crop = farm.crop || "Cultivo sin indicar";
      const key = [farm.holder, farmName, crop].map(normalize).join("|");
      const current = groups.get(key) ?? {
        holder: farm.holder,
        taxId: companyTaxId(farm.taxId),
        farmType: farm.farmType,
        farmName,
        crop,
        records: [],
        surface: 0,
      };
      current.records.push(farm);
      current.surface += farm.surface;
      groups.set(key, current);
    }
    return [...groups.values()].sort((left, right) => (
      left.holder.localeCompare(right.holder, "es")
      || left.farmName.localeCompare(right.farmName, "es")
      || left.crop.localeCompare(right.crop, "es")
    ));
  }, [filteredFarms]);

  const filteredMembers = useMemo(() => {
    const search = normalize(query);
    return opfhMembers.filter((member) => {
      if (!search) return true;
      const cif = companyTaxId(member.taxId);
      return normalize([member.name, cif, member.note, ...member.controlNames].join(" ")).includes(search);
    });
  }, [opfhMembers, query]);

  const sortedMembers = useMemo(() => {
    const groupOrder = ["TOÑIFRUIT", "GOODNATURE", "BIBIO", "MR. ORGÁNICA"];
    return [...filteredMembers].sort((left, right) => {
      if (left.groupCompany !== right.groupCompany) return left.groupCompany ? -1 : 1;
      if (left.groupCompany && right.groupCompany) {
        const leftOrder = groupOrder.findIndex((name) => normalize(left.name).includes(normalize(name)));
        const rightOrder = groupOrder.findIndex((name) => normalize(right.name).includes(normalize(name)));
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      }
      return left.name.localeCompare(right.name, "es");
    });
  }, [filteredMembers]);

  const filteredDocuments = useMemo(() => {
    const search = normalize(query);
    return documents.filter((document) => {
      if (company !== "all" && document.company !== company) return false;
      if (campaign !== "all" && document.campaign !== campaign) return false;
      if (documentType !== "all" && document.documentType !== documentType) return false;
      if (documentSpecies !== "all" && !document.species.includes(documentSpecies)) return false;
      if (documentVariety !== "all" && !document.varieties.includes(documentVariety)) return false;
      if (!search) return true;
      return normalize([document.farmer, document.filename, document.company, document.campaign, document.documentType, ...document.species, ...document.varieties].join(" ")).includes(search);
    });
  }, [campaign, company, documentSpecies, documentType, documentVariety, documents, query]);

  const documentCampaigns = useMemo(() => [...new Set(documents.map((document) => document.campaign))].sort().reverse(), [documents]);
  const documentTypes = useMemo(() => [...new Set(documents.map((document) => document.documentType))].sort((left, right) => left.localeCompare(right, "es")), [documents]);
  const documentSpeciesOptions = useMemo(() => [...new Set([
    ...Object.keys(PRODUCT_CATALOG),
    ...documents.flatMap((document) => document.species),
  ])].sort((left, right) => left.localeCompare(right, "es")), [documents]);
  const documentVarietyOptions = useMemo(() => [...new Set(documents
    .filter((document) => documentSpecies === "all" || document.species.includes(documentSpecies))
    .flatMap((document) => document.varieties))].sort((left, right) => left.localeCompare(right, "es")), [documentSpecies, documents]);

  function changeTab(next: CatalogTab) {
    setTab(next);
    setQuery("");
    setCompany("all");
    setMemberFilter("all");
    setFarmType("all");
    setStatusFilter("all");
    setCampaign("all");
    setDocumentType("all");
    setDocumentSpecies("all");
    setDocumentVariety("all");
    setUploadMessage("");
  }

  async function downloadDocument(id: string) {
    setDownloadingId(id);
    setUploadMessage("");
    try {
      await onDownloadDocument(id);
    } catch (reason) {
      setUploadMessage(reason instanceof Error ? reason.message : "No se ha podido descargar el documento.");
    } finally {
      setDownloadingId("");
    }
  }

  async function uploadDocuments(files: File[]) {
    if (!files.length) return;
    const knownIds = new Set(documents.map((document) => document.id));
    const selected = files
      .map((file) => ({ file, id: file.name.split("__", 1)[0] }))
      .filter((entry) => knownIds.has(entry.id));
    if (!selected.length) {
      setUploadMessage("Los archivos seleccionados no pertenecen a la biblioteca preparada.");
      return;
    }
    setUploadProgress({ current: 0, total: selected.length });
    setUploadMessage("");
    try {
      for (let index = 0; index < selected.length; index += 1) {
        await onUploadDocument(selected[index].file, selected[index].id);
        setUploadProgress({ current: index + 1, total: selected.length });
      }
      setUploadMessage(`${selected.length} documentos incorporados correctamente.`);
    } catch (reason) {
      setUploadMessage(reason instanceof Error ? reason.message : "La importación se ha interrumpido.");
    } finally {
      setUploadProgress(null);
    }
  }

  if (catalogLoading) {
    return (
      <section className="catalog-page">
        <div className="catalog-loading"><LoaderCircle className="spinning" size={30} /><strong>Cargando el control documental privado…</strong></div>
      </section>
    );
  }

  if (catalogError) {
    return (
      <section className="catalog-page">
        <div className="empty-state">
          <AlertTriangle size={32} />
          <h3>No se ha podido abrir el control documental</h3>
          <p>{catalogError}</p>
          <div className="catalog-error-actions">
            <button className="secondary-button" type="button" onClick={onBack}><ArrowLeft size={17} /> Volver</button>
            <button className="primary-button" type="button" onClick={() => setCatalogRevision((value) => value + 1)}>Reintentar</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="catalog-page">
      <div className="review-header catalog-header">
        <button className="back-button mobile-back" type="button" onClick={onBack}><ArrowLeft size={20} /> Expedientes</button>
        <div className="page-kicker"><ShieldCheck size={18} /> Control documental actualizado</div>
        <h1 className="page-title">{canEdit ? "Certificados y OPFH" : "Certificados"}</h1>
        <p className="page-subtitle">{canEdit ? "Consulta vigencias, socios y parcelas desde un único control. ARRA 19 se conserva sin cambios." : "Consulta las certificaciones y su vigencia. La información contractual y de fincas está restringida."}</p>
        <span className="catalog-updated"><CalendarDays size={15} /> Datos cruzados a {formatDate(catalog.updatedAt)}</span>
      </div>

      <div className="catalog-summary">
        <article><Users size={20} /><span>Agricultores</span><strong>{summary.farmers}</strong></article>
        {canEdit && <article><ShieldCheck size={20} /><span>Socios OPFH</span><strong>{summary.opfh}</strong></article>}
        <article className="catalog-alert"><AlertTriangle size={20} /><span>Certificados vencidos</span><strong>{summary.expired}</strong></article>
        <article><CalendarDays size={20} /><span>Próximos 15 días</span><strong>{summary.soon}</strong></article>
        {canEdit && <article><MapPin size={20} /><span>Fincas / recintos</span><strong>{summary.farms}</strong></article>}
        {canEdit && <article><FileText size={20} /><span>Documentos cargados</span><strong>{summary.storedDocuments}/{summary.documents}</strong></article>}
      </div>

      <div className="catalog-tabs" role="tablist" aria-label="Secciones del control">
        <button type="button" className={tab === "certificates" ? "active" : ""} onClick={() => changeTab("certificates")}><FileCheck2 size={17} /> Certificados</button>
        {canEdit && <button type="button" className={tab === "members" ? "active" : ""} onClick={() => changeTab("members")}><Users size={17} /> Socios OPFH</button>}
        {canEdit && <button type="button" className={tab === "farms" ? "active" : ""} onClick={() => changeTab("farms")}><Sprout size={17} /> Fincas</button>}
        {canEdit && <button type="button" className={tab === "documents" ? "active" : ""} onClick={() => changeTab("documents")}><FileText size={17} /> Documentos</button>}
      </div>

      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "farms" ? "Buscar titular, finca, parcela o cultivo" : tab === "documents" ? "Buscar agricultor, documento o archivo" : tab === "members" ? "Buscar socio o empresa" : "Buscar agricultor, CIF o certificación"} />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Borrar búsqueda"><X size={17} /></button>}
        </label>
        {tab === "certificates" && <>
          <label><span>Empresa</span><select value={company} onChange={(event) => setCompany(event.target.value as CompanyFilter)}><option value="all">Todas</option><option>TOÑIFRUIT</option><option>MR. ORGÁNICA</option></select></label>
          {canEdit && <label><span>OPFH</span><select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value as MemberFilter)}><option value="all">Todos</option><option value="yes">Solo socios</option><option value="no">No socios</option></select></label>}
          <label><span>Vigencia</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CertificateStatusFilter)}><option value="all">Todas</option><option value="expired">Vencidos</option><option value="soon">Próximos 15 días</option><option value="valid">Vigentes</option><option value="missing">Sin fecha</option></select></label>
        </>}
        {canEdit && (tab === "certificates" || tab === "farms") && <label><span>Tipo de finca</span><select value={farmType} onChange={(event) => setFarmType(event.target.value as FarmTypeFilter)}><option value="all">Todas</option><option>Propia</option><option>De terceros</option></select></label>}
        {tab === "documents" && <>
          <label><span>Empresa</span><select value={company} onChange={(event) => setCompany(event.target.value as CompanyFilter)}><option value="all">Todas</option><option>TOÑIFRUIT</option><option>MR. ORGÁNICA</option></select></label>
          <label><span>Campaña</span><select value={campaign} onChange={(event) => setCampaign(event.target.value)}><option value="all">Todas</option>{documentCampaigns.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Tipo</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="all">Todos</option>{documentTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Especie</span><select value={documentSpecies} onChange={(event) => { setDocumentSpecies(event.target.value); setDocumentVariety("all"); }}><option value="all">Todas</option>{documentSpeciesOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Variedad</span><select value={documentVariety} onChange={(event) => setDocumentVariety(event.target.value)}><option value="all">Todas</option>{documentVarietyOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        </>}
      </div>

      {tab === "certificates" && (
        <div className="catalog-results">
          <div className="catalog-result-count">{farmerGroups.length} agricultor{farmerGroups.length === 1 ? "" : "es"} · {filteredCertificates.length} certificados</div>
          <div className="certificate-farmers">
            {farmerGroups.map(({ base, certificates }) => {
              const crops = [...new Set(certificates.flatMap((record) => record.crops))];
              const cif = companyTaxId(base.taxId);
              const fiscalAndCrops = [cif ? `CIF ${cif}` : "", crops.join(", ")].filter(Boolean).join(" · ");
              return (
                <details className={`certificate-farmer ${base.preserved ? "preserved" : ""}`} key={`${base.company}-${base.farmer}`}>
                  <summary>
                    <div className="certificate-farmer-main">
                      <span className="company-label">{base.company}</span>
                      <strong>{base.farmer}</strong>
                      {fiscalAndCrops && <small>{fiscalAndCrops}</small>}
                    </div>
                    <div className="certificate-farmer-flags">
                      <OpfhMark selected={base.opfhMember} />
                      {base.farmType && <span className={`farm-type ${base.farmType === "Propia" ? "own" : "third"}`}>{base.farmType}</span>}
                      {base.preserved && <span className="preserved-badge">ARRA 19 preservado</span>}
                      <span className="certificate-count">{certificates.length}</span>
                      <ChevronDown size={18} />
                    </div>
                  </summary>
                  <div className="certificate-lines">
                    {certificates.map((record) => {
                      const status = certificateStatus(record.expiry);
                      return (
                        <div className="certificate-line" key={record.id}>
                          <strong>{record.certification}</strong>
                          <span>{record.crops.join(", ") || "Cultivo no indicado"}</span>
                          <span>{formatDate(record.expiry)}</span>
                          <span className={`certificate-status ${status.key}`}>{status.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {tab === "members" && (
        <div className="catalog-results">
          <div className="catalog-result-count">{filteredMembers.filter((member) => !member.groupCompany).length} socios · {filteredMembers.filter((member) => member.groupCompany).length} empresas del grupo</div>
          <div className="opfh-member-grid">
            {sortedMembers.map((member) => (
              <article className={member.groupCompany ? "group-company" : ""} key={member.taxId}>
                <div className="member-heading">
                  {member.groupCompany
                    ? <span className="group-company-mark"><Building2 size={14} /> Empresa del grupo</span>
                    : <OpfhMark selected />}
                </div>
                <strong>{member.name}</strong>
                {hasCompanyTaxId(member.taxId) && <span className="member-tax-id">CIF {companyTaxId(member.taxId)}</span>}
                <small>{member.controlNames.join(" · ") || "Sin nombre equivalente en el control"}</small>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "farms" && (
        <div className="catalog-results">
          <div className="catalog-result-count">{filteredFarms.length} recintos · {farmGroups.length} grupos de finca y cultivo</div>
          <div className="farm-groups">
            {farmGroups.map((group) => {
              const varieties = [...new Set(group.records.map((farm) => farm.variety).filter(Boolean))];
              return (
                <details className="farm-group" key={`${group.holder}-${group.farmName}-${group.crop}`}>
                  <summary>
                    <div className="farm-group-holder">
                      <strong>{group.holder}</strong>
                      {group.taxId && <small>CIF {group.taxId}</small>}
                    </div>
                    <div className="farm-group-name"><small>Finca</small><strong>{group.farmName}</strong></div>
                    <div className="farm-group-crop"><small>Cultivo</small><strong>{group.crop}</strong><span>{varieties.join(", ") || "Variedad sin indicar"}</span></div>
                    <div className="farm-group-total"><span>{group.records.length} recinto{group.records.length === 1 ? "" : "s"}</span><strong>{formatSurface(group.surface)} ha</strong></div>
                    <ChevronDown className="farm-group-chevron" size={19} />
                  </summary>
                  <div className="farm-detail-wrap">
                    <table className="farm-detail-table">
                      <thead><tr><th>Tipo</th><th>Municipio</th><th>Polígono</th><th>Parcela</th><th>Recinto</th><th>Variedad</th><th>Superficie</th></tr></thead>
                      <tbody>
                        {group.records.map((farm) => (
                          <tr key={farm.id}>
                            <td><span className={`farm-type ${farm.farmType === "Propia" ? "own" : "third"}`}>{farm.farmType}</span></td>
                            <td>{farm.municipality || "—"}</td>
                            <td>{farm.polygon || "—"}</td>
                            <td>{farm.parcel || "—"}</td>
                            <td>{farm.enclosure || "—"}</td>
                            <td>{farm.variety || "—"}</td>
                            <td className="surface-cell">{formatSurface(farm.surface)} ha</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {tab === "documents" && (
        <div className="catalog-results">
          <div className="document-library-heading">
            <div className="catalog-result-count">{filteredDocuments.length} documentos</div>
            {canEdit && (
              <label className={`secondary-button bulk-upload-button ${uploadProgress ? "disabled" : ""}`}>
                {uploadProgress ? <LoaderCircle className="spinning" size={17} /> : <Upload size={17} />}
                {uploadProgress ? `Subiendo ${uploadProgress.current} de ${uploadProgress.total}` : "Importar documentos"}
                <input
                  data-testid="bulk-contract-upload"
                  type="file"
                  multiple
                  disabled={Boolean(uploadProgress)}
                  onChange={(event) => {
                    const files = event.currentTarget.files ? [...event.currentTarget.files] : [];
                    event.currentTarget.value = "";
                    void uploadDocuments(files);
                  }}
                />
              </label>
            )}
          </div>
          {uploadMessage && <div className="document-upload-message"><FileCheck2 size={17} /> {uploadMessage}</div>}
          <div className="document-library-list">
            {filteredDocuments.map((document) => (
              <article key={document.id}>
                <div className="document-icon"><FileText size={20} /></div>
                <div className="document-main">
                  <span>{document.company} · {document.campaign}</span>
                  <strong>{document.filename}</strong>
                  <small>{document.farmer} · {document.documentType}{document.species.length ? ` · ${document.species.join(" + ")}` : ""}{document.varieties.length ? ` · ${document.varieties.join(" + ")}` : ""} · {document.extension} · {(document.size / 1048576).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB</small>
                </div>
                <button className="secondary-button" type="button" disabled={downloadingId === document.id} onClick={() => void downloadDocument(document.id)}>
                  {downloadingId === document.id ? <LoaderCircle className="spinning" size={16} /> : <Download size={16} />}
                  Descargar
                </button>
              </article>
            ))}
          </div>
        </div>
      )}

      {((tab === "certificates" && !farmerGroups.length) || (tab === "members" && !filteredMembers.length) || (tab === "farms" && !filteredFarms.length) || (tab === "documents" && !filteredDocuments.length)) && (
        <div className="empty-state"><Search size={32} /><h3>No hay resultados</h3><p>Cambia los filtros o prueba con otro término.</p></div>
      )}

      <div className="catalog-source-note"><Building2 size={17} /> Actualizado desde documentos, certificados, análisis y Efectivos_productivos.xlsx.</div>
    </section>
  );
}
