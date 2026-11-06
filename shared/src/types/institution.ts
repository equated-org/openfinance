export type SyncProvider = "plaid" | "mx" | "quiltt";

/**
 * Providers whose institution catalogs the search serves. Quiltt has none
 * here: the picker opens Quiltt's connector on its own search instead.
 */
export type CatalogProvider = Exclude<SyncProvider, "quiltt">;

export interface InstitutionType {
  id: string;
  name: string;
  logo?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  url?: string | null;
  plaidData?: {
    institutionId: string;
    countryCodes: string[];
    oauth: boolean;
    products: string[];
    routingNumbers: string[];
  } | null;
  mxData?: {
    institutionCode: string;
    name: string;
    url?: string | null;
    smallLogoUrl?: string | null;
    mediumLogoUrl?: string | null;
    supportsAccountIdentification?: boolean;
    supportsTransactionHistory?: boolean;
    supportsAccountStatement?: boolean;
    supportsAccountVerification?: boolean;
  } | null;
  /** The catalogs it can be connected through; search returns at least one. */
  providers: CatalogProvider[];
}

export interface SearchInstitutionsResponse {
  institutions: InstitutionType[];
}
