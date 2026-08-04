import { normalizeStationPosCatalogResponse } from "./posCatalogCanonical.js"

export {
  buildStationCategoriesFromCatalogProducts,
  deriveProductionAreasFromCatalogProducts,
  isStationOrderOwnedByOperator,
  normalizeStationCatalogProduct,
  normalizeStationPosCatalogResponse,
  productCategoryIdForPos
} from "./posCatalogCanonical.js"

/** @deprecated Use normalizeStationPosCatalogResponse */
export function mapStationPosCatalogResponse(data) {
  return normalizeStationPosCatalogResponse(data)
}
