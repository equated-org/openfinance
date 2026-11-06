import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { client, db } from "../db";
import { financialAccounts, transactions } from "../schema";
import {
  prepareTransactionQuery,
  TransactionQueryError,
} from "./transaction-query";
import type {
  AmountFilter,
  ApiTransaction,
  QueryTransactionsResponse,
  QueryTransactionsErrorResponse,
  TransactionFilter,
  TransactionStatus,
} from "@openfinance/shared";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
// With no parameters, unsafe() defaults to the simple protocol, which would run
// several statements from one string. The extended protocol refuses them.
const SINGLE_STATEMENT = { prepare: false, simple: false };

function parseDateInput(value: string, endOfDay = false): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const date = new Date(`${value}${suffix}`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDate(date: Date | null): string | null {
  if (!date) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseCursor(cursor: string): { date: Date; id: number } | null {
  const separator = cursor.lastIndexOf(":");
  if (separator === -1) return null;

  const datePart = cursor.slice(0, separator);
  const idPart = Number.parseInt(cursor.slice(separator + 1), 10);
  const date = parseDateInput(datePart);

  if (!date || Number.isNaN(idPart)) return null;
  return { date, id: idPart };
}

function normalizeLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, limit));
}

function amountFilterToSql(filter: AmountFilter): SQL<unknown> | null {
  switch (filter.operator) {
    case ">":
      return sql`CAST(${transactions.amount} AS numeric) > ${filter.amount}`;
    case "<":
      return sql`CAST(${transactions.amount} AS numeric) < ${filter.amount}`;
    case ">=":
      return sql`CAST(${transactions.amount} AS numeric) >= ${filter.amount}`;
    case "<=":
      return sql`CAST(${transactions.amount} AS numeric) <= ${filter.amount}`;
    case "=":
      return sql`CAST(${transactions.amount} AS numeric) = ${filter.amount}`;
    default:
      return null;
  }
}

