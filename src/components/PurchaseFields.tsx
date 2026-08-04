import type { PurchaseForm } from "../types";

const VARIETIES: Record<string, string[]> = {
  "Limón": ["Fino", "Verna", "Rodrejo", "Fino verde", "Eureka", "Meyer", "Lisbon", "Femminello"],
  "Naranja": ["Navelina", "Navel", "Navelate", "Lane Late", "Valencia Late", "Salustiana", "Powell", "Barnfield", "Rohde"],
  "Mandarina": ["Clemenules", "Oronules", "Clemenvilla", "Tango", "Nadorcott", "Orri", "Satsuma", "Hernandina", "Orogros", "Ortanique"],
  "Clementina": ["Clemenules", "Oronules", "Marisol", "Arrufatina", "Hernandina", "Orogrande", "Esbal"],
  "Pomelo": ["Star Ruby", "Rio Red", "Marsh", "Ruby Red"],
  "Lima": ["Persa", "Bearss", "Mexicana", "Kaffir"],
  "Uva": ["Crimson Seedless", "Autumn Royal", "Red Globe", "Superior Seedless", "Thompson Seedless", "Victoria", "Itumfifteen"],
  "Granada": ["Mollar de Elche", "Wonderful", "Acco", "Smith"],
  "Caqui": ["Rojo Brillante", "Triumph", "Fuyu"],
  "Aguacate": ["Hass", "Lamb Hass", "Fuerte", "Bacon", "Reed"],
  "Almendra": ["Guara", "Penta", "Lauranne", "Marcona", "Largueta"],
};

const OTHER = "__other__";

type Props = {
  value: PurchaseForm;
  onChange: (value: PurchaseForm) => void;
  disabled?: boolean;
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
  campaign: String(new Date().getFullYear()),
  contractSigned: "",
  contractStart: "",
  contractEnd: "",
  documentPath: "",
  otherAgreements: "",
};

export function PurchaseFields({ value, onChange, disabled = false }: Props) {
  function update<K extends keyof PurchaseForm>(key: K, nextValue: PurchaseForm[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  const species = Object.keys(VARIETIES);
  const speciesSelection = species.includes(value.crop) ? value.crop : value.crop ? OTHER : "";
  const varietyOptions = VARIETIES[speciesSelection] || [];
  const varietySelection = varietyOptions.includes(value.variety) ? value.variety : value.variety ? OTHER : "";

  function selectSpecies(nextSpecies: string) {
    if (nextSpecies === OTHER) onChange({ ...value, crop: "Otra", variety: "" });
    else onChange({ ...value, crop: nextSpecies, variety: "" });
  }

  return (
    <div className="purchase-fields">
      <div className="field-section-heading">
        <span>1</span>
        <div><strong>Agricultor y finca</strong><small>Identificación del proveedor y origen de la fruta</small></div>
      </div>
      <div className="two-columns">
        <label className="field"><span>N.º de expediente</span><input disabled={disabled} value={value.id} onChange={(event) => update("id", event.target.value)} placeholder="Se genera automáticamente" /></label>
        <label className="field required-field"><span>Agricultor / proveedor</span><input required disabled={disabled} value={value.provider} onChange={(event) => update("provider", event.target.value)} placeholder="Nombre o razón social" /></label>
        <label className="field"><span>NIF / CIF</span><input disabled={disabled} value={value.taxId} onChange={(event) => update("taxId", event.target.value)} placeholder="Documento fiscal" /></label>
        <label className="field required-field"><span>Finca / parcela</span><input required disabled={disabled} value={value.farm} onChange={(event) => update("farm", event.target.value)} placeholder="Nombre o referencia SIGPAC" /></label>
        <label className="field required-field"><span>Municipio</span><input required disabled={disabled} value={value.municipality} onChange={(event) => update("municipality", event.target.value)} placeholder="Localidad" /></label>
        <label className="field required-field"><span>Campaña</span><input required disabled={disabled} value={value.campaign} onChange={(event) => update("campaign", event.target.value)} placeholder="2026/27" /></label>
      </div>

      <div className="field-section-heading section-divider">
        <span>2</span>
        <div><strong>Materia prima</strong><small>Especie, variedad y volumen previsto</small></div>
      </div>
      <div className="three-columns">
        <label className="field required-field"><span>Especie</span><select required disabled={disabled} value={speciesSelection} onChange={(event) => selectSpecies(event.target.value)}><option value="">Seleccionar especie</option>{species.map((item) => <option key={item} value={item}>{item}</option>)}<option value={OTHER}>Otra especie</option></select></label>
        {speciesSelection === OTHER && <label className="field required-field custom-material-field"><span>Indica la especie</span><input required disabled={disabled} value={value.crop === "Otra" ? "" : value.crop} onChange={(event) => update("crop", event.target.value)} placeholder="Escribe la especie" /></label>}
        <label className="field required-field"><span>Variedad</span><select required disabled={disabled || !value.crop} value={varietySelection} onChange={(event) => update("variety", event.target.value === OTHER ? "Otra" : event.target.value)}><option value="">Seleccionar variedad</option>{varietyOptions.map((item) => <option key={item} value={item}>{item}</option>)}<option value={OTHER}>Otra variedad</option></select></label>
        {varietySelection === OTHER && <label className="field required-field custom-material-field"><span>Indica la variedad</span><input required disabled={disabled} value={value.variety === "Otra" ? "" : value.variety} onChange={(event) => update("variety", event.target.value)} placeholder="Escribe la variedad" /></label>}
        <label className="field required-field"><span>Kg previstos</span><input required disabled={disabled} type="number" min="0.01" step="0.01" inputMode="decimal" value={value.expectedKg} onChange={(event) => update("expectedKg", event.target.value)} placeholder="0" /></label>
      </div>

      <div className="field-section-heading section-divider">
        <span>3</span>
        <div><strong>Rellenar contrato</strong><small>Preparación, vigencia y acuerdos de la compra</small></div>
      </div>
      <div className="contract-workflow" aria-label="Flujo del contrato">
        <span className="active">Rellenar datos</span><i>→</i><span>Revisar</span><i>→</i><span>Firmar</span><i>→</i><span>Descargar</span>
      </div>
      <div className="three-columns">
        <label className="field required-field"><span>Estado del contrato</span><select required disabled={disabled} value={value.contractSigned} onChange={(event) => update("contractSigned", event.target.value)}><option value="">Seleccionar</option><option>Pendiente de cumplimentar</option><option>Pendiente de firma</option><option value="Sí">Firmado</option></select></label>
        <label className="field required-field"><span>Inicio del contrato</span><input required disabled={disabled} type="date" value={value.contractStart} onChange={(event) => update("contractStart", event.target.value)} /></label>
        <label className="field required-field"><span>Fin del contrato</span><input required disabled={disabled} type="date" min={value.contractStart || undefined} value={value.contractEnd} onChange={(event) => update("contractEnd", event.target.value)} /></label>
      </div>
      <div className="two-columns optional-fields">
        <label className="field"><span>Ruta o enlace de documentos</span><input disabled={disabled} value={value.documentPath} onChange={(event) => update("documentPath", event.target.value)} placeholder="Carpeta, enlace o referencia" /></label>
        <label className="field"><span>Otros acuerdos</span><textarea disabled={disabled} value={value.otherAgreements} onChange={(event) => update("otherAgreements", event.target.value)} placeholder="Condiciones adicionales de la compra" /></label>
      </div>
    </div>
  );
}
