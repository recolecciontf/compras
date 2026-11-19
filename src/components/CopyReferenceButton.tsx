import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyReference } from "../lib/copyReference";

export function CopyReferenceButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setCopied(false); setError(""); }, [value]);
  async function copy() {
    setError("");
    try { await copyReference(value); setCopied(true); }
    catch { setCopied(false); setError("No se ha podido copiar. Selecciona la referencia y cópiala manualmente."); }
  }
  return <span className="copy-reference-control">
    <button type="button" className="text-button" disabled={!value.trim()} onClick={() => void copy()} title={`Copiar referencia del expediente ${value}`}>
      {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Referencia copiada" : "Copiar referencia"}
    </button>
    {copied && <span role="status" className="copy-reference-status">{value}</span>}
    {error && <small role="alert">{error}</small>}
  </span>;
}
