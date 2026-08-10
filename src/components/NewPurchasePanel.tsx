import { AlertTriangle, ArrowLeft, CheckCircle2, CircleCheck, FileCheck2, FileUp, PenLine, PlusCircle, ShoppingBasket } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ContractSignatures, PurchaseForm } from "../types";
import { EMPTY_PURCHASE, PurchaseFields } from "./PurchaseFields";
import { SignaturePad } from "./SignaturePad";

export type ContractSubmission =
  | { mode: "existing"; file: File }
  | { mode: "generated"; signatures: ContractSignatures };

type Props = {
  saving: boolean;
  onCreate: (purchase: PurchaseForm, contract: ContractSubmission) => Promise<void>;
  onBack: () => void;
};

export function NewPurchasePanel({ saving, onCreate, onBack }: Props) {
  const [purchase, setPurchase] = useState<PurchaseForm>(() => structuredClone(EMPTY_PURCHASE));
  const [contractChoice, setContractChoice] = useState<"" | "existing" | "generated">("");
  const [existingFile, setExistingFile] = useState<File | null>(null);
  const [sellerSignature, setSellerSignature] = useState("");
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState("");

  function chooseContract(mode: "existing" | "generated") {
    setContractChoice(mode);
    setFormError("");
    setPurchase((current) => ({
      ...current,
      contractSigned: mode === "existing" ? "Sí" : "Pendiente de firma del comprador",
      contractDetails: {
        ...current.contractDetails,
        contractOrigin: mode,
        signatureMethod: mode === "existing" ? "uploaded" : "in_app",
      },
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    if (!contractChoice) {
      setFormError("Indica primero si la compra ya dispone de contrato firmado.");
      return;
    }
    if (contractChoice === "existing") {
      if (!existingFile) {
        setFormError("Adjunta la copia del contrato firmado antes de crear la compra.");
        return;
      }
      await onCreate({ ...purchase, contractSigned: "Sí" }, { mode: "existing", file: existingFile });
      return;
    }
    const { pricePerKg, totalPrice } = purchase.contractDetails;
    if ((!pricePerKg && !totalPrice) || (pricePerKg && totalPrice)) {
      setFormError("Indica un solo tipo de precio: precio por kg o precio total.");
      return;
    }
    if (!sellerSignature || !consent) {
      setFormError("El vendedor debe firmar y aceptar la confirmación de firma.");
      return;
    }
    const signedAt = new Date().toISOString();
    const signatures: ContractSignatures = {
      sellerDataUrl: sellerSignature,
      sellerName: purchase.contractDetails.sellerRepresentative,
      signedAt,
    };
    await onCreate({
      ...purchase,
      contractSigned: "Pendiente de firma del comprador",
      contractDetails: {
        ...purchase.contractDetails,
        sellerSignedAt: signedAt,
        buyerSignedAt: "",
        signatureMethod: "in_app",
      },
    }, { mode: "generated", signatures });
  }

  return (
    <form className="review-form new-purchase-form" onSubmit={submit}>
      <div className="review-header">
        <button className="back-button mobile-back" type="button" onClick={onBack}><ArrowLeft size={20} /> Compras</button>
        <div className="page-kicker"><ShoppingBasket size={18} /> Asistente de nueva compra</div>
        <h2 className="page-title">Realizar compra nueva</h2>
        <p className="page-subtitle">El agricultor puede firmar el contrato en campo. La empresa lo firmará digitalmente en la oficina y después se validará su registro en AICA antes de recolectar.</p>
      </div>

      <section className="contract-first-step" aria-labelledby="contract-question">
        <span className="wizard-step-label">Paso previo obligatorio</span>
        <h3 id="contract-question">¿Esta compra ya tiene un contrato firmado?</h3>
        <p>Selecciona una opción para continuar. Si se genera ahora, se descargará un PDF firmado por el agricultor y quedará pendiente la firma digital de la empresa.</p>
        <div className="contract-choice-grid">
          <button type="button" className={contractChoice === "existing" ? "selected" : ""} onClick={() => chooseContract("existing")}>
            <FileCheck2 size={24} /><span><strong>Sí, ya está firmado</strong><small>Adjuntar y archivar la copia existente</small></span>{contractChoice === "existing" && <CheckCircle2 size={20} />}
          </button>
          <button type="button" className={contractChoice === "generated" ? "selected" : ""} onClick={() => chooseContract("generated")}>
            <PenLine size={24} /><span><strong>No, hay que prepararlo</strong><small>Rellenar y recoger la firma del agricultor</small></span>{contractChoice === "generated" && <CheckCircle2 size={20} />}
          </button>
        </div>
        {contractChoice === "generated" && <p className="contract-model-note">Modelos automáticos disponibles: limón, pomelo, naranja y mandarina, según la empresa compradora. Para otra especie, como fruta de hueso, debe adjuntarse su contrato firmado; nunca se reutilizará un modelo de cítricos.</p>}
      </section>

      {contractChoice && <>
        <div className="required-intro">
          <CircleCheck size={20} />
          <div><strong>Datos necesarios antes de crear la compra</strong><span>Los campos marcados con * son obligatorios. AICA y el resto de controles se validan posteriormente, antes del corte.</span></div>
        </div>

        <fieldset className="purchase-fieldset" disabled={saving}>
          <PurchaseFields value={purchase} onChange={setPurchase} contractMode={contractChoice} />
        </fieldset>

        {contractChoice === "existing" ? (
          <section className="signed-contract-upload">
            <div><FileUp size={22} /><span><strong>Adjuntar contrato firmado</strong><small>Formato PDF. Máximo 10 MB.</small></span></div>
            <label className="file-drop-field">
              <input required type="file" accept=".pdf,application/pdf" onChange={(event) => setExistingFile(event.target.files?.[0] || null)} />
              <span>{existingFile ? existingFile.name : "Seleccionar contrato firmado"}</span>
            </label>
          </section>
        ) : (
          <section className="signature-section">
            <div className="signature-section-heading"><span className="wizard-step-label">Firma en campo</span><h3>Firma del vendedor</h3><p>La firma del agricultor se insertará en el PDF. La zona del comprador quedará libre para la firma digital posterior en la oficina.</p></div>
            <div className="signature-grid">
              <SignaturePad label="Firma del vendedor / agricultor" disabled={saving} onChange={setSellerSignature} />
            </div>
            <label className="signature-consent"><input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Confirmo que el vendedor ha revisado el contrato, acepta su contenido y firma de forma voluntaria.</span></label>
            <p className="signature-legal-note">La aplicación registra fecha, firmantes y copia exacta del documento. Esta firma manuscrita electrónica no sustituye a una firma electrónica cualificada cuando esta sea legalmente exigible.</p>
          </section>
        )}

        {formError && <div className="inline-form-error" role="alert"><AlertTriangle size={18} />{formError}</div>}

        <div className="form-actions single-action">
          <button className="primary-button" type="submit" disabled={saving}>
            <PlusCircle size={19} /> {saving
              ? contractChoice === "existing" ? "Archivando contrato y creando compra…" : "Generando PDF y creando compra…"
              : contractChoice === "existing" ? "Archivar contrato y crear compra" : "Generar PDF y crear compra"}
          </button>
        </div>
      </>}
    </form>
  );
}
