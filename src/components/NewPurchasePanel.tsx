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
  const [buyerSignature, setBuyerSignature] = useState("");
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState("");

  function chooseContract(mode: "existing" | "generated") {
    setContractChoice(mode);
    setFormError("");
    setPurchase((current) => ({
      ...current,
      contractSigned: mode === "existing" ? "Sí" : "Pendiente de firma",
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
    if (!sellerSignature || !buyerSignature || !consent) {
      setFormError("Deben firmar el vendedor y el comprador y aceptar la confirmación de firma.");
      return;
    }
    const signedAt = new Date().toISOString();
    const signatures: ContractSignatures = {
      sellerDataUrl: sellerSignature,
      buyerDataUrl: buyerSignature,
      sellerName: purchase.contractDetails.sellerRepresentative,
      buyerName: purchase.contractDetails.buyerRepresentative,
      signedAt,
    };
    await onCreate({
      ...purchase,
      contractSigned: "Sí",
      contractDetails: {
        ...purchase.contractDetails,
        sellerSignedAt: signedAt,
        buyerSignedAt: signedAt,
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
        <p className="page-subtitle">El contrato se comprueba o se firma antes de dar de alta la compra. La validación documental, incluida el alta en ICA, se completa antes de recolectar.</p>
      </div>

      <section className="contract-first-step" aria-labelledby="contract-question">
        <span className="wizard-step-label">Paso previo obligatorio</span>
        <h3 id="contract-question">¿Esta compra ya tiene un contrato firmado?</h3>
        <p>Selecciona una opción para continuar. La compra se creará cuando exista una copia firmada; el archivo central quedará incluido en el checklist previo a la recolección.</p>
        <div className="contract-choice-grid">
          <button type="button" className={contractChoice === "existing" ? "selected" : ""} onClick={() => chooseContract("existing")}>
            <FileCheck2 size={24} /><span><strong>Sí, ya está firmado</strong><small>Adjuntar y archivar la copia existente</small></span>{contractChoice === "existing" && <CheckCircle2 size={20} />}
          </button>
          <button type="button" className={contractChoice === "generated" ? "selected" : ""} onClick={() => chooseContract("generated")}>
            <PenLine size={24} /><span><strong>No, hay que prepararlo</strong><small>Rellenar y firmar dentro de la aplicación</small></span>{contractChoice === "generated" && <CheckCircle2 size={20} />}
          </button>
        </div>
      </section>

      {contractChoice && <>
        <div className="required-intro">
          <CircleCheck size={20} />
          <div><strong>Datos necesarios antes de crear la compra</strong><span>Los campos marcados con * son obligatorios. ICA y el resto de controles se validan posteriormente, antes del corte.</span></div>
        </div>

        <fieldset className="purchase-fieldset" disabled={saving}>
          <PurchaseFields value={purchase} onChange={setPurchase} contractMode={contractChoice} />
        </fieldset>

        {contractChoice === "existing" ? (
          <section className="signed-contract-upload">
            <div><FileUp size={22} /><span><strong>Adjuntar contrato firmado</strong><small>Formatos admitidos: PDF o Word. Máximo 10 MB.</small></span></div>
            <label className="file-drop-field">
              <input required type="file" accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setExistingFile(event.target.files?.[0] || null)} />
              <span>{existingFile ? existingFile.name : "Seleccionar contrato firmado"}</span>
            </label>
          </section>
        ) : (
          <section className="signature-section">
            <div className="signature-section-heading"><span className="wizard-step-label">Firma en la aplicación</span><h3>Firma de ambas partes</h3><p>Las firmas se insertan en la zona prevista del Word junto con la fecha y la identidad declarada.</p></div>
            <div className="signature-grid">
              <SignaturePad label="Firma del vendedor / agricultor" disabled={saving} onChange={setSellerSignature} />
              <SignaturePad label="Firma del comprador / empresa" disabled={saving} onChange={setBuyerSignature} />
            </div>
            <label className="signature-consent"><input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Confirmo que ambas personas han revisado el contrato, aceptan su contenido y realizan la firma de forma voluntaria.</span></label>
            <p className="signature-legal-note">La aplicación registra fecha, firmantes y copia exacta del documento. Esta firma manuscrita electrónica no sustituye a una firma electrónica cualificada cuando esta sea legalmente exigible.</p>
          </section>
        )}

        {formError && <div className="inline-form-error" role="alert"><AlertTriangle size={18} />{formError}</div>}

        <div className="form-actions single-action">
          <button className="primary-button" type="submit" disabled={saving}>
            <PlusCircle size={19} /> {saving ? "Guardando contrato y creando compra…" : "Guardar contrato y crear compra"}
          </button>
        </div>
      </>}
    </form>
  );
}
