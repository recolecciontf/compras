import { AlertTriangle, ArrowLeft, CheckCircle2, CircleCheck, Download, FileCheck2, FileText, FileUp, PenLine, PlusCircle, Send, ShoppingBasket } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { purchaseFromRow } from "../lib/workbook";
import type { ContractOutputFormat, ContractSignatures, ControlRow, PurchaseForm } from "../types";
import { EMPTY_PURCHASE, PurchaseFields } from "./PurchaseFields";
import { SignaturePad } from "./SignaturePad";

export type PreviousContractReference =
  | { mode: "none" }
  | { mode: "archived"; purchaseId: string; archiveId: string; filename: string }
  | { mode: "uploaded"; file: File };

export type ContractSubmission =
  | { mode: "existing"; file: File; previousContract: PreviousContractReference }
  | { mode: "generated"; signatures: ContractSignatures; previousContract: PreviousContractReference; format: ContractOutputFormat }
  | { mode: "unsigned"; previousContract: PreviousContractReference; format: ContractOutputFormat };

type PurchaseStartMode = "" | "new" | "import";
type ContractChoice = "" | "existing" | "generated";
type SignatureChoice = "" | "now" | "later";
type ReuseChoice = "" | "yes" | "no";
type PreviousSource = "" | "saved" | "upload";

type Props = {
  saving: boolean;
  rows: ControlRow[];
  onCreate: (purchase: PurchaseForm, contract: ContractSubmission) => Promise<void>;
  onPreviousContractDownload: (archiveId: string) => Promise<void>;
  onBack: () => void;
};

function blankGeneratedPurchase(previousContractMode: "" | "none" | "archived" | "uploaded" = "") {
  const next = structuredClone(EMPTY_PURCHASE);
  next.contractSigned = "Pendiente de firma";
  next.contractDetails.contractOrigin = "generated";
  next.contractDetails.previousContractMode = previousContractMode;
  return next;
}

