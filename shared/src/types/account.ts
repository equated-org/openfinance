export interface ConnectedAccount {
  id: number;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: string | null;
  availableBalance: string | null;
  isoCurrencyCode: string | null;
  institutionName: string;
  institutionUrl: string | null;
  /** The institution's own logo image, for when there's no `institutionUrl`
   *  to look one up by. Banks connected through Quiltt have only this. */
  institutionLogoUrl: string | null;
  syncError: { message: string; lastFailedAt: string } | null;
  isSyncing: boolean;
  connectionId: number;
  provider: "plaid" | "mx" | "quiltt";
  quilttConnectionId: string | null;
  status: "active" | "hidden";
}
