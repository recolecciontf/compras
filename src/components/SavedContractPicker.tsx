import { useId, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { savedContractResults, type SavedContractOption } from "../lib/savedContractSearch";

export function SavedContractPicker({ options, value, onChange, label, placeholder, required = false, disabled = false,
  searchPlaceholder = "Agricultor, finca o referencia", initialQuery = "" }: {
  options: SavedContractOption[]; value: string; onChange: (value: string) => void; label: string; placeholder: string;
  required?: boolean; disabled?: boolean; searchPlaceholder?: string; initialQuery?: string;
}) {
  const searchId = useId();
  const resultsId = useId();
  const [query, setQuery] = useState(initialQuery);
  const { matches, selectedOutsideResults } = savedContractResults(options, query, value);
  return <div className="saved-contract-picker">
    <div className="field">
      <label htmlFor={searchId}>Buscar contrato</label>
      <div className="saved-contract-search-control">
        <Search size={18} aria-hidden="true" />
        <input id={searchId} type="search" value={query} disabled={disabled} autoComplete="off" placeholder={searchPlaceholder}
          aria-describedby={resultsId} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
        {query && <button type="button" aria-label="Limpiar búsqueda de contratos" disabled={disabled} onClick={() => setQuery("")}><X size={17} /></button>}
      </div>
    </div>
    <label className={`field${required ? " required-field" : ""}`}>
      <span>{label}</span>
      <div className="saved-contract-select-control">
        <select required={required} disabled={disabled} value={value} onChange={event => onChange(event.target.value)}>
          <option value="">{matches.length || selectedOutsideResults ? placeholder : query.trim() ? "No hay contratos coincidentes" : placeholder}</option>
          {selectedOutsideResults && <optgroup label="Contrato seleccionado"><option value={selectedOutsideResults.value}>{selectedOutsideResults.label}</option></optgroup>}
          {matches.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <ChevronDown size={18} aria-hidden="true" />
      </div>
    </label>
    <small id={resultsId} role="status" aria-live="polite">{query.trim() ? `${matches.length} de ${options.length} contrato${options.length === 1 ? "" : "s"}` : `${options.length} contrato${options.length === 1 ? "" : "s"} guardado${options.length === 1 ? "" : "s"}`}</small>
  </div>;
}