export function NewPurchasePanel({ saving, rows, onCreate, onPreviousContractDownload, onBack }: Props) {
  const [purchase, setPurchase] = useState<PurchaseForm>(() => structuredClone(EMPTY_PURCHASE));
  const [purchaseStartMode, setPurchaseStartMode] = useState<PurchaseStartMode>("");
  const [selectedImportedRow, setSelectedImportedRow] = useState("");
  const [contractChoice, setContractChoice] = useState<ContractChoice>("");
  const [signatureChoice, setSignatureChoice] = useState<SignatureChoice>("");
  const [reuseChoice, setReuseChoice] = useState<ReuseChoice>("");
  const [previousSource, setPreviousSource] = useState<PreviousSource>("");
  const [selectedPreviousRow, setSelectedPreviousRow] = useState("");
  const [previousFile, setPreviousFile] = useState<File | null>(null);
  const [existingFile, setExistingFile] = useState<File | null>(null);
  const [sellerSignature, setSellerSignature] = useState("");
  const [consent, setConsent] = useState(false);
  const [outputFormat, setOutputFormat] = useState<ContractOutputFormat>("pdf");
  const [formError, setFormError] = useState("");

  const savedContracts = useMemo(() => rows
    .map((row) => ({ row, purchase: purchaseFromRow(row) }))
    .filter(({ purchase: previous }) => Boolean(previous.contractDetails.archiveId))
    .sort((left, right) => right.row.tableIndex - left.row.tableIndex), [rows]);
  const importablePurchases = useMemo(() => rows
    .map((row) => ({ row, purchase: purchaseFromRow(row) }))
    .sort((left, right) => right.row.tableIndex - left.row.tableIndex), [rows]);

  const selectedSavedContract = savedContracts.find(({ row }) => String(row.tableIndex) === selectedPreviousRow);
  const selectedImportedPurchase = importablePurchases.find(({ row }) => String(row.tableIndex) === selectedImportedRow);
  const purchaseStartReady = purchaseStartMode === "new" || (purchaseStartMode === "import" && Boolean(selectedImportedPurchase));
  const reuseReady = reuseChoice === "no"
    || (reuseChoice === "yes" && previousSource === "saved" && Boolean(selectedSavedContract))
    || (reuseChoice === "yes" && previousSource === "upload" && Boolean(previousFile));
  const contractFormReady = contractChoice === "existing"
    || (contractChoice === "generated" && (purchaseStartMode === "import" || reuseReady));

  function choosePurchaseStart(mode: Exclude<PurchaseStartMode, "">) {
    setPurchaseStartMode(mode);
    setSelectedImportedRow("");
    setContractChoice("");
    setReuseChoice("");
    setPreviousSource("");
    setSelectedPreviousRow("");
    setPreviousFile(null);
    setExistingFile(null);
    setSignatureChoice("");
    setSellerSignature("");
    setConsent(false);
    setOutputFormat("pdf");
    setFormError("");
    setPurchase(structuredClone(EMPTY_PURCHASE));
  }

  function importPurchase(rowIndex: string) {
    setSelectedImportedRow(rowIndex);
    setContractChoice("");
    setReuseChoice("");
    setSignatureChoice("");
    setFormError("");
    const selected = importablePurchases.find(({ row }) => String(row.tableIndex) === rowIndex);
    if (!selected) {
      setPurchase(structuredClone(EMPTY_PURCHASE));
      return;
    }
    const previous = selected.purchase;
    const previousContract = previous.contractDetails;
    setPurchase({
      ...structuredClone(previous),
      id: "",
      materials: previous.materials.map((material) => ({ ...material, id: crypto.randomUUID() })),
      registeredIca: "Pendiente",
      contractSigned: "",
      documentPath: "",
      contractDetails: {
        ...structuredClone(previousContract),
        contractOrigin: "",
        signatureDate: EMPTY_PURCHASE.contractDetails.signatureDate,
        contractNumber: "",
        archiveId: "",
        archiveFilename: "",
        archivedAt: "",
        emailStatus: "",
        sellerSignedAt: "",
        buyerSignedAt: "",
        signatureMethod: "",
        archiveHistoryJson: "",
        previousContractMode: previousContract.archiveId ? "archived" : "none",
        previousContractPurchaseId: previous.id,
        previousContractArchiveId: "",
        previousContractSourceArchiveId: previousContract.archiveId,
        previousContractFilename: previousContract.archiveFilename,
        previousContractStoredAt: "",
      },
    });
  }

  function chooseContract(mode: Exclude<ContractChoice, "">) {
    setContractChoice(mode);
    setSignatureChoice("");
    setReuseChoice(purchaseStartMode === "import" && mode === "generated" ? "no" : "");
    setPreviousSource("");
    setSelectedPreviousRow("");
    setPreviousFile(null);
    setExistingFile(null);
    setSellerSignature("");
    setConsent(false);
    setFormError("");
    const existing = mode === "existing";
    setPurchase((current) => ({
      ...current,
      contractSigned: existing ? "Sí" : "Pendiente de firma",
      contractDetails: {
        ...current.contractDetails,
        contractOrigin: existing ? "existing" : "generated",
        signatureMethod: existing ? "uploaded" : "",
        sellerSignedAt: "",
        buyerSignedAt: "",
      },
    }));
  }

  function chooseReuse(mode: Exclude<ReuseChoice, "">) {
    setReuseChoice(mode);
    setPreviousSource("");
    setSelectedPreviousRow("");
    setPreviousFile(null);
    setSignatureChoice("");
    setFormError("");
    setPurchase(blankGeneratedPurchase(mode === "no" ? "none" : ""));
  }

  function choosePreviousSource(source: Exclude<PreviousSource, "">) {
    setPreviousSource(source);
    setSelectedPreviousRow("");
    setPreviousFile(null);
    setSignatureChoice("");
    setFormError("");
    setPurchase(blankGeneratedPurchase(source === "upload" ? "uploaded" : "archived"));
  }

  function applySavedContract(rowIndex: string) {
    setSelectedPreviousRow(rowIndex);
    setSignatureChoice("");
    setFormError("");
    const selected = savedContracts.find(({ row }) => String(row.tableIndex) === rowIndex);
    if (!selected) {
      setPurchase(blankGeneratedPurchase("archived"));
      return;
    }
    const previous = selected.purchase;
    const previousContract = previous.contractDetails;
    const materials = previous.materials.map((material) => ({
      ...material,
      id: crypto.randomUUID(),
      expectedKg: "",
    }));
    setPurchase((current) => ({
      ...current,
      provider: previous.provider,
      taxId: previous.taxId,
      farm: previous.farm,
      municipality: previous.municipality,
      crop: previous.crop,
      variety: previous.variety,
      expectedKg: "",
      materials,
      contractSigned: "Pendiente de firma",
      contractStart: "",
      contractEnd: "",
      documentPath: "",
      otherAgreements: "",
      registeredIca: "Pendiente",
      contractDetails: {
        ...current.contractDetails,
        contractOrigin: "generated",
        buyerCompany: previousContract.buyerCompany,
        contractNumber: "",
        sellerRepresentative: previousContract.sellerRepresentative,
        sellerDni: previousContract.sellerDni,
        sellerAddress: previousContract.sellerAddress,
        organicOperatorCode: previousContract.organicOperatorCode,
        certifierCode: previousContract.certifierCode,
        ailimpoRegepaCode: previousContract.ailimpoRegepaCode,
        modality: previousContract.modality || "A KILOS",
        collectionBy: previousContract.collectionBy || "Comprador",
        transportBy: previousContract.transportBy || "Comprador",
        pricePerKg: "",
        totalPrice: "",
        ivaPercent: previousContract.ivaPercent,
        irpfPercent: previousContract.irpfPercent,
        advancePayment: "",
        paymentDays: previousContract.paymentDays || "30",
        insuranceProvider: previousContract.insuranceProvider || "Agroseguro",
        insurancePolicy: "",
        applyDestrio: "No",
        destrioLocation: "",
        destrioDefects: "",
        destrioPrice: "",
        sellerEmail: previousContract.sellerEmail,
        companyEmail: previousContract.companyEmail,
        buyerRepresentative: "",
        archiveId: "",
        archiveFilename: "",
        archivedAt: "",
        emailStatus: "",
        sellerSignedAt: "",
        buyerSignedAt: "",
        signatureMethod: "",
        archiveHistoryJson: "",
        previousContractMode: "archived",
        previousContractPurchaseId: previous.id,
        previousContractArchiveId: "",
        previousContractSourceArchiveId: previousContract.archiveId,
        previousContractFilename: previousContract.archiveFilename,
        previousContractStoredAt: "",
      },
    }));
  }

  function previousContractReference(): PreviousContractReference {
    if (purchaseStartMode === "import" && selectedImportedPurchase?.purchase.contractDetails.archiveId) {
      return {
        mode: "archived",
        purchaseId: selectedImportedPurchase.purchase.id,
        archiveId: selectedImportedPurchase.purchase.contractDetails.archiveId,
        filename: selectedImportedPurchase.purchase.contractDetails.archiveFilename,
      };
    }
    if (reuseChoice !== "yes") return { mode: "none" };
    if (previousSource === "saved" && selectedSavedContract) {
      return {
        mode: "archived",
        purchaseId: selectedSavedContract.purchase.id,
        archiveId: selectedSavedContract.purchase.contractDetails.archiveId,
        filename: selectedSavedContract.purchase.contractDetails.archiveFilename,
      };
    }
    if (previousSource === "upload" && previousFile) return { mode: "uploaded", file: previousFile };
    return { mode: "none" };
  }

  function chooseSignature(mode: Exclude<SignatureChoice, "">) {
    setSignatureChoice(mode);
    setFormError("");
    if (mode === "later") {
      setSellerSignature("");
      setConsent(false);
    }
    setPurchase((current) => ({
      ...current,
      contractSigned: mode === "later" ? "Pendiente de firma del vendedor" : "Pendiente de firma del comprador",
      contractDetails: {
        ...current.contractDetails,
        signatureMethod: mode === "later" ? "external_pending" : "in_app",
        sellerSignedAt: "",
        buyerSignedAt: "",
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
      await onCreate({ ...purchase, contractSigned: "Sí" }, { mode: "existing", file: existingFile, previousContract: { mode: "none" } });
      return;
    }
    if (!reuseReady) {
      setFormError("Indica si quieres reutilizar un contrato anterior y selecciona su origen.");
      return;
    }
    const previousContract = previousContractReference();
    const { pricePerKg, totalPrice } = purchase.contractDetails;
    if ((!pricePerKg && !totalPrice) || (pricePerKg && totalPrice)) {
      setFormError("Indica un solo tipo de precio: precio por kg o precio total.");
      return;
    }
    if (!signatureChoice) {
      setFormError("Indica si el agricultor firma ahora o firmará el contrato más tarde.");
      return;
    }
    if (signatureChoice === "later") {
      await onCreate({
        ...purchase,
        contractSigned: "Pendiente de firma del vendedor",
        contractDetails: {
          ...purchase.contractDetails,
          contractOrigin: "generated",
          sellerSignedAt: "",
          buyerSignedAt: "",
          signatureMethod: "external_pending",
        },
      }, { mode: "unsigned", previousContract, format: outputFormat });
      return;
    }
    if (!sellerSignature || !consent) {
      setFormError("El vendedor debe firmar y aceptar la confirmación de firma.");
      return;
    }
    const signedAt = new Date().toISOString();
    const signatures: ContractSignatures = {
      sellerDataUrl: sellerSignature,
      sellerName: purchase.contractDetails.sellerRepresentative || purchase.provider,
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
    }, { mode: "generated", signatures, previousContract, format: outputFormat });
  }

  return (
    <form className="review-form new-purchase-form" onSubmit={submit}>
      <div className="review-header">
        <button className="back-button mobile-back" type="button" onClick={onBack}><ArrowLeft size={20} /> Compras</button>
        <div className="page-kicker"><ShoppingBasket size={18} /> Asistente de nueva compra</div>
        <h2 className="page-title">Realizar compra nueva</h2>
        <p className="page-subtitle">Puedes archivar un contrato ya firmado, recoger la firma del agricultor en campo o descargarlo para enviárselo y adjuntarlo cuando lo devuelva firmado.</p>
      </div>

      <section className="contract-first-step" aria-labelledby="purchase-start-question">
        <span className="wizard-step-label">Paso 1 · Inicio</span>
        <h3 id="purchase-start-question">¿Cómo quieres crear la compra?</h3>
        <p>Empieza desde cero o importa una compra anterior para recuperar todos sus datos.</p>
        <div className="contract-choice-grid">
          <button type="button" className={purchaseStartMode === "new" ? "selected" : ""} onClick={() => choosePurchaseStart("new")}>
            <PlusCircle size={24} /><span><strong>Compra desde cero</strong><small>Introducir una compra nueva</small></span>{purchaseStartMode === "new" && <CheckCircle2 size={20} />}
          </button>
          <button type="button" className={purchaseStartMode === "import" ? "selected" : ""} onClick={() => choosePurchaseStart("import")}>
            <FileText size={24} /><span><strong>Importar compra</strong><small>Reciclar todos los datos de una compra anterior</small></span>{purchaseStartMode === "import" && <CheckCircle2 size={20} />}
          </button>
        </div>
        {purchaseStartMode === "import" && (
          <div className="previous-contract-picker">
            <label className="field required-field">
              <span>Compra que quieres importar</span>
              <select required value={selectedImportedRow} onChange={(event) => importPurchase(event.target.value)}>
                <option value="">Seleccionar compra anterior</option>
                {importablePurchases.map(({ row, purchase: previous }) => (
                  <option key={row.tableIndex} value={row.tableIndex}>{previous.id} · {previous.provider} · {previous.crop}{previous.variety ? ` / ${previous.variety}` : ""}</option>
                ))}
              </select>
            </label>
            {selectedImportedPurchase && <div className="reuse-confirmation"><CheckCircle2 size={18} /><span><strong>Datos importados de {selectedImportedPurchase.purchase.id}</strong><small>Se copian finca, fruta, kilos, fechas, precio, acuerdos y datos del contrato. El nuevo expediente tendrá otro identificador, nuevas firmas y AICA pendiente.</small></span></div>}
          </div>
        )}
      </section>

      {purchaseStartReady && (
        <section className="contract-first-step" aria-labelledby="contract-question">
          <span className="wizard-step-label">Paso 2 · Contrato actual</span>
          <h3 id="contract-question">¿Esta compra ya tiene un contrato firmado?</h3>
          <p>Si todavía no está firmado, completa los datos y decide al final si el agricultor firma ahora o lo hará más tarde.</p>
          <div className="contract-choice-grid">
            <button type="button" className={contractChoice === "existing" ? "selected" : ""} onClick={() => chooseContract("existing")}>
              <FileCheck2 size={24} /><span><strong>Sí, ya está firmado</strong><small>Adjuntar y archivar la copia existente</small></span>{contractChoice === "existing" && <CheckCircle2 size={20} />}
            </button>
            <button type="button" className={contractChoice === "generated" ? "selected" : ""} onClick={() => chooseContract("generated")}>
              <PenLine size={24} /><span><strong>No, hay que prepararlo</strong><small>Rellenar el contrato y decidir la firma al final</small></span>{contractChoice === "generated" && <CheckCircle2 size={20} />}
            </button>
          </div>
          {contractChoice === "generated" && <p className="contract-model-note">Modelos automáticos disponibles: limón, pomelo, naranja, mandarina y uva, según la empresa compradora. Para otra especie, debe incorporarse primero su modelo contractual; nunca se reutilizará un modelo que no corresponda.</p>}
        </section>
      )}

      {purchaseStartMode === "new" && contractChoice === "generated" && (
        <section className="contract-first-step previous-contract-step" aria-labelledby="reuse-contract-question">
          <span className="wizard-step-label">Paso 3 · Contrato anterior</span>
          <h3 id="reuse-contract-question">¿Quieres reciclar un contrato anterior?</h3>
          <p>Se reutilizan los datos estables como agricultor, finca y condiciones habituales. El número, las fechas, los kilos, el precio y las firmas se rellenan de nuevo.</p>
          <div className="contract-choice-grid">
            <button type="button" className={reuseChoice === "no" ? "selected" : ""} onClick={() => chooseReuse("no")}>
              <PlusCircle size={24} /><span><strong>No</strong><small>Rellenar el contrato desde cero</small></span>{reuseChoice === "no" && <CheckCircle2 size={20} />}
            </button>
            <button type="button" className={reuseChoice === "yes" ? "selected" : ""} onClick={() => chooseReuse("yes")}>
              <FileText size={24} /><span><strong>Sí</strong><small>Elegir o subir un contrato anterior</small></span>{reuseChoice === "yes" && <CheckCircle2 size={20} />}
            </button>
          </div>
          {reuseChoice === "yes" && <>
            <div className="contract-choice-grid previous-source-grid">
              <button type="button" className={previousSource === "saved" ? "selected" : ""} onClick={() => choosePreviousSource("saved")}>
                <FileCheck2 size={22} /><span><strong>Está guardado</strong><small>Seleccionar del archivo central</small></span>{previousSource === "saved" && <CheckCircle2 size={18} />}
              </button>
              <button type="button" className={previousSource === "upload" ? "selected" : ""} onClick={() => choosePreviousSource("upload")}>
                <FileUp size={22} /><span><strong>No está guardado</strong><small>Subir el contrato anterior</small></span>{previousSource === "upload" && <CheckCircle2 size={18} />}
              </button>
            </div>
            {previousSource === "saved" && (
              <div className="previous-contract-picker">
                <label className="field required-field">
                  <span>Contrato anterior guardado</span>
                  <select required value={selectedPreviousRow} onChange={(event) => applySavedContract(event.target.value)}>
                    <option value="">Seleccionar contrato</option>
                    {savedContracts.map(({ row, purchase: previous }) => (
                      <option key={row.tableIndex} value={row.tableIndex}>{previous.id} · {previous.provider} · {previous.crop}{previous.variety ? ` / ${previous.variety}` : ""}</option>
                    ))}
                  </select>
                </label>
                {!savedContracts.length && <div className="contract-send-warning"><AlertTriangle size={18} /><span><strong>No hay contratos archivados</strong><small>Elige “No está guardado” para subir el PDF anterior.</small></span></div>}
                {selectedSavedContract && <div className="reuse-confirmation"><CheckCircle2 size={18} /><span><strong>Datos recuperados de {selectedSavedContract.purchase.id}</strong><small>Revisa los campos antes de generar el contrato nuevo.</small></span><button className="text-button" type="button" disabled={saving} onClick={() => void onPreviousContractDownload(selectedSavedContract.purchase.contractDetails.archiveId)}><Download size={16} /> Revisar PDF</button></div>}
              </div>
            )}
            {previousSource === "upload" && (
              <label className="file-drop-field previous-contract-upload">
                <input required type="file" accept=".pdf,application/pdf" onChange={(event) => setPreviousFile(event.target.files?.[0] || null)} />
                <span>{previousFile ? previousFile.name : "Seleccionar contrato anterior en PDF"}</span>
              </label>
            )}
          </>}
        </section>
      )}

      {contractFormReady && <>
        <div className="required-intro">
          <CircleCheck size={20} />
          <div><strong>Datos necesarios antes de crear la compra</strong><span>Los campos marcados con * son obligatorios. AICA y el resto de controles se validan posteriormente, antes del corte.</span></div>
        </div>

        <fieldset className="purchase-fieldset" disabled={saving}>
          <PurchaseFields value={purchase} onChange={setPurchase} contractMode={contractChoice === "existing" ? "existing" : signatureChoice === "later" ? "unsigned" : "generated"} />
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
            <div className="signature-section-heading"><span className="wizard-step-label">Firma y descarga</span><h3>Firma del vendedor / agricultor</h3><p>Elige cómo se firmará y si quieres descargar el contrato en PDF o Word.</p></div>
            <div className="contract-choice-grid signature-choice-grid" role="group" aria-label="Momento de la firma del agricultor">
              <button type="button" className={signatureChoice === "now" ? "selected" : ""} onClick={() => chooseSignature("now")}>
                <PenLine size={24} /><span><strong>Firmar ahora</strong><small>El agricultor firma en el recuadro</small></span>{signatureChoice === "now" && <CheckCircle2 size={20} />}
              </button>
              <button type="button" className={signatureChoice === "later" ? "selected" : ""} onClick={() => chooseSignature("later")}>
                <Send size={24} /><span><strong>Firmar más tarde</strong><small>Descargar y enviar el contrato sin firmas</small></span>{signatureChoice === "later" && <CheckCircle2 size={20} />}
              </button>
            </div>
            <div className="contract-output-format">
              <strong>Formato de descarga</strong>
              <div className="contract-choice-grid signature-choice-grid" role="group" aria-label="Formato de descarga del contrato">
                <button type="button" className={outputFormat === "pdf" ? "selected" : ""} onClick={() => setOutputFormat("pdf")}>
                  <Download size={22} /><span><strong>PDF</strong><small>Formato estable para enviar y firmar</small></span>{outputFormat === "pdf" && <CheckCircle2 size={18} />}
                </button>
                <button type="button" className={outputFormat === "docx" ? "selected" : ""} onClick={() => setOutputFormat("docx")}>
                  <FileText size={22} /><span><strong>Word</strong><small>Documento DOCX para revisar en oficina</small></span>{outputFormat === "docx" && <CheckCircle2 size={18} />}
                </button>
              </div>
            </div>
            {signatureChoice === "now" && <>
              <div className="signature-grid">
                <SignaturePad label="Firma del vendedor / agricultor" disabled={saving} onChange={setSellerSignature} />
              </div>
              <label className="signature-consent"><input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Confirmo que el vendedor ha revisado el contrato, acepta su contenido y firma de forma voluntaria.</span></label>
              <p className="signature-legal-note">La aplicación registra fecha, firmantes y copia exacta del documento. Esta firma manuscrita electrónica no sustituye a una firma electrónica cualificada cuando esta sea legalmente exigible.</p>
            </>}
            {signatureChoice === "later" && <div className="contract-send-warning"><AlertTriangle size={20} /><span><strong>Pendiente de firma y sin autorización de recolección</strong><small>Se descargará el contrato en {outputFormat === "pdf" ? "PDF" : "Word"} sin firmas. Envíalo al agricultor y, cuando lo devuelva firmado, abre el expediente y adjunta la copia definitiva en PDF. Después se completará la firma de la empresa y la validación en AICA.</small></span></div>}
          </section>
        )}

        {formError && <div className="inline-form-error" role="alert"><AlertTriangle size={18} />{formError}</div>}

        <div className="form-actions single-action">
          <button className="primary-button" type="submit" disabled={saving}>
            <PlusCircle size={19} /> {saving
              ? contractChoice === "existing" ? "Archivando contrato y creando compra…" : `Generando ${outputFormat === "pdf" ? "PDF" : "Word"} y creando compra…`
              : contractChoice === "existing" ? "Archivar contrato y crear compra" : signatureChoice === "later" ? `Descargar ${outputFormat === "pdf" ? "PDF" : "Word"} y crear compra` : `Generar ${outputFormat === "pdf" ? "PDF" : "Word"} y crear compra`}
          </button>
        </div>
      </>}
    </form>
  );
}
