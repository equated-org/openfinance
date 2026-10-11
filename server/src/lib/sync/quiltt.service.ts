import { db } from "../../db";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { QuilttTransactionSyncWorkflow } from "../../workflows/quiltt-transaction-sync.workflow";
import {
  financialAccounts,
  accountConnections,
  syncJobs,
  institutionRegistry,
  transactions,
} from "../../schema";
import { eq, and, isNull, ilike } from "drizzle-orm";
import { user as userTable } from "../../schema";
import type { AccountType } from "$lib/sql/institution-registry.sql";
import { sleep } from "../utils";
import { proxyFetch } from "../api-proxy";

// Quiltt GraphQL Types

interface QuilttAccount {
  id: string;
  name: string;
  kind: string;
  mask: string;
  currencyCode?: string;
  balance: {
    current: number | null;
    available: number | null;
  } | null;
}

interface QuilttConnection {
  id: string;
  provider: string;
  status: string;
  institution?: {
    name: string;
    logo?: { url: string };
  };
  accounts: QuilttAccount[];
}

interface QuilttTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  currencyCode?: string;
  entryType: "DEBIT" | "CREDIT";
  status?: string;
  account: {
    id: string;
  };
}

interface QuilttTransactionsResponse {
  transactions: {
    edges: Array<{ node: QuilttTransaction }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

interface QuilttConnectionResponse {
  connection: QuilttConnection;
}

// GraphQL Queries

const CONNECTION_QUERY = `
  query GetConnection($connectionId: ID!) {
    connection(id: $connectionId) {
      id
      provider
      status
      institution {
        name
        logo { url }
      }
      accounts {
        id
        name
        kind
        mask
        currencyCode
        balance {
          current
          available
        }
      }
    }
  }
`;

const TRANSACTIONS_QUERY = `
  query GetTransactions($first: Int, $after: String, $filter: TransactionFilter) {
    transactions(first: $first, after: $after, filter: $filter) {
      edges {
        node {
          id
          date
          description
          amount
          currencyCode
          entryType
          status
          account {
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const CONNECTION_DISCONNECT_MUTATION = `
  mutation ConnectionDisconnect($id: ID!) {
    connectionDisconnect(input: { id: $id }) {
      success
      record { id }
    }
  }
`;

// Account type mapping from Quiltt to standardized system

const QUILTT_TO_ACCOUNT_TYPE: Record<string, AccountType> = {
  DEPOSITORY: "depository",
  CREDIT: "credit",
  INSURANCE: "depository",
  CHECKING: "depository",
  SAVINGS: "depository",
  MONEY_MARKET: "depository",
  CD: "depository",
  CREDIT_CARD: "credit",
  LINE_OF_CREDIT: "credit",
  LOAN: "loan",
  MORTGAGE: "loan",
  STUDENT: "loan",
  AUTO: "loan",
  INVESTMENT: "investment",
  BROKERAGE: "investment",
  RETIREMENT: "investment",
  "401K": "investment",
  IRA: "investment",
};

export function mapQuilttTypeToAccountType(
  quilttType: string,
  accountName?: string,
): AccountType {
  const upperType = quilttType.toUpperCase();

  // If type is OTHER, use name-based detection
  if (upperType === "OTHER" && accountName) {
    const nameUpper = accountName.toUpperCase();

    if (
      nameUpper.includes("IRA") ||
      nameUpper.includes("401K") ||
      nameUpper.includes("401(K)") ||
      nameUpper.includes("403B") ||
      nameUpper.includes("403(B)") ||
      nameUpper.includes("529") ||
      nameUpper.includes("ROLLOVER") ||
      nameUpper.includes("RETIREMENT") ||
      nameUpper.includes("BROKERAGE") ||
      nameUpper.includes("INVESTMENT")
    ) {
      return "investment";
    }

    if (
      nameUpper.includes("CREDIT CARD") ||
      nameUpper.includes("CREDITCARD") ||
      nameUpper.includes("LINE OF CREDIT") ||
      nameUpper.includes("HELOC") ||
      nameUpper.includes("VISA") ||
      nameUpper.includes("MASTERCARD") ||
      nameUpper.includes("AMEX") ||
      nameUpper.includes("AMERICAN EXPRESS")
    ) {
      return "credit";
    }

    if (
      nameUpper.includes("MORTGAGE") ||
      nameUpper.includes("AUTO LOAN") ||
      nameUpper.includes("AUTOLOAN") ||
      nameUpper.includes("STUDENT LOAN") ||
      nameUpper.includes("PERSONAL LOAN")
    ) {
      return "loan";
    }

    if (
      nameUpper.includes("CHECKING") ||
      nameUpper.includes("SAVINGS") ||
      nameUpper.includes("MONEY MARKET") ||
      nameUpper.includes("CD ") ||
      nameUpper.startsWith("CD")
    ) {
      return "depository";
    }
  }

  return QUILTT_TO_ACCOUNT_TYPE[upperType] || "depository";
}

function getQuilttConfig() {
  const apiSecret = process.env.QUILTT_API_SECRET;
  const connectorId = process.env.QUILTT_CONNECTOR_ID;

  if (!apiSecret) {
    throw new Error("Missing required QUILTT_API_SECRET environment variable");
  }

  return { apiSecret, connectorId: connectorId ?? "" };
}

class QuilttService {
  private readonly graphqlEndpoint = "https://api.quiltt.io/v1/graphql";

  // GraphQL client

  private async executeGraphQL<T>(
    profileId: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const { apiSecret } = getQuilttConfig();
    const credentials = Buffer.from(`${profileId}:${apiSecret}`).toString(
      "base64",
    );

    const response = await proxyFetch(this.graphqlEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Quiltt GraphQL request failed: ${response.status} ${response.statusText} - ${text}`,
      );
    }

    const result = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (result?.errors?.length) {
      throw new Error(
        `Quiltt GraphQL errors: ${result.errors.map((e) => e.message).join(", ")}`,
      );
    }

    return result.data as T;
  }

  // API methods

  async createSession(
    profileId?: string,
  ): Promise<{ token: string; userId: string; expiresAt: string }> {
    const { apiSecret, connectorId } = getQuilttConfig();

    const response = await proxyFetch(
      "https://auth.quiltt.io/v1/users/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(profileId ? { userId: profileId } : {}),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Quiltt session creation failed: ${response.status} - ${text}`,
      );
    }

    const data = (await response.json()) as {
      token: string;
      userId: string;
      expiresAt: string;
    };

    return { ...data, connectorId } as any;
  }

  /** Ends a session token before its 24 hours are up. */
  async revokeSession(token: string): Promise<void> {
    const response = await proxyFetch(
      "https://auth.quiltt.io/v1/users/session",
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    // 401 means the token is already expired or revoked.
    if (!response.ok && response.status !== 401) {
      const text = await response.text();
      throw new Error(
        `Quiltt session revocation failed: ${response.status} - ${text}`,
      );
    }
  }

  async getConnection(
    profileId: string,
    connectionId: string,
  ): Promise<QuilttConnection> {
    const data = await this.executeGraphQL<QuilttConnectionResponse>(
      profileId,
      CONNECTION_QUERY,
      { connectionId },
    );
    return data.connection;
  }

  async getTransactions(
    profileId: string,
    options?: { first?: number; after?: string; accountIds?: string[] },
  ): Promise<{
    transactions: QuilttTransaction[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  }> {
    const variables: Record<string, unknown> = {
      first: options?.first ?? 100,
      after: options?.after,
    };
    if (options?.accountIds?.length) {
      variables.filter = { accountIds: options.accountIds };
    }
    const data = await this.executeGraphQL<QuilttTransactionsResponse>(
      profileId,
      TRANSACTIONS_QUERY,
      variables,
    );

    return {
      transactions: data.transactions.edges.map((edge) => edge.node),
      pageInfo: data.transactions.pageInfo,
    };
  }

  async getAllTransactions(
    profileId: string,
    maxPages: number = 10,
    accountIds?: string[],
  ): Promise<QuilttTransaction[]> {
    const allTransactions: QuilttTransaction[] = [];
    let cursor: string | null = null;
    let pageCount = 0;

    do {
      const result = await this.getTransactions(profileId, {
        first: 100,
        after: cursor ?? undefined,
        accountIds,
      });

      allTransactions.push(...result.transactions);
      cursor = result.pageInfo.endCursor;
      pageCount++;

      if (!result.pageInfo.hasNextPage || pageCount >= maxPages) {
        break;
      }
    } while (cursor);

    return allTransactions;
  }

  async waitForConnectionSync(
    profileId: string,
    connectionId: string,
    options?: { maxAttempts?: number; intervalMs?: number },
  ): Promise<{ status: string; ready: boolean }> {
    const maxAttempts = options?.maxAttempts ?? 60;
    const intervalMs = options?.intervalMs ?? 5000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const connection = await this.getConnection(profileId, connectionId);

      if (connection.status === "SYNCED") {
        return { status: connection.status, ready: true };
      }

      if (connection.status.startsWith("ERROR")) {
        return { status: connection.status, ready: false };
      }

      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
    }

    return { status: "TIMEOUT", ready: false };
  }

  async disconnectConnection(
    profileId: string,
    connectionId: string,
  ): Promise<boolean> {
    try {
      const result = await this.executeGraphQL<{
        connectionDisconnect: {
          success: boolean;
          record: { id: string } | null;
        };
      }>(profileId, CONNECTION_DISCONNECT_MUTATION, { id: connectionId });

      return result.connectionDisconnect.success;
    } catch {
      return false;
    }
  }

  // Registry lookup

  async findRegistryId(institutionName: string): Promise<number | null> {
    const [row] = await db
      .select({ id: institutionRegistry.id })
      .from(institutionRegistry)
      .where(ilike(institutionRegistry.name, institutionName))
      .limit(1);
    return row?.id ?? null;
  }

  // Sync methods

  async connectAndPerformInitialSync(params: {
    userId: string;
    quilttConnectionId: string;
    quilttProfileId: string;
    institutionRegistryId?: number | null;
  }): Promise<{ syncJobId: number }> {
    const { userId, quilttConnectionId, quilttProfileId } = params;
    let institutionRegistryId = params.institutionRegistryId ?? null;

    // Fetch connection details from Quiltt
    const connection = await this.getConnection(
      quilttProfileId,
      quilttConnectionId,
    );

    // If no registry ID provided, try name-based lookup
    if (!institutionRegistryId && connection.institution?.name) {
      institutionRegistryId = await this.findRegistryId(
        connection.institution.name,
      );
    }

    // Create or reactivate account connection
    const [conn] = await db
      .insert(accountConnections)
      .values({
        userId,
        provider: "quiltt",
        institutionRegistryId,
        quilttConnectionId,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [accountConnections.quilttConnectionId],
        set: {
          status: "active",
          institutionRegistryId,
          updatedAt: new Date(),
        },
      })
      .returning();

    const connectionId = conn.id;

    this.markFirstAccountConnected(userId);

    await this.upsertAccountsFromConnection(
      userId,
      connectionId,
      connection.accounts,
    );

    // Create sync job for transactions
    const [syncJob] = await db
      .insert(syncJobs)
      .values({
        userId,
        accountConnectionId: connectionId,
        provider: "quiltt",
        jobType: "transactions",
        status: "pending",
      })
      .returning();

    // Dispatch background workflow
    await DBOS.startWorkflow(QuilttTransactionSyncWorkflow).run({
      connectionId,
      userId,
      syncJobId: syncJob.id,
    });

    return { syncJobId: syncJob.id };
  }

  async syncTransactions(params: {
    connectionId: number;
    quilttConnectionId: string;
    quilttProfileId: string;
  }) {
    const { connectionId, quilttConnectionId, quilttProfileId } = params;

    const [conn] = await db
      .select({ userId: accountConnections.userId })
      .from(accountConnections)
      .where(eq(accountConnections.id, connectionId))
      .limit(1);

    if (!conn) {
      throw new Error(`Connection ${connectionId} not found`);
    }
    const userId = conn.userId;

    // Upsert accounts — the initial sync may have run before Quiltt populated
    // them (INITIALIZING state can return empty accounts).
    const connection = await this.getConnection(
      quilttProfileId,
      quilttConnectionId,
    );
    await this.upsertAccountsFromConnection(
      userId,
      connectionId,
      connection.accounts,
    );

    const accounts = await db
      .select({
        id: financialAccounts.id,
        providerAccountId: financialAccounts.providerAccountId,
        userId: financialAccounts.userId,
        isoCurrencyCode: financialAccounts.isoCurrencyCode,
      })
      .from(financialAccounts)
      .where(eq(financialAccounts.accountConnectionId, connectionId));

    const accountMap = new Map(accounts.map((a) => [a.providerAccountId, a]));

    // Fetch transactions only for this connection's accounts
    const connectionAccountIds = connection.accounts.map((a) => a.id);
    const quilttTransactions = await this.getAllTransactions(
      quilttProfileId,
      10,
      connectionAccountIds,
    );

    let added = 0;

    for (const tx of quilttTransactions) {
      const account = accountMap.get(tx.account.id);
      if (!account) continue;

      // Quiltt uses entryType with positive amounts
      // Convert to Plaid convention: DEBIT (money out) = positive, CREDIT (money in) = negative
      const amount =
        tx.entryType === "CREDIT" ? -Math.abs(tx.amount) : Math.abs(tx.amount);
      const isPending = tx.status?.toUpperCase() === "PENDING";
      // Never assume USD — fall back to the account's currency so a CAD
      // account's transactions aren't filed under a currency Quiltt never sent.
      const isoCurrencyCode = tx.currencyCode ?? account.isoCurrencyCode ?? null;

      await db
        .insert(transactions)
        .values({
          userId: account.userId,
          accountId: account.id,
          providerTransactionId: tx.id,
          name: tx.description,
          amount: amount.toString(),
          isoCurrencyCode,
          date: new Date(tx.date),
          authorizedDate: null,
          pending: isPending,
          merchantName: null,
          raw: tx as unknown as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: [transactions.accountId, transactions.providerTransactionId],
          set: {
            name: tx.description,
            amount: amount.toString(),
            isoCurrencyCode,
            date: new Date(tx.date),
            pending: isPending,
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

  private async upsertAccountsFromConnection(
    userId: string,
    connectionId: number,
    quilttAccounts: QuilttAccount[],
  ): Promise<void> {
    for (const account of quilttAccounts) {
      const fields = {
        name: account.name,
        type: mapQuilttTypeToAccountType(account.kind, account.name),
        subtype: account.kind.toLowerCase(),
        mask: account.mask || null,
        currentBalance: account.balance?.current?.toString() ?? null,
        availableBalance: account.balance?.available?.toString() ?? null,
        isoCurrencyCode: account.currencyCode ?? null,
      };

      await db
        .insert(financialAccounts)
        .values({
          userId,
          accountConnectionId: connectionId,
          providerAccountId: account.id,
          officialName: null,
          ...fields,
        })
        .onConflictDoUpdate({
          target: [
            financialAccounts.accountConnectionId,
            financialAccounts.providerAccountId,
          ],
          set: { ...fields, updatedAt: new Date() },
        });
    }
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

export const quilttService = new QuilttService();
