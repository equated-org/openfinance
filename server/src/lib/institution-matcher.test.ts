import { describe, it, expect } from "vitest";
import { InstitutionMatcher } from "./institution-matcher";
import type { InstitutionRegistry } from "$lib/sql/institution-registry.sql";

function createTestInstitution(
  id: number,
  name: string,
  url: string | null,
  plaidData: any | null,
  mxData: any | null,
  countryCode: string = "US",
): InstitutionRegistry {
  return {
    id,
    name,
    logo: null,
    primaryColor: null,
    url,
    countryCode,
    providerCompositeKey: plaidData
      ? `plaid_${plaidData.institutionId}`
      : mxData
        ? `mx_${mxData.institutionCode}`
        : `test_${id}`,
    plaidData,
    mxData,
    supportedAccountTypes: ["depository", "credit"],
    isTopInstitution: false,
    countryRank: null,
    lastSynced: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("InstitutionMatcher", () => {
  describe("calculateNameSimilarity", () => {
    it("should return 1.0 for identical names", () => {
      const similarity = InstitutionMatcher.calculateNameSimilarity(
        "Chase",
        "Chase",
      );
      expect(similarity).toBe(1.0);
    });

    it("should return high similarity for similar names with different suffixes", () => {
      const similarity = InstitutionMatcher.calculateNameSimilarity(
        "Chase Bank",
        "Chase Banking",
      );
      expect(similarity).toBeGreaterThan(0.8);
    });

    it("should return low similarity for different institutions", () => {
      const similarity = InstitutionMatcher.calculateNameSimilarity(
        "Chase",
        "Wells Fargo",
      );
      expect(similarity).toBeLessThan(0.5);
    });
  });

  describe("hasSameDomain", () => {
    it("should match same domain with different subdomains", () => {
      const a = createTestInstitution(
        1,
        "A",
        "https://www.chase.com",
        null,
        null,
      );
      const b = createTestInstitution(2, "B", "https://chase.com", null, null);
      expect(InstitutionMatcher.hasSameDomain(a, b)).toBe(true);
    });

    it("should not match different domains", () => {
      const a = createTestInstitution(1, "A", "https://chase.com", null, null);
      const b = createTestInstitution(
        2,
        "B",
        "https://wellsfargo.com",
        null,
        null,
      );
      expect(InstitutionMatcher.hasSameDomain(a, b)).toBe(false);
    });

    it("should handle www1 subdomains", () => {
      const a = createTestInstitution(
        1,
        "A",
        "https://www1.bmo.com/",
        null,
        null,
      );
      const b = createTestInstitution(
        2,
        "B",
        "https://www.bmo.com",
        null,
        null,
      );
      expect(InstitutionMatcher.hasSameDomain(a, b)).toBe(true);
    });
  });

  describe("areInstitutionsMatched", () => {
    it("should reject same provider pairs (both Plaid)", () => {
      const a = createTestInstitution(
        1,
        "Chase",
        "https://chase.com",
        { institutionId: "ins_56" },
        null,
      );
      const b = createTestInstitution(
        2,
        "Chase",
        "https://chase.com",
        { institutionId: "ins_57" },
        null,
      );
      const result = InstitutionMatcher.areInstitutionsMatched(a, b);
      expect(result.isMatch).toBe(false);
    });

    it("should reject same provider pairs (both MX)", () => {
      const a = createTestInstitution(1, "Chase", "https://chase.com", null, {
        institutionCode: "chase_1",
      });
      const b = createTestInstitution(2, "Chase", "https://chase.com", null, {
        institutionCode: "chase_2",
      });
      const result = InstitutionMatcher.areInstitutionsMatched(a, b);
      expect(result.isMatch).toBe(false);
    });

    it("should match Plaid + MX with same name and domain", () => {
      const a = createTestInstitution(
        1,
        "Chase",
        "https://www.chase.com",
        { institutionId: "ins_56" },
        null,
      );
      const b = createTestInstitution(2, "Chase", "https://chase.com", null, {
        institutionCode: "chase",
      });
      const result = InstitutionMatcher.areInstitutionsMatched(a, b);
      expect(result.isMatch).toBe(true);
      expect(result.matchType).toBe("exact_match");
    });

    it("should reject business vs personal variants", () => {
      const a = createTestInstitution(
        1,
        "Chase",
        "https://chase.com",
        { institutionId: "ins_56" },
        null,
      );
      const b = createTestInstitution(
        2,
        "Chase - @Work",
        "https://chase.com",
        null,
        { institutionCode: "chase_work" },
      );
      const result = InstitutionMatcher.areInstitutionsMatched(a, b);
      expect(result.isMatch).toBe(false);
    });

    it("should reject different countries by default", () => {
      const a = createTestInstitution(
        1,
        "TD Bank",
        "https://td.com",
        { institutionId: "ins_14" },
        null,
        "US",
      );
      const b = createTestInstitution(
        2,
        "TD Canada Trust",
        "https://td.ca",
        null,
        { institutionCode: "td" },
        "CA",
      );
      const result = InstitutionMatcher.areInstitutionsMatched(a, b);
      expect(result.isMatch).toBe(false);
    });

    it("should NOT merge American Express US with American Express Canada", () => {
      const amexUS = createTestInstitution(
        1,
        "American Express",
        "https://www.americanexpress.com/us",
        { institutionId: "ins_10" },
        null,
        "US",
      );
      const amexCanada = createTestInstitution(
        2,
        "American Express (Canada)",
        "https://www.americanexpress.com/en-ca/",
        { institutionId: "ins_100533" },
        null,
        "CA",
      );
      const result = InstitutionMatcher.areInstitutionsMatched(
        amexUS,
        amexCanada,
      );
      expect(result.isMatch).toBe(false);
    });
  });

  describe("normalizeInstitutionName", () => {
    it("should remove generic banking terms", () => {
      const result =
        InstitutionMatcher.normalizeInstitutionName("Chase Bank Online");
      expect(result).toBe("chase");
    });

    it("should normalize @work variants", () => {
      const result = InstitutionMatcher.normalizeInstitutionName(
        "American Express - @ Work",
      );
      expect(result).toContain("@work");
    });

    it("should handle parenthetical country codes", () => {
      const result = InstitutionMatcher.normalizeInstitutionName(
        "American Express (Canada)",
      );
      expect(result).not.toContain("(");
    });
  });

  describe("deduplicateInstitutions", () => {
    it("should merge Plaid + MX for same institution", () => {
      const plaidChase = createTestInstitution(
        1,
        "Chase",
        "https://www.chase.com",
        { institutionId: "ins_56" },
        null,
      );
      const mxChase = createTestInstitution(
        2,
        "Chase",
        "https://www.chase.com",
        null,
        { institutionCode: "chase" },
      );

      const result = InstitutionMatcher.deduplicateInstitutions([
        plaidChase,
        mxChase,
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].providers).toContain("plaid");
      expect(result[0].providers).toContain("mx");
      expect(result[0].plaidData).toEqual({ institutionId: "ins_56" });
      expect(result[0].mxData).toEqual({ institutionCode: "chase" });
      expect(result[0].originalInstitutions).toHaveLength(2);
    });

    it("should keep separate institutions separate", () => {
      const chase = createTestInstitution(
        1,
        "Chase",
        "https://www.chase.com",
        { institutionId: "ins_56" },
        null,
      );
      const wellsFargo = createTestInstitution(
        2,
        "Wells Fargo",
        "https://www.wellsfargo.com",
        { institutionId: "ins_127991" },
        null,
      );

      const result = InstitutionMatcher.deduplicateInstitutions([
        chase,
        wellsFargo,
      ]);

      expect(result).toHaveLength(2);
    });

    it("should handle single institution", () => {
      const chase = createTestInstitution(
        1,
        "Chase",
        "https://www.chase.com",
        { institutionId: "ins_56" },
        null,
      );

      const result = InstitutionMatcher.deduplicateInstitutions([chase]);
      expect(result).toHaveLength(1);
      expect(result[0].providers).toEqual(["plaid"]);
    });

    it("should deduplicate BMO institutions with www1 and www subdomains", () => {
      const bmoMX = createTestInstitution(
        1,
        "BMO (Canada)",
        "https://www1.bmo.com/",
        null,
        { institutionCode: "bmo_mx" },
        "CA",
      );
      const bmoPlaid = createTestInstitution(
        2,
        "BMO Bank of Montreal",
        "https://www.bmo.com",
        { institutionId: "ins_bmo_plaid" },
        null,
        "CA",
      );

      const result = InstitutionMatcher.deduplicateInstitutions([
        bmoMX,
        bmoPlaid,
      ]);

      expect(result).toHaveLength(1);
      const merged = result[0];
      expect(merged.providers).toEqual(["mx", "plaid"]);
      expect(merged.originalInstitutions).toHaveLength(2);
    });

    it("should keep American Express @Work separate from regular", () => {
      const amexPlaid = createTestInstitution(
        1,
        "American Express",
        "https://www.americanexpress.com/us",
        { institutionId: "ins_10" },
        null,
        "US",
      );
      const amexWorkPlaid = createTestInstitution(
        2,
        "American Express - @ Work",
        "https://www.americanexpress.com/us",
        { institutionId: "ins_137213" },
        null,
        "US",
      );
      const amexMx = createTestInstitution(
        3,
        "American Express",
        "https://www.americanexpress.com",
        null,
        { institutionCode: "amex" },
        "US",
      );

      const result = InstitutionMatcher.deduplicateInstitutions([
        amexPlaid,
        amexWorkPlaid,
        amexMx,
      ]);

      // @Work should be separate, regular Amex Plaid + MX should merge
      expect(result).toHaveLength(2);

      const amexWork = result.find((r) =>
        r.originalInstitutions.some((o) => o.name.includes("@ Work")),
      );
      expect(amexWork).toBeDefined();
      expect(amexWork!.providers).toEqual(["plaid"]);

      const amexRegular = result.find(
        (r) => !r.originalInstitutions.some((o) => o.name.includes("@ Work")),
      );
      expect(amexRegular).toBeDefined();
      expect(amexRegular!.providers).toContain("plaid");
      expect(amexRegular!.providers).toContain("mx");
    });

    it("should prevent questrade vs e*trade false positive", () => {
      const questrade = createTestInstitution(
        1,
        "Questrade",
        "https://www.questrade.com",
        { institutionId: "ins_questrade" },
        null,
        "CA",
      );
      const etrade = createTestInstitution(
        2,
        "E*TRADE",
        "https://www.etrade.com",
        null,
        { institutionCode: "etrade" },
        "US",
      );

      const result = InstitutionMatcher.deduplicateInstitutions([
        questrade,
        etrade,
      ]);

      expect(result).toHaveLength(2);
    });
  });
});
