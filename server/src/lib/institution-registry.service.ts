import { db } from "../db";
import { institutionRegistry } from "../schema";
import { ilike, and, sql, inArray } from "drizzle-orm";
import type { InstitutionType } from "@openfinance/shared";
import { InstitutionMatcher } from "./institution-matcher";
import { isMxConfigured } from "./sync/mx.client";

/**
 * Top institutions by country - includes both Plaid and MX composite keys
 */
type TopInstitutionGroup = {
  name: string;
  ids: string[];
};

const TOP_INSTITUTIONS_BY_COUNTRY: Record<string, TopInstitutionGroup[]> = {
  US: [
    { name: "Chase", ids: ["plaid_ins_56", "mx_chase"] },
    {
      name: "Bank of America",
      ids: ["plaid_ins_127989", "mx_bank_of_america"],
    },
    {
      name: "Wells Fargo",
      ids: ["plaid_ins_127991", "mx_wells_fargo"],
    },
    {
      name: "Citibank",
      ids: ["plaid_ins_5", "mx_citibank"],
    },
    {
      name: "U.S. Bank",
      ids: ["plaid_ins_127990", "mx_us_bank"],
    },
    { name: "PNC", ids: ["plaid_ins_13", "mx_pnc_bank"] },
    {
      name: "Truist",
      ids: ["plaid_ins_130888", "mx_9f732f7a-b6e2-4c60-81eb-af6274f411dc"],
    },
    {
      name: "Capital One",
      ids: ["plaid_ins_128026", "mx_capital_one"],
    },
    {
      name: "TD Bank",
      ids: ["plaid_ins_14", "mx_td_bank"],
    },
    {
      name: "American Express",
      ids: ["plaid_ins_10", "mx_amex"],
    },
    {
      name: "Ally Bank",
      ids: ["plaid_ins_25", "mx_allybank"],
    },
    {
      name: "Discover",
      ids: ["plaid_ins_33", "mx_discover_card"],
    },
    {
      name: "Charles Schwab",
      ids: ["plaid_ins_11", "mx_69378"],
    },
    {
      name: "Marcus by Goldman Sachs",
      ids: ["plaid_ins_52", "mx_69490"],
    },
    {
      name: "Huntington Bank",
      ids: ["plaid_ins_21", "mx_69856"],
    },
  ],
  CA: [
    {
      name: "RBC Royal Bank",
      ids: ["plaid_ins_39", "mx_69739"],
    },
    {
      name: "TD Canada Trust",
      ids: ["plaid_ins_42", "mx_69814"],
    },
    { name: "Scotiabank", ids: ["plaid_ins_38", "mx_69747"] },
    {
      name: "BMO Bank of Montreal",
      ids: ["plaid_ins_41", "mx_073bb78b-61a3-46d6-94f1-a7d58e048671"],
    },
    {
      name: "CIBC",
      ids: ["plaid_ins_37", "mx_69368"],
    },
    { name: "National Bank of Canada", ids: ["plaid_ins_48", "mx_79115"] },
    {
      name: "Tangerine",
      ids: ["plaid_ins_40", "mx_76821"],
    },
    { name: "American Express", ids: ["plaid_ins_100533", "mx_69956"] },
    {
      name: "Laurentian Bank",
      ids: ["plaid_ins_44", "mx_cca44ea7-e4ec-b141-2211-edfff371d612"],
    },
    { name: "President's Choice Financial", ids: ["plaid_ins_47", "mx_69785"] },
    {
      name: "Desjardins",
      ids: ["plaid_ins_46", "mx_78093"],
    },
  ],
};

function toInstitutionType(
  merged: ReturnType<typeof InstitutionMatcher.deduplicateInstitutions>[number],
): InstitutionType {
  return {
    id: merged.originalInstitutions[0]
      ? String(merged.originalInstitutions[0].id)
      : "0",
    name: merged.name,
    logo: merged.logo,
    logoUrl:
      merged.mxData?.mediumLogoUrl ?? merged.mxData?.smallLogoUrl ?? null,
    primaryColor: merged.primaryColor,
    url: merged.url,
    plaidData: merged.plaidData ?? null,
    mxData: merged.mxData ?? null,
    providers: merged.providers,
    matchConfidence: merged.matchConfidence,
    rank: merged.countryRank ?? undefined,
  };
}

/**
 * Rows the picker can connect: Plaid's catalog, plus MX's when MX is set up.
 * Both are refreshed from the providers' APIs on a schedule. Other rows, like
 * the ones written for Quiltt connections, never appear in search: banks
 * outside these catalogs are reached through Quiltt's own search.
 */
function connectableInstitutions() {
  return isMxConfigured()
    ? sql`(${institutionRegistry.plaidData} is not null
        or ${institutionRegistry.mxData} is not null)`
    : sql`${institutionRegistry.plaidData} is not null`;
}

/** Rows that support `accountType`; "all" matches every row. */
function supportsAccountType(accountType: string) {
  return accountType === "all"
    ? undefined
    : sql`${institutionRegistry.supportedAccountTypes}::jsonb @> ${JSON.stringify([accountType])}::jsonb`;
}

interface SearchParams {
  query?: string;
  limit?: number;
  provider?: string;
  accountType?: string;
  country?: string;
}

class InstitutionRegistryService {
  async searchInstitutions(params: SearchParams): Promise<InstitutionType[]> {
    const query = params.query || "";
    if (!query) {
      return this.getTopInstitutions(params);
    }

    const limit = Math.min(params.limit ?? 20, 50);
    const provider = params.provider || "all";

    // Fetch 3x limit to allow deduplication to merge and still have enough results
    const fetchLimit = limit * 3;

    const conditions = [
      ilike(institutionRegistry.name, `%${query}%`),
      connectableInstitutions(),
      supportsAccountType(params.accountType || "all"),
    ];

    if (provider === "plaid") {
      conditions.push(sql`${institutionRegistry.plaidData} is not null`);
    } else if (provider === "mx") {
      conditions.push(sql`${institutionRegistry.mxData} is not null`);
    }

    const rows = await db
      .select()
      .from(institutionRegistry)
      .where(and(...conditions))
      .limit(fetchLimit);

    // Deduplicate across providers
    const deduplicated = InstitutionMatcher.deduplicateInstitutions(rows);

    return deduplicated.slice(0, limit).map(toInstitutionType);
  }

  async getTopInstitutions(params: SearchParams): Promise<InstitutionType[]> {
    // Only countries with a curated list get suggestions before typing.
    const topGroups = TOP_INSTITUTIONS_BY_COUNTRY[params.country || "US"];
    if (!topGroups) return [];

    const limit = Math.min(params.limit ?? 20, 50);
    const rows = await db
      .select()
      .from(institutionRegistry)
      .where(
        and(
          inArray(
            institutionRegistry.providerCompositeKey,
            topGroups.flatMap((group) => group.ids),
          ),
          connectableInstitutions(),
          supportsAccountType(params.accountType || "all"),
        ),
      );

    // One entry per group, merging its Plaid and MX rows.
    return topGroups.slice(0, limit).flatMap((group) => {
      const groupRows = rows.filter(
        (row) =>
          row.providerCompositeKey &&
          group.ids.includes(row.providerCompositeKey),
      );
      const [merged] = InstitutionMatcher.deduplicateInstitutions(groupRows);
      return merged ? [toInstitutionType(merged)] : [];
    });
  }
}

export const institutionRegistryService = new InstitutionRegistryService();
