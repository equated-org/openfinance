import { db } from "../../db";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { MxTransactionSyncWorkflow } from "../../workflows/mx-transaction-sync.workflow";
import {
  financialAccounts,
  accountConnections,
  syncJobs,
  institutionRegistry,
  transactions,
} from "../../schema";
import { eq, sql, and, isNull } from "drizzle-orm";
import { user as userTable } from "../../schema";
import type { AccountType } from "$lib/sql/financial-accounts.sql";

// MX API Types
interface MXMember {
  guid: string;
  name?: string;
  connection_status: string;
  institution_code: string;
  is_being_aggregated: boolean;
  successfully_aggregated_at?: string;
  aggregated_at?: string;
}

interface MXAccount {
  guid: string;
  account_number?: string;
  available_balance?: number;
  balance?: number;
  currency_code?: string;
  name: string;
  nickname?: string;
  subtype?: string;
  type: string;
  is_hidden?: boolean;
  is_closed?: boolean;
  updated_at: string;
  user_guid: string;
  member_guid: string;
}

interface MXTransaction {
  account_guid: string;
  amount: number;
  category?: string;
  created_at: string;
  currency_code?: string;
  date: string;
  description: string;
  guid: string;
  id: string;
  memo?: string | null;
  original_description: string;
  status: string;
  type?: string; // CREDIT or DEBIT
  transacted_at?: string;
  updated_at: string;
  user_guid: string;
  member_guid: string;
  check_number_string?: string | null;
}

// Account type mapping from MX to Plaid's standardized system
const MX_TO_PLAID_TYPE_MAP: Record<string, AccountType> = {
  CHECKING: "depository",
  SAVINGS: "depository",
  CASH: "depository",
  PREPAID: "depository",
  CREDIT_CARD: "credit",
  LINE_OF_CREDIT: "credit",
  CHECKING_LINE_OF_CREDIT: "credit",
  MORTGAGE: "loan",
  LOAN: "loan",
  INVESTMENT: "investment",
  PROPERTY: "investment",
  INSURANCE: "investment",
};

function mapMXTypeToPlaidType(
  mxType: string,
  accountName?: string,
): AccountType {
  const upperType = mxType.toUpperCase();

  if (upperType === "ANY" && accountName) {
    const nameLower = accountName.toLowerCase();

    const investmentKeywords = [
      "investment",
      "gic",
      "tfsa",
      "rrsp",
      "rrif",
      "resp",
      "portfolio",
      "brokerage",
      "trading",
      "retirement",
      "401k",
      "ira",
      "roth",
    ];
    if (investmentKeywords.some((k) => nameLower.includes(k)))
      return "investment";

    const loanKeywords = ["loan", "mortgage"];
    if (loanKeywords.some((k) => nameLower.includes(k))) return "loan";

    const creditKeywords = [
      "credit",
      "line of credit",
      "visa",
      "mastercard",
      "amex",
    ];
    if (creditKeywords.some((k) => nameLower.includes(k))) return "credit";

    return "depository";
  }

  return MX_TO_PLAID_TYPE_MAP[upperType] ?? "depository";
}

function getMxConfig() {
  const clientId = process.env.MX_CLIENT_ID;
  const apiKey = process.env.MX_API_KEY;
  const baseUrl = process.env.MX_API_URL;

  if (!clientId || !apiKey || !baseUrl) {
    throw new Error(
      "Missing required MX environment variables: MX_CLIENT_ID, MX_API_KEY, MX_API_URL",
    );
  }

  const basicAuthValue = Buffer.from(`${clientId}:${apiKey}`).toString(
    "base64",
  );

  return { baseUrl, basicAuthValue };
}

class MXService {
  private async makeRequest<T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: any;
      params?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const { method = "GET", body, params } = options;
    const { baseUrl, basicAuthValue } = getMxConfig();

