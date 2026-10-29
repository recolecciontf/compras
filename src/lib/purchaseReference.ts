import type { PurchaseForm } from "../types";

export function withNewPurchaseReference(
  purchase: PurchaseForm,
  id: string,
  mode: "existing" | "generated" | "unsigned",
): PurchaseForm {
  return {
    ...purchase,
    id,
    contractDetails: {
      ...purchase.contractDetails,
      // Importing supplies the data, not the number of a newly issued contract.
      // Only an already signed document keeps its original legal reference.
      contractNumber: mode === "existing" ? purchase.contractDetails.contractNumber || id : id,
    },
  };
}
