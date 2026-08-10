import { FileText, Plus, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { CERTIFICATIONS, OTHER_VALUE, PRODUCT_CATALOG, emptyMaterial, materialSummary } from "../lib/catalog";
import type { ContractDetails, MaterialItem, PurchaseForm } from "../types";

type Props = {
  value: PurchaseForm;
  onChange: Dispatch<SetStateAction<PurchaseForm>>;
  disabled?: boolean;
  contractMode?: "existing" | "generated" | "editing";
};

function localToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export const EMPTY_CONTRACT_DETAILS: ContractDetails = {
  contractOrigin: "",
  buyerCompany: "",
  signatureDate: localToday(),
  contractNumber: "",
  sellerRepresentative: "",
  sellerDni: "",
  sellerAddress: "",
  organicOperatorCode: "",
  certifierCode: "",
  ailimpoRegepaCode: "",
  modality: "A KILOS",
  collectionBy: "Comprador",
  transportBy: "Comprador",
  pricePerKg: "",
  totalPrice: "",
  ivaPercent: "",
  irpfPercent: "",
  advancePayment: "",
  paymentDays: "30",
  insuranceProvider: "Agroseguro",
  insurancePolicy: "",
  applyDestrio: "No",
  destrioLocation: "",
  destrioDefects: "",
  destrioPrice: "",
  sellerEmail: "",
  companyEmail: "",
  buyerRepresentative: "",
  archiveId: "",
  archiveFilename: "",
  archivedAt: "",
  emailStatus: "",
  sellerSignedAt: "",
  buyerSignedAt: "",
  signatureMethod: "",
  archiveHistoryJson: "",
};

export const EMPTY_PURCHASE: PurchaseForm = {
  id: "",
  provider: "",
  taxId: "",
  farm: "",
  municipality: "",
  crop: "",
  variety: "",
  expectedKg: "",
  materials: [emptyMaterial()],
  campaign: String(new Date().getFullYear()),
  registeredIca: "Pendiente",
  contractSigned: "",
  contractStart: "",
  contractEnd: "",
  documentPath: "",
  otherAgreements: "",
  contractDetails: { ...EMPTY_CONTRACT_DETAILS },
};

function MaterialFields({
  item,
  index,
  total,
  disabled,
  onUpdate,
  onRemove,
}: {
  item: MaterialItem;
  index: number;
  total: number;
  disabled: boolean;
  onUpdate: (item: MaterialItem) => void;
  onRemove: () => void;
}) {
  const species = Object.keys(PRODUCT_CATALOG);
  const isKnownSpecies = species.includes(item.crop);
  const speciesSelection = isKnownSpecies ? item.crop : item.crop ? OTHER_VALUE : "";
  const varieties = isKnownSpecies ? PRODUCT_CATALOG[item.crop] : [];
  const isKnownVariety = varieties.includes(item.variety);
  const varietySelection = isKnownVariety ? item.variety : item.variety ? OTHER_VALUE : "";
  const update = <K extends keyof MaterialItem>(key: K, nextValue: MaterialItem[K]) => onUpdate({ ...item, [key]: nextValue });

  function selectSpecies(next: string) {
    if (next === OTHER_VALUE) onUpdate({ ...item, crop: "Otra especie", variety: "" });
    else onUpdate({ ...item, crop: next, variety: "" });
  }

  return (
    <article className="material-card">
      <div className="material-card-heading">
        <div><strong>Materia prima {index + 1}</strong><small>Una línea por especie y variedad</small></div>
        {total > 1 && <button type="button" className="icon-button danger-icon" disabled={disabled} onClick={onRemove} aria-label={`Eliminar materia prima ${index + 1}`}><Trash2 size={18} /></button>}
      </div>
      <div className="three-columns">
        <label className="field required-field"><span>Especie</span><select required disabled={disabled} value={speciesSelection} onChange={(event) => selectSpecies(event.target.value)}><option value="">Seleccionar especie</option>{species.map((speciesName) => <option key={speciesName} value={speciesName}>{speciesName}</option>)}<option value={OTHER_VALUE}>Otra especie</option></select></label>
        {speciesSelection === OTHER_VALUE && <label className="field required-field"><span>Indica la especie</span><input required disabled={disabled} value={item.crop === "Otra especie" ? "" : item.crop} onChange={(event) => update("crop", event.target.value)} placeholder="Escribe la especie" /></label>}
        <label className="field required-field"><span>Variedad</span><select required disabled={disabled || !item.crop} value={varietySelection} onChange={(event) => update("variety", event.target.value === OTHER_VALUE ? "Otra variedad" : event.target.value)}><option value="">Seleccionar variedad</option>{varieties.map((varietyName) => <option key={varietyName} value={varietyName}>{varietyName}</option>)}<option value={OTHER_VALUE}>Otra variedad</option></select></label>
        {varietySelection === OTHER_VALUE && <label className="field required-field"><span>Indica la variedad</span><input required disabled={disabled} value={item.variety === "Otra variedad" ? "" : item.variety} onChange={(event) => update("variety", event.target.value)} placeholder="Escribe la variedad" /></label>}
        <label className="field required-field"><span>Kg previstos</span><input required disabled={disabled} type="number" min="0.01" step="0.01" inputMode="decimal" value={item.expectedKg} onChange={(event) => update("expectedKg", event.target.value)} placeholder="0" /></label>
      </div>
      <details className="parcel-details">
        <summary>Datos internos de parcela</summary>
        <div className="three-columns">
          <label className="field"><span>Situación</span><input disabled={disabled} value={item.situation} onChange={(event) => update("situation", event.target.value)} placeholder="Pedanía o ubicación" /></label>
          <label className="field"><span>Término municipal</span><input disabled={disabled} value={item.municipality} onChange={(event) => update("municipality", event.target.value)} placeholder="Municipio" /></label>
          <label className="field"><span>Paraje</span><input disabled={disabled} value={item.paraje} onChange={(event) => update("paraje", event.target.value)} /></label>
          <label className="field"><span>Polígono</span><input disabled={disabled} value={item.polygon} onChange={(event) => update("polygon", event.target.value)} /></label>
          <label className="field"><span>Parcela</span><input disabled={disabled} value={item.plot} onChange={(event) => update("plot", event.target.value)} /></label>
          <label className="field"><span>Hectáreas</span><input disabled={disabled} type="number" min="0" step="0.01" inputMode="decimal" value={item.hectares} onChange={(event) => update("hectares", event.target.value)} /></label>
        </div>
      </details>
    </article>
  );
}

export function PurchaseFields({ value, onChange, disabled = false, contractMode = "editing" }: Props) {
  function update<K extends keyof PurchaseForm>(key: K, nextValue: PurchaseForm[K]) {
    onChange((current) => ({ ...current, [key]: nextValue }));
  }

  function updateContract<K extends keyof ContractDetails>(key: K, nextValue: ContractDetails[K]) {
    onChange((current) => ({
      ...current,
      contractDetails: { ...current.contractDetails, [key]: nextValue },
    }));
  }

  function updateModality(nextValue: ContractDetails["modality"]) {
    onChange((current) => ({
      ...current,
      contractDetails: {
        ...current.contractDetails,
        modality: nextValue,
        pricePerKg: nextValue === "A KILOS" ? current.contractDetails.pricePerKg : "",
        totalPrice: nextValue === "POR TANTO" ? current.contractDetails.totalPrice : "",
      },
    }));
  }

  function changeMaterials(change: (materials: MaterialItem[]) => MaterialItem[]) {
    onChange((current) => {
      const materials = change(current.materials);
      return { ...current, materials, ...materialSummary(materials) };
    });
  }

  const contract = value.contractDetails;
  const hasAilimpoSpecies = value.materials.some((item) => ["Limón", "Pomelo"].includes(item.crop));

  return (
    <div className="purchase-fields">
      <div className="field-section-heading">
        <span>1</span>
        <div><strong>Agricultor y finca</strong><small>Identificación del proveedor y origen de la fruta</small></div>
        <em>Obligatorio</em>
      </div>
      <div className="two-columns">
        <label className="field required-field"><span>Agricultor / razón social</span><input required disabled={disabled} value={value.provider} onChange={(event) => update("provider", event.target.value)} placeholder="Nombre o razón social" /></label>
        <label className="field required-field"><span>NIF / CIF</span><input required disabled={disabled} value={value.taxId} onChange={(event) => update("taxId", event.target.value)} placeholder="Documento fiscal" /></label>
        <label className="field required-field"><span>Finca / explotación</span><input required disabled={disabled} value={value.farm} onChange={(event) => update("farm", event.target.value)} placeholder="Nombre o referencia SIGPAC" /></label>
        <label className="field required-field"><span>Municipio</span><input required disabled={disabled} value={value.municipality} onChange={(event) => update("municipality", event.target.value)} placeholder="Localidad" /></label>
        <label className="field required-field"><span>Campaña</span><input required disabled={disabled} value={value.campaign} onChange={(event) => update("campaign", event.target.value)} placeholder="2026/27" /></label>
      </div>

      <div className="field-section-heading section-divider">
        <span>2</span>
        <div><strong>Materia prima</strong><small>Puedes añadir varias especies o variedades al mismo expediente</small></div>
        <em>Obligatorio</em>
      </div>
      <div className="materials-list">
        {value.materials.map((item, index) => (
          <MaterialFields
            key={item.id}
            item={item}
            index={index}
            total={value.materials.length}
            disabled={disabled}
            onUpdate={(nextItem) => changeMaterials((materials) => materials.map((current) => current.id === item.id ? nextItem : current))}
            onRemove={() => changeMaterials((materials) => materials.filter((current) => current.id !== item.id))}
          />
        ))}
      </div>
      <button className="add-material-button" type="button" disabled={disabled} onClick={() => changeMaterials((materials) => [...materials, emptyMaterial({ municipality: value.municipality })])}><Plus size={18} /> Añadir especie o variedad</button>
      <span className="catalog-source-note">El modelo contractual se selecciona por especie. Cada variedad se rellena en su campo dentro del mismo contrato.</span>

      <div className="field-section-heading section-divider">
        <span>3</span>
        <div><strong>{contractMode === "existing" ? "Contrato firmado existente" : "Rellenar contrato"}</strong><small>{contractMode === "existing" ? "Registra la vigencia y archiva la copia firmada" : "Los modelos originales se completan sin modificar el clausulado"}</small></div>
        <em>Obligatorio</em>
      </div>
      {contractMode !== "existing" ? <>
      <div className="contract-workflow" aria-label="Flujo del contrato">
        <span className="active">Rellenar datos</span><i>→</i><span>Revisar</span><i>→</i><span>Firma agricultor</span><i>→</i><span>Descargar PDF</span>
      </div>
      <div className="three-columns">
        <label className="field required-field"><span>Empresa compradora</span><select required disabled={disabled} value={contract.buyerCompany} onChange={(event) => updateContract("buyerCompany", event.target.value as ContractDetails["buyerCompany"])}><option value="">Seleccionar</option><option>MR. ORGÁNICA, S.L.</option><option>TOÑIFRUIT, S.L.</option></select></label>
        <label className="field required-field"><span>Fecha de firma</span><input required disabled={disabled} type="date" value={contract.signatureDate} onInput={(event) => updateContract("signatureDate", event.currentTarget.value)} /></label>
        <label className="field"><span>N.º de contrato</span><input disabled={disabled} value={contract.contractNumber} onChange={(event) => updateContract("contractNumber", event.target.value)} placeholder="Si se deja vacío se usa el expediente" /></label>
        <div className="contract-status-card"><FileText size={18} /><span><strong>Estado al finalizar</strong><small>Pendiente de firma digital del comprador</small></span></div>
        <label className="field required-field"><span>Inicio del contrato</span><input required disabled={disabled} type="date" value={value.contractStart} onInput={(event) => update("contractStart", event.currentTarget.value)} /></label>
        <label className="field required-field"><span>Fin del contrato</span><input required disabled={disabled} type="date" min={value.contractStart || undefined} value={value.contractEnd} onInput={(event) => update("contractEnd", event.currentTarget.value)} /></label>
      </div>

      <details className="contract-data-details" open>
        <summary><FileText size={18} /> Datos que se insertarán en el contrato</summary>
        <div className="two-columns contract-data-grid">
          <label className="field required-field"><span>Representante del vendedor</span><input required disabled={disabled} value={contract.sellerRepresentative} onChange={(event) => updateContract("sellerRepresentative", event.target.value)} placeholder="Nombre y apellidos" /></label>
          <label className="field required-field"><span>DNI del representante</span><input required disabled={disabled} value={contract.sellerDni} onChange={(event) => updateContract("sellerDni", event.target.value)} /></label>
          <label className="field required-field"><span>Correo del agricultor</span><input required disabled={disabled} type="email" value={contract.sellerEmail} onChange={(event) => updateContract("sellerEmail", event.target.value)} placeholder="agricultor@correo.es" /></label>
          <label className="field required-field"><span>Correo de la empresa</span><input required disabled={disabled} type="email" value={contract.companyEmail} onChange={(event) => updateContract("companyEmail", event.target.value)} placeholder="compras@empresa.es" /></label>
          <label className="field required-field field-span"><span>Domicilio del vendedor</span><input required disabled={disabled} value={contract.sellerAddress} onChange={(event) => updateContract("sellerAddress", event.target.value)} /></label>
          <label className="field required-field"><span>Código operador ecológico</span><input required disabled={disabled} value={contract.organicOperatorCode} onChange={(event) => updateContract("organicOperatorCode", event.target.value)} /></label>
          <label className="field"><span>Código certificadora</span><input disabled={disabled} value={contract.certifierCode} onChange={(event) => updateContract("certifierCode", event.target.value)} /></label>
          {hasAilimpoSpecies && <label className="field"><span>Registro AILIMPO / REGEPA</span><input disabled={disabled} value={contract.ailimpoRegepaCode} onChange={(event) => updateContract("ailimpoRegepaCode", event.target.value)} /></label>}
          <label className="field required-field"><span>Modalidad de compraventa</span><select required disabled={disabled} value={contract.modality} onChange={(event) => updateModality(event.target.value as ContractDetails["modality"])}><option value="A KILOS">A KILOS</option><option value="POR TANTO">POR TANTO</option></select></label>
          <label className="field required-field"><span>Recolección por cuenta de</span><select required disabled={disabled} value={contract.collectionBy} onChange={(event) => updateContract("collectionBy", event.target.value as ContractDetails["collectionBy"])}><option>Vendedor</option><option>Comprador</option></select></label>
          <label className="field required-field"><span>Transporte por cuenta de</span><select required disabled={disabled} value={contract.transportBy} onChange={(event) => updateContract("transportBy", event.target.value as ContractDetails["transportBy"])}><option>Vendedor</option><option>Comprador</option></select></label>
          {contract.modality === "A KILOS"
            ? <label className="field required-field"><span>Precio €/kg</span><input required disabled={disabled} type="number" min="0" step="0.001" inputMode="decimal" value={contract.pricePerKg} onChange={(event) => updateContract("pricePerKg", event.target.value)} /></label>
            : <label className="field required-field"><span>Precio total (€)</span><input required disabled={disabled} type="number" min="0" step="0.01" inputMode="decimal" value={contract.totalPrice} onChange={(event) => updateContract("totalPrice", event.target.value)} /></label>}
          <label className="field"><span>IVA %</span><input disabled={disabled} type="number" min="0" step="0.01" value={contract.ivaPercent} onChange={(event) => updateContract("ivaPercent", event.target.value)} /></label>
          <label className="field"><span>IRPF %</span><input disabled={disabled} type="number" min="0" step="0.01" value={contract.irpfPercent} onChange={(event) => updateContract("irpfPercent", event.target.value)} /></label>
          <label className="field"><span>Entrega a cuenta (€)</span><input disabled={disabled} type="number" min="0" step="0.01" value={contract.advancePayment} onChange={(event) => updateContract("advancePayment", event.target.value)} /></label>
          <label className="field required-field"><span>Plazo de pago (días)</span><input required disabled={disabled} type="number" min="1" max="30" value={contract.paymentDays} onChange={(event) => updateContract("paymentDays", event.target.value)} /></label>
          <div className="field-help-card field-span"><FileText size={18} /><span>El PDF marcará la procedencia, la modalidad, la recolección y el transporte en las casillas originales del contrato.</span></div>
        </div>

        <div className="destrio-box">
          <label className="field required-field"><span>¿Se aplicará destrío?</span><select required disabled={disabled} value={contract.applyDestrio} onChange={(event) => updateContract("applyDestrio", event.target.value as ContractDetails["applyDestrio"])}><option>No</option><option>Sí</option></select></label>
          {contract.applyDestrio === "Sí" && <div className="three-columns">
            <label className="field required-field"><span>Lugar del destrío</span><select required disabled={disabled} value={contract.destrioLocation} onChange={(event) => updateContract("destrioLocation", event.target.value as ContractDetails["destrioLocation"])}><option value="">Seleccionar</option><option>Campo</option><option>Almacén</option></select></label>
            <label className="field required-field"><span>Defectos a destriar</span><input required disabled={disabled} value={contract.destrioDefects} onChange={(event) => updateContract("destrioDefects", event.target.value)} placeholder="Rodrejo, caracol, rozado…" /></label>
            <label className="field required-field"><span>Precio destrío €/kg</span><input required disabled={disabled} type="number" min="0" step="0.001" value={contract.destrioPrice} onChange={(event) => updateContract("destrioPrice", event.target.value)} /></label>
          </div>}
          {contract.applyDestrio === "Sí" && <p>El generador mantendrá intactas las condiciones estándar de minoración y añadirá el acuerdo de destrío en el espacio reservado.</p>}
        </div>
      </details>
      </> : <>
        <div className="contract-existing-note"><FileText size={20} /><div><strong>El contrato ya está firmado</strong><span>Adjunta la copia firmada al terminar este formulario. Quedará guardada en el archivo central y disponible para descargar.</span></div></div>
        <div className="three-columns">
          <label className="field required-field"><span>Empresa compradora</span><select required disabled={disabled} value={contract.buyerCompany} onChange={(event) => updateContract("buyerCompany", event.target.value as ContractDetails["buyerCompany"])}><option value="">Seleccionar</option><option>MR. ORGÁNICA, S.L.</option><option>TOÑIFRUIT, S.L.</option></select></label>
          <label className="field required-field"><span>Fecha de firma</span><input required disabled={disabled} type="date" value={contract.signatureDate} onInput={(event) => updateContract("signatureDate", event.currentTarget.value)} /></label>
          <label className="field"><span>N.º de contrato</span><input disabled={disabled} value={contract.contractNumber} onChange={(event) => updateContract("contractNumber", event.target.value)} /></label>
          <label className="field required-field"><span>Inicio del contrato</span><input required disabled={disabled} type="date" value={value.contractStart} onInput={(event) => update("contractStart", event.currentTarget.value)} /></label>
          <label className="field required-field"><span>Fin del contrato</span><input required disabled={disabled} type="date" min={value.contractStart || undefined} value={value.contractEnd} onInput={(event) => update("contractEnd", event.currentTarget.value)} /></label>
          <label className="field required-field"><span>Correo del agricultor</span><input required disabled={disabled} type="email" value={contract.sellerEmail} onChange={(event) => updateContract("sellerEmail", event.target.value)} /></label>
          <label className="field required-field"><span>Correo de la empresa</span><input required disabled={disabled} type="email" value={contract.companyEmail} onChange={(event) => updateContract("companyEmail", event.target.value)} /></label>
        </div>
      </>}

      <div className="field-section-heading section-divider optional-section-heading">
        <span>4</span>
        <div><strong>Información complementaria</strong><small>Solo cuando exista documentación o acuerdos adicionales</small></div>
        <em>Opcional</em>
      </div>
      <div className="two-columns optional-fields">
        <label className="field"><span>Ruta o enlace de documentos</span><input disabled={disabled} value={value.documentPath} onChange={(event) => update("documentPath", event.target.value)} placeholder="Carpeta, enlace o referencia" /></label>
        <label className="field"><span>Otros acuerdos</span><textarea disabled={disabled} value={value.otherAgreements} onChange={(event) => update("otherAgreements", event.target.value)} placeholder="Condiciones adicionales de la compra" /></label>
      </div>
      <span className="catalog-source-note">Certificaciones disponibles en la revisión: {CERTIFICATIONS.join(" · ")}</span>
    </div>
  );
}
