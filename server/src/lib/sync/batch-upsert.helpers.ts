import { SQL, getTableColumns, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

/**
 * Helper function to build conflict update columns for batch upserts
 * Uses the `excluded` keyword to reference the proposed insertion values
 */
export const buildConflictUpdateColumns = <
  T extends PgTable,
  Q extends keyof T["_"]["columns"],
>(
  table: T,
  columns: Q[],
) => {
  const cls = getTableColumns(table);
  return columns.reduce(
    (acc, column) => {
      const colName = cls[column].name;
      acc[column] = sql.raw(`excluded.${colName}`);
      return acc;
    },
    {} as Record<Q, SQL>,
  );
};

/**
 * Helper function specifically for institution registry batch upserts
 * Returns the standard set of columns that should be updated on conflict
 */
export const getInstitutionRegistryUpdateColumns = () => {
  return [
    "name",
    "logo",
    "primaryColor",
    "url",
    "countryCode",
    "plaidData",
    "mxData",
    "supportedAccountTypes",
    "lastSynced",
    "updatedAt",
  ] as const;
};
