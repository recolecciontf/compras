import { ArrowLeft, CircleCheck, PlusCircle, ShoppingBasket } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PurchaseForm } from "../types";
import { EMPTY_PURCHASE, PurchaseFields } from "./PurchaseFields";

type Props = {
  saving: boolean;
  onCreate: (purchase: PurchaseForm) => Promise<void>;
  onBack: () => void;
};

export function NewPurchasePanel({ saving, onCreate, onBack }: Props) {
  const [purchase, setPurchase] = useState<PurchaseForm>({ ...EMPTY_PURCHASE });

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onCreate(purchase);
  }

  return (
    <form className="review-form new-purchase-form" onSubmit={submit}>
      <div className="review-header">
        <button className="back-button mobile-back" type="button" onClick={onBack}><ArrowLeft size={20} /> Compras</button>
        <div className="page-kicker"><ShoppingBasket size={18} /> Alta de compra</div>
        <h2 className="page-title">Nueva compra de campo</h2>
        <p className="page-subtitle">Registra al agricultor, la materia prima y el contrato. El expediente se crea bloqueado hasta completar toda la documentación.</p>
      </div>

      <div className="required-intro">
        <CircleCheck size={20} />
        <div><strong>Datos necesarios para crear la compra</strong><span>Los campos marcados con * son obligatorios y están siempre visibles. El número de expediente se genera automáticamente.</span></div>
      </div>

      <fieldset className="purchase-fieldset" disabled={saving}>
        <PurchaseFields value={purchase} onChange={setPurchase} />
      </fieldset>

      <div className="form-actions single-action">
        <button className="primary-button" type="submit" disabled={saving}>
          <PlusCircle size={19} /> {saving ? "Creando compra…" : "Crear compra"}
        </button>
      </div>
    </form>
  );
}
