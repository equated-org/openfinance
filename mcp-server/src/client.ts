import type {
  ConnectedAccount,
  GetTransactionsResponse,
  QueryTransactionsResponse,
  QueryTransactionsErrorResponse,
  ReconnectLink,
  TransactionFilter,
} from "./types.js";

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class OpenFinanceClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  async getAccounts(): Promise<{ accounts: ConnectedAccount[] }> {
    return this.request("/api/accounts");
  }

  async getTransactions(
    filter?: TransactionFilter,
  ): Promise<GetTransactionsResponse> {
    const params: Record<string, string> = {};
    if (filter?.startDate) params.startDate = filter.startDate;
    if (filter?.endDate) params.endDate = filter.endDate;
    if (filter?.searchText) params.search = filter.searchText;
    if (filter?.merchants?.length)
      params.merchants = filter.merchants.join(",");
    if (filter?.accountId !== undefined)
      params.accountId = String(filter.accountId);
    if (filter?.limit !== undefined) params.limit = String(filter.limit);
    if (filter?.cursor) params.cursor = filter.cursor;
    if (filter?.pending !== undefined) params.pending = String(filter.pending);
    if (filter?.status?.length) params.status = filter.status.join(",");
    if (filter?.fields?.length) params.fields = filter.fields.join(",");
    if (filter?.amountFilters?.length)
      params.amountFilters = JSON.stringify(filter.amountFilters);

    return this.request("/api/transactions", params);
  }

  async queryTransactions(
    sql: string,
  ): Promise<QueryTransactionsResponse | QueryTransactionsErrorResponse> {
    const res = await fetch(`${this.baseUrl}/api/transactions/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql }),
    });

    return res.json() as Promise<
      QueryTransactionsResponse | QueryTransactionsErrorResponse
    >;
  }

  async createReconnectLink(accountId: number): Promise<ReconnectLink> {
    const res = await fetch(
      `${this.baseUrl}/api/accounts/${accountId}/reconnect-link`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<ReconnectLink>;
  }
}
