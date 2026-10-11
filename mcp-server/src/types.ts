export type Operator = ">" | "<" | ">=" | "<=" | "=";

export interface AmountFilter {
  operator: Operator;
  amount: number;
}

export type SortField = "date" | "amount" | "createdAt";
export type SortOrder = "asc" | "desc";

export interface SortOption {
  orderField: SortField;
  ordering: SortOrder;
}

export type TransactionStatus = "active" | "hidden" | "deleted";

export interface TransactionFilter {
  startDate?: string;
  endDate?: string;
  searchText?: string;
  searchPatterns?: string[];
  merchants?: string[];
  amountFilters?: AmountFilter[];
  sort?: SortOption;
  accountId?: number;
  limit?: number;
  cursor?: string;
  pending?: boolean;
  status?: TransactionStatus[];
  fields?: string[];
}

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
  syncError: { message: string; lastFailedAt: string } | null;
  isSyncing: boolean;
  connectionId: number;
  provider: "plaid" | "mx" | "quiltt";
  status: "active" | "hidden";
}

export interface ReconnectLink {
  url: string;
  expiresAt: string;
  accountId: number;
  institutionName: string | null;
  provider: "plaid" | "quiltt";
}

export interface ApiTransaction {
  id: number;
  userId: string;
  accountId: number;
  providerTransactionId: string;
  name: string;
  amount: number;
  isoCurrencyCode: string | null;
  date: string;
  authorizedDate: string | null;
  pending: boolean;
  merchantName: string | null;
  status: TransactionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GetTransactionsResponse {
  transactions: ApiTransaction[];
}

export interface QueryTransactionsResponse {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface QueryTransactionsErrorResponse {
  error: string;
}