    const url = new URL(endpoint, baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Accept: "application/vnd.mx.api.v1+json",
        Authorization: `Basic ${basicAuthValue}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `MX API error: ${response.status} ${response.statusText} - ${text}`,
      );
    }

    return response.json() as Promise<T>;
  }

  // User management

  async createUser(metadata?: Record<string, any>): Promise<{ guid: string }> {
    const response = await this.makeRequest<{ user: { guid: string } }>(
      "/users",
      {
        method: "POST",
        body: {
          user: {
            metadata: metadata ? JSON.stringify(metadata) : undefined,
          },
        },
      },
    );
    return { guid: response.user.guid };
  }

  async requestWidgetUrl(params: {
    userGuid: string;
    institutionCode?: string;
    currentMemberGuid?: string;
  }): Promise<{ widget_url: string }> {
    const { userGuid, institutionCode, currentMemberGuid } = params;

    const body: any = {
      widget_url: {
        widget_type: "connect_widget",
      },
    };

    if (institutionCode) {
      body.widget_url.current_institution_code = institutionCode;
    }

    if (currentMemberGuid) {
      body.widget_url.current_member_guid = currentMemberGuid;
    }

    const response = await this.makeRequest<any>(
      `/users/${userGuid}/widget_urls`,
      { method: "POST", body },
    );

    if (response.widget_url?.url) {
      return { widget_url: response.widget_url.url };
    } else if (response.widget_url?.widget_url) {
      return { widget_url: response.widget_url.widget_url };
    } else if (typeof response.widget_url === "string") {
      return { widget_url: response.widget_url };
    }

    throw new Error("Invalid widget URL response from MX API");
  }

  // Member management

  async getMember(userGuid: string, memberGuid: string): Promise<MXMember> {
    const response = await this.makeRequest<{ member: MXMember }>(
      `/users/${userGuid}/members/${memberGuid}`,
    );
    return response.member;
  }

  async getMemberStatus(
    userGuid: string,
    memberGuid: string,
  ): Promise<MXMember> {
    const response = await this.makeRequest<{ member: MXMember }>(
      `/users/${userGuid}/members/${memberGuid}/status`,
    );
    return response.member;
  }

  async deleteMember(userGuid: string, memberGuid: string): Promise<boolean> {
    try {
      await this.makeRequest<void>(`/users/${userGuid}/members/${memberGuid}`, {
        method: "DELETE",
      });
      return true;
    } catch {
      return false;
    }
  }

  // Account management

  async getMemberAccounts(
    userGuid: string,
    memberGuid: string,
  ): Promise<MXAccount[]> {
    const response = await this.makeRequest<{ accounts: MXAccount[] }>(
      `/users/${userGuid}/members/${memberGuid}/accounts`,
    );
    return response.accounts;
  }

  // Transaction management

  async getMemberTransactions(
    userGuid: string,
    memberGuid: string,
    params?: {
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<MXTransaction[]> {
    const allTransactions: MXTransaction[] = [];
    let currentPage = 1;
    let hasMore = true;
    const recordsPerPage = 100;

    while (hasMore) {
      const requestParams: Record<string, string> = {
        page: currentPage.toString(),
        records_per_page: recordsPerPage.toString(),
      };

      if (params?.fromDate) requestParams.from_date = params.fromDate;
      if (params?.toDate) requestParams.to_date = params.toDate;

      const response = await this.makeRequest<{
        transactions: MXTransaction[];
        pagination?: {
          current_page: number;
          per_page: number;
          total_entries: number;
          total_pages: number;
        };
      }>(`/users/${userGuid}/members/${memberGuid}/transactions`, {
        params: requestParams,
      });

      const txns = response.transactions || [];
      allTransactions.push(...txns);

      if (response.pagination) {
        hasMore =
          response.pagination.current_page < response.pagination.total_pages;
      } else {
        hasMore = txns.length === recordsPerPage;
      }

      currentPage++;
      if (currentPage > 100) break; // Safety limit
    }

    return allTransactions;
  }

  // Registry lookup

  async findRegistryId(institutionCode: string): Promise<number | null> {
    const rows = await db
      .select({ id: institutionRegistry.id })
      .from(institutionRegistry)
      .where(
        eq(institutionRegistry.providerCompositeKey, `mx_${institutionCode}`),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  // Sync methods

  async connectAndPerformInitialSync(params: {
    userId: string;
    userGuid: string;
    memberGuid: string;
    institutionCode?: string;
  }): Promise<{ syncJobId: number }> {
    const { userId, userGuid, memberGuid } = params;
    let institutionCode = params.institutionCode;

    // Fallback: fetch institution_code from the MX member if not provided
    if (!institutionCode) {
      try {
        const member = await this.getMember(userGuid, memberGuid);
        institutionCode = member.institution_code;
      } catch {
        // Continue without institution code
      }
    }

    const registryId = institutionCode
      ? await this.findRegistryId(institutionCode)
      : null;

    // Create or reactivate account connection
    const [connection] = await db
      .insert(accountConnections)
      .values({
        userId,
        provider: "mx",
        institutionRegistryId: registryId,
        mxMemberGuid: memberGuid,
        mxInstitutionCode: institutionCode ?? null,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [accountConnections.mxMemberGuid],
        set: {
          status: "active",
          institutionRegistryId: registryId,
          mxInstitutionCode: institutionCode ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    const connectionId = connection.id;

    this.markFirstAccountConnected(userId);

    // Fetch and upsert accounts
    const mxAccounts = await this.getMemberAccounts(userGuid, memberGuid);

    for (const account of mxAccounts) {
      if (account.is_hidden || account.is_closed) continue;

      await db
        .insert(financialAccounts)
        .values({
          userId,
          accountConnectionId: connectionId,
          providerAccountId: account.guid,
          name: account.name,
          officialName: account.nickname ?? null,
          type: mapMXTypeToPlaidType(account.type, account.name),
          subtype: account.subtype ?? null,
          mask: account.account_number?.slice(-4) ?? null,
          currentBalance: account.balance?.toString() ?? null,
          availableBalance: account.available_balance?.toString() ?? null,
          isoCurrencyCode: account.currency_code ?? null,
        })
        .onConflictDoUpdate({
          target: [
            financialAccounts.accountConnectionId,
            financialAccounts.providerAccountId,
          ],
          set: {
            name: account.name,
            officialName: account.nickname ?? null,
            type: mapMXTypeToPlaidType(account.type, account.name),
            subtype: account.subtype ?? null,
            mask: account.account_number?.slice(-4) ?? null,
            currentBalance: account.balance?.toString() ?? null,
            availableBalance: account.available_balance?.toString() ?? null,
            isoCurrencyCode: account.currency_code ?? null,
            updatedAt: new Date(),
          },
        });
    }

    // Create sync job for transactions
    const [syncJob] = await db
      .insert(syncJobs)
      .values({
        userId,
        accountConnectionId: connectionId,
        provider: "mx",
        jobType: "transactions",
        status: "pending",
      })
      .returning();

    // Dispatch background workflow
    await DBOS.startWorkflow(MxTransactionSyncWorkflow).run({
      connectionId,
      userId,
      syncJobId: syncJob.id,
    });

    return { syncJobId: syncJob.id };
  }

  async syncTransactions(params: {
    connectionId: number;
    userGuid: string;
    memberGuid: string;
    fromDate?: string;
  }) {
    const { connectionId, userGuid, memberGuid, fromDate } = params;

    // Get accounts for this connection
    const accounts = await db
      .select({
        id: financialAccounts.id,
        providerAccountId: financialAccounts.providerAccountId,
        userId: financialAccounts.userId,
      })
      .from(financialAccounts)
      .where(eq(financialAccounts.accountConnectionId, connectionId));

    const accountMap = new Map(accounts.map((a) => [a.providerAccountId, a]));

    // Fetch transactions from MX (use fromDate to limit scope on incremental syncs)
    const mxTransactions = await this.getMemberTransactions(
      userGuid,
      memberGuid,
      fromDate ? { fromDate } : undefined,
    );

    let added = 0;

    for (const tx of mxTransactions) {
      const account = accountMap.get(tx.account_guid);
      if (!account) continue;

      // MX: positive amounts with CREDIT/DEBIT type
      // Convert to Plaid convention: positive = money out, negative = money in
      const amount =
        tx.type === "CREDIT" ? -Math.abs(tx.amount) : Math.abs(tx.amount);

      await db
        .insert(transactions)
        .values({
          userId: account.userId,
          accountId: account.id,
          providerTransactionId: tx.guid,
          name: tx.description,
          amount: amount.toString(),
          isoCurrencyCode: tx.currency_code ?? null,
          date: new Date(tx.date),
          authorizedDate: tx.transacted_at ? new Date(tx.transacted_at) : null,
          pending: tx.status !== "POSTED",
          merchantName: tx.memo ?? null,
          raw: tx as unknown as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: [transactions.accountId, transactions.providerTransactionId],
          set: {
            name: tx.description,
            amount: amount.toString(),
            isoCurrencyCode: tx.currency_code ?? null,
            date: new Date(tx.date),
            authorizedDate: tx.transacted_at
              ? new Date(tx.transacted_at)
              : null,
            pending: tx.status !== "POSTED",
            merchantName: tx.memo ?? null,
            raw: tx as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          },
        });
      added++;
    }

    // Update lastSyncedAt on the connection
    await db
      .update(accountConnections)
      .set({
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accountConnections.id, connectionId));

    return { added };
  }

  private markFirstAccountConnected(userId: string): void {
    db.update(userTable)
      .set({ firstAccountConnectedAt: new Date() })
      .where(
        and(
          eq(userTable.id, userId),
          isNull(userTable.firstAccountConnectedAt),
        ),
      )
      .then(
        () => {},
        () => {},
      );
  }
}

export const mxService = new MXService();