function toApiTransaction(
  row: typeof transactions.$inferSelect,
): ApiTransaction {
  const { raw, ...rest } = row;
  return {
    ...rest,
    amount: Number.parseFloat(row.amount),
    date: formatDate(row.date) ?? "",
    authorizedDate: formatDate(row.authorizedDate),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

class TransactionService {
  async getTransactionsByUserId(
    userId: string,
    filter?: TransactionFilter,
  ): Promise<ApiTransaction[]> {
    const conditions: SQL<unknown>[] = [
      eq(transactions.userId, userId),
      sql`${transactions.accountId} NOT IN (SELECT ${financialAccounts.id} FROM ${financialAccounts} WHERE ${financialAccounts.status} = 'hidden' AND ${financialAccounts.userId} = ${userId})`,
    ];

    const statusFilter = filter?.status;
    if (statusFilter && statusFilter.length > 0) {
      conditions.push(
        inArray(transactions.status, statusFilter as TransactionStatus[]),
      );
    } else {
      conditions.push(sql`${transactions.status} != 'deleted'`);
    }

    if (filter?.accountId !== undefined) {
      conditions.push(eq(transactions.accountId, filter.accountId));
    }

    if (filter?.pending !== undefined) {
      conditions.push(eq(transactions.pending, filter.pending));
    }

    if (filter?.startDate) {
      const startDate = parseDateInput(filter.startDate);
      if (startDate) {
        conditions.push(
          gt(transactions.date, new Date(startDate.getTime() - 1)),
        );
      }
    }

    if (filter?.endDate) {
      const endDate = parseDateInput(filter.endDate, true);
      if (endDate) {
        conditions.push(lt(transactions.date, new Date(endDate.getTime() + 1)));
      }
    }

    const searchTerms = [
      ...(filter?.searchText
        ? filter.searchText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : []),
      ...(filter?.searchPatterns?.map((s) => s.trim()).filter(Boolean) ?? []),
    ];

    if (searchTerms.length > 0) {
      const searchConditions = searchTerms.map((term) => {
        const pattern = `%${term}%`;
        return or(
          ilike(transactions.name, pattern),
          ilike(transactions.merchantName, pattern),
        );
      });

      conditions.push(or(...searchConditions)!);
    }

    if (filter?.merchants && filter.merchants.length > 0) {
      const merchantConds = filter.merchants
        .map((merchant) => merchant.trim())
        .filter(Boolean)
        .map(
          (merchant) =>
            sql`LOWER(COALESCE(${transactions.merchantName}, '')) = LOWER(${merchant})`,
        );

      if (merchantConds.length > 0) {
        conditions.push(or(...merchantConds)!);
      }
    }

    for (const amountFilter of filter?.amountFilters ?? []) {
      const condition = amountFilterToSql(amountFilter);
      if (condition) {
        conditions.push(condition);
      }
    }

    const sort = filter?.sort ?? {
      orderField: "date",
      ordering: "desc" as const,
    };
    const isAsc = sort.ordering === "asc";

    if (filter?.cursor && sort.orderField === "date") {
      const parsedCursor = parseCursor(filter.cursor);
      if (parsedCursor) {
        const cursorCondition = isAsc
          ? or(
              gt(transactions.date, parsedCursor.date),
              and(
                eq(transactions.date, parsedCursor.date),
                gt(transactions.id, parsedCursor.id),
              ),
            )
          : or(
              lt(transactions.date, parsedCursor.date),
              and(
                eq(transactions.date, parsedCursor.date),
                lt(transactions.id, parsedCursor.id),
              ),
            );

        if (cursorCondition) {
          conditions.push(cursorCondition);
        }
      }
    }

    const orderBy =
      sort.orderField === "amount"
        ? [
            isAsc ? asc(transactions.amount) : desc(transactions.amount),
            isAsc ? asc(transactions.date) : desc(transactions.date),
            isAsc ? asc(transactions.id) : desc(transactions.id),
          ]
        : sort.orderField === "createdAt"
          ? [
              isAsc
                ? asc(transactions.createdAt)
                : desc(transactions.createdAt),
              isAsc ? asc(transactions.id) : desc(transactions.id),
            ]
          : [
              isAsc ? asc(transactions.date) : desc(transactions.date),
              isAsc ? asc(transactions.id) : desc(transactions.id),
            ];

    const rows = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(normalizeLimit(filter?.limit));

    return rows.map(toApiTransaction);
  }

  async queryTransactions(
    userId: string,
    userSql: string,
  ): Promise<QueryTransactionsResponse | QueryTransactionsErrorResponse> {
    try {
      const validatedSql = await prepareTransactionQuery(userSql);
      const rows = await client.begin(async (tx) => {
        await tx.unsafe("SET LOCAL search_path = pg_catalog, pg_temp");
        await tx.unsafe("SET LOCAL standard_conforming_strings = on");
        // Nothing here has to survive a crash, so commit without waiting for disk.
        await tx.unsafe("SET LOCAL synchronous_commit = off");
        // txns has no statistics, so estimates are poor. Without this, a small
        // self join can become a nested loop that runs into the timeout.
        await tx.unsafe("SET LOCAL enable_nestloop = off");
        await tx.unsafe("SET LOCAL jit = off");
        // A large account can take seconds to read from disk. The copy is our
        // own SQL, so it gets more time than the caller's query does.
        await tx.unsafe("SET LOCAL statement_timeout = '30s'");
        // Caller SQL only ever sees this copy. Planned against
        // public.transactions, it could read statistics that cover every user.
        await tx.unsafe(
          `CREATE TEMP TABLE txns ON COMMIT DROP AS
  SELECT
    id, name, amount::numeric, date, authorized_date,
    merchant_name, pending, iso_currency_code,
    account_id, status, created_at, updated_at
  FROM public.transactions
  WHERE user_id = $1 AND status != 'deleted'
    AND account_id NOT IN (SELECT id FROM public.financial_accounts WHERE status = 'hidden' AND user_id = $1)`,
          [userId],
        );
        await tx.unsafe("SET LOCAL statement_timeout = '5s'");
        await tx.unsafe("SET TRANSACTION READ ONLY");
        return tx.unsafe(validatedSql, [], SINGLE_STATEMENT);
      });
      return { rows: Array.from(rows), rowCount: rows.length };
    } catch (error: unknown) {
      if (error instanceof TransactionQueryError) {
        return { error: error.message };
      }
      console.error("Transaction query failed", error);
      return { error: "Query execution failed" };
    }
  }
}

export const transactionService = new TransactionService();
