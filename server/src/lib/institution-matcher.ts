/**
 * Institution Matcher - Deduplicates institutions from Plaid and MX
 *
 * Algorithm:
 * 1. Filter out same-provider pairs
 * 2. Check for blocking conflicts (different countries, business vs personal)
 * 3. Calculate name similarity using fuzzball's token_sort_ratio
 * 4. Use Union-Find to group connected components
 * 5. Merge institutions within each component
 */

import type { InstitutionRegistry } from "$lib/sql/institution-registry.sql";
import type { AccountType } from "$lib/sql/institution-registry.sql";
import type { CatalogProvider } from "@openfinance/shared";
import * as fuzz from "fuzzball";

export interface MergedInstitution extends Omit<InstitutionRegistry, "id"> {
  id?: number;
  providers: CatalogProvider[];
  matchConfidence: number;
  originalInstitutions: InstitutionRegistry[];
}

export class InstitutionMatcher {
  private static readonly THRESHOLDS = {
    EXACT: 1.0,
    HIGH: 0.75,
    MEDIUM: 0.6,
    LOW: 0.5,
  };

  private static readonly BUSINESS_MARKERS = new Set([
    "business",
    "commercial",
    "corporate",
    "work",
    "@work",
    "atwork",
  ]);

  public static normalizeInstitutionName(name: string): string {
    let normalized = name.toLowerCase();
    normalized = normalized.replace(/@\s*work/g, "@work");
    normalized = normalized.replace(/\s*-\s+personal\b/i, "");
    normalized = normalized.replace(/\bu\.s\.?\b/g, "us");
    normalized = normalized.replace(/\s*\(([^)]*)\)\s*/g, " $1 ");
    normalized = normalized.replace(/[.,\-_]+/g, " ");
    normalized = normalized.replace(
      /\b(bank|banking|credit union|cu|online|digital|inc|corp|ltd|llc)\b/g,
      "",
    );
    normalized = normalized.replace(/\b(the|of|and|&|at)\b/g, "");
    normalized = normalized.replace(/\s+/g, " ").trim();
    return normalized;
  }

  private static hasBusiness(normalizedName: string): boolean {
    const tokens = normalizedName.split(" ");
    return tokens.some((token) => this.BUSINESS_MARKERS.has(token));
  }

  public static normalizeDomain(url: string | null): string | null {
    if (!url) return null;
    try {
      const normalized = url.startsWith("http") ? url : `https://${url}`;
      return new URL(normalized).hostname
        .toLowerCase()
        .replace(/^www[0-9]?\./, "");
    } catch {
      return null;
    }
  }

  public static calculateNameSimilarity(nameA: string, nameB: string): number {
    const normalizedA = this.normalizeInstitutionName(nameA);
    const normalizedB = this.normalizeInstitutionName(nameB);
    return fuzz.token_sort_ratio(normalizedA, normalizedB) / 100;
  }

  public static hasSameDomain(
    institutionA: InstitutionRegistry,
    institutionB: InstitutionRegistry,
  ): boolean {
    const domainA = this.normalizeDomain(institutionA.url);
    const domainB = this.normalizeDomain(institutionB.url);
    return domainA !== null && domainB !== null && domainA === domainB;
  }

  public static areInstitutionsMatched(
    institutionA: InstitutionRegistry,
    institutionB: InstitutionRegistry,
  ): {
    isMatch: boolean;
    confidence: number;
    matchType:
      | "exact_match"
      | "high_similarity"
      | "medium_similarity"
      | "low_similarity"
      | "no_match";
  } {
    const aPlaid = !!institutionA.plaidData;
    const bPlaid = !!institutionB.plaidData;
    const aMx = !!institutionA.mxData;
    const bMx = !!institutionB.mxData;

    // Same provider = no match
    if ((aPlaid && bPlaid) || (aMx && bMx)) {
      return { isMatch: false, confidence: 0, matchType: "no_match" };
    }

    let normA = this.normalizeInstitutionName(institutionA.name);
    let normB = this.normalizeInstitutionName(institutionB.name);

    if (institutionA.countryCode === institutionB.countryCode) {
      const countryCodeLower = institutionA.countryCode.toLowerCase();
      const countryPattern = new RegExp(`\\b${countryCodeLower}\\b`, "g");
      normA = normA.replace(countryPattern, "").replace(/\s+/g, " ").trim();
      normB = normB.replace(countryPattern, "").replace(/\s+/g, " ").trim();
    }

    const domainA = this.normalizeDomain(institutionA.url);
    const domainB = this.normalizeDomain(institutionB.url);
    const sameDomain = domainA && domainB && domainA === domainB;

    // Exact match: same normalized name and same domain
    if (normA === normB && sameDomain) {
      return { isMatch: true, confidence: 1.0, matchType: "exact_match" };
    }

    const businessA = this.hasBusiness(normA);
    const businessB = this.hasBusiness(normB);

    if (businessA !== businessB) {
      return { isMatch: false, confidence: 0, matchType: "no_match" };
    }

    // No domain case
    if (
      !sameDomain &&
      (!institutionA.url || !institutionB.url) &&
      normA === normB
    ) {
      return { isMatch: true, confidence: 1.0, matchType: "exact_match" };
    }

    const similarity = this.calculateNameSimilarity(
      institutionA.name,
      institutionB.name,
    );

    const isLikelyCanadianBank = (domain: string | null): boolean => {
      if (!domain) return false;
      const canadianBankDomains = [
        "rbcroyalbank.com",
        "bmo.com",
        "td.ca",
        "td.com",
        "scotiabank.com",
        "cibc.com",
        "nbc.ca",
        "tangerine.ca",
        "desjardins.com",
        "laurentianbank.ca",
        "americanexpress.com",
        "questrade.com",
      ];
      return canadianBankDomains.some((d) => domain.includes(d));
    };

    const hasRegionalSuffix = (name: string): boolean => {
      return /\((canada|us|usa|uk|australia|au|nz)\)/i.test(name.toLowerCase());
    };

    const getBaseName = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/\s*\((canada|us|usa|uk|australia|au|nz)\)/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    };

    const aHasRegion = hasRegionalSuffix(institutionA.name);
    const bHasRegion = hasRegionalSuffix(institutionB.name);

    if (aHasRegion !== bHasRegion) {
      const baseA = getBaseName(institutionA.name);
      const baseB = getBaseName(institutionB.name);
      if (baseA === baseB) {
        return { isMatch: false, confidence: 0, matchType: "no_match" };
      }
    }

    // Country conflict
    if (institutionA.countryCode !== institutionB.countryCode) {
      const hasCanadianCountryCode =
        institutionA.countryCode === "CA" || institutionB.countryCode === "CA";

      if (
        similarity >= 0.95 &&
        (isLikelyCanadianBank(domainA) || isLikelyCanadianBank(domainB))
      ) {
        return {
          isMatch: true,
          confidence: similarity,
          matchType: "high_similarity",
        };
      }

      if (
        sameDomain &&
        isLikelyCanadianBank(domainA) &&
        hasCanadianCountryCode &&
        similarity >= this.THRESHOLDS.MEDIUM
      ) {
        return {
          isMatch: true,
          confidence: similarity,
          matchType: "medium_similarity",
        };
      }

      if (similarity >= 1.0) {
        return {
          isMatch: true,
          confidence: similarity,
          matchType: "exact_match",
        };
      }

      return { isMatch: false, confidence: 0, matchType: "no_match" };
    }

    // High similarity (same country)
    if (similarity >= this.THRESHOLDS.HIGH) {
      if (similarity >= 0.95) {
        return {
          isMatch: true,
          confidence: similarity,
          matchType: "high_similarity",
        };
      }

      const bothHaveUrls = institutionA.url && institutionB.url;
      if (bothHaveUrls && !sameDomain) {
        return {
          isMatch: false,
          confidence: similarity,
          matchType: "no_match",
        };
      }

      return {
        isMatch: true,
        confidence: similarity,
        matchType: "high_similarity",
      };
    }

    if (similarity >= this.THRESHOLDS.MEDIUM && sameDomain) {
      return {
        isMatch: true,
        confidence: similarity,
        matchType: "medium_similarity",
      };
    }

    if (
      similarity >= this.THRESHOLDS.LOW &&
      sameDomain &&
      !businessA &&
      !businessB
    ) {
      return {
        isMatch: true,
        confidence: similarity,
        matchType: "low_similarity",
      };
    }

    return { isMatch: false, confidence: similarity, matchType: "no_match" };
  }

  private static calculateDataCompletenessScore(
    institution: InstitutionRegistry,
  ): number {
    let score = 0;
    if (institution.logo) score += 2;
    if (institution.primaryColor) score += 1;
    if (institution.url) score += 2;
    if (institution.isTopInstitution) score += 2;
    if (institution.plaidData) score += 3;
    if (institution.mxData) score += 2;
    return score;
  }

  public static deduplicateInstitutions(
    institutions: InstitutionRegistry[],
  ): MergedInstitution[] {
    const n = institutions.length;
    const uf = new UnionFind(n);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const result = this.areInstitutionsMatched(
          institutions[i],
          institutions[j],
        );
        if (result.isMatch) {
          uf.union(i, j);
        }
      }
    }

    const components = uf.getComponents();

    return components.map((indices) => {
      const insts = indices.map((i) => institutions[i]);

      if (insts.length === 1) {
        return {
          ...insts[0],
          providers: providersOf(insts[0]),
          matchConfidence: 1.0,
          originalInstitutions: insts,
        };
      }

      const primary = insts.reduce((best, curr) =>
        this.calculateDataCompletenessScore(curr) >
        this.calculateDataCompletenessScore(best)
          ? curr
          : best,
      );

      const providers = [...new Set(insts.flatMap(providersOf))];
      const plaidData = insts.find((i) => i.plaidData)?.plaidData ?? null;
      const mxData = insts.find((i) => i.mxData)?.mxData ?? null;

      const allSupportedTypes = insts
        .map((i) => i.supportedAccountTypes)
        .filter((types): types is AccountType[] => types !== null)
        .flat();
      const mergedSupportedTypes =
        allSupportedTypes.length > 0
          ? [...new Set(allSupportedTypes)].sort()
          : null;

      const minCountryRank = Math.min(
        ...insts.map((i) => i.countryRank ?? 999),
      );

      return {
        name: primary.name,
        logo: primary.logo || insts.find((i) => i.logo)?.logo || null,
        primaryColor:
          primary.primaryColor ||
          insts.find((i) => i.primaryColor)?.primaryColor ||
          null,
        url: primary.url || insts.find((i) => i.url)?.url || null,
        countryCode: primary.countryCode,
        providerCompositeKey: primary.providerCompositeKey,
        plaidData,
        mxData,
        supportedAccountTypes: mergedSupportedTypes,
        isTopInstitution: insts.some((i) => i.isTopInstitution),
        countryRank: minCountryRank < 999 ? minCountryRank : null,
        lastSynced: new Date(
          Math.max(...insts.map((i) => i.lastSynced.getTime())),
        ),
        createdAt: primary.createdAt,
        updatedAt: new Date(),
        providers,
        matchConfidence: 0.95,
        originalInstitutions: insts,
      };
    });
  }
}

/** The catalogs a registry row can be connected through. */
function providersOf(inst: InstitutionRegistry): CatalogProvider[] {
  return [
    ...(inst.plaidData ? (["plaid"] as const) : []),
    ...(inst.mxData ? (["mx"] as const) : []),
  ];
}

class UnionFind {
  parent: number[];

  constructor(n: number) {
    this.parent = new Array(n);
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
    }
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootB] = rootA;
    }
  }

  getComponents(): number[][] {
    const components = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!components.has(root)) {
        components.set(root, []);
      }
      components.get(root)!.push(i);
    }
    return Array.from(components.values());
  }
}
