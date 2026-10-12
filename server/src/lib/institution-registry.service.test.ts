import { randomUUID } from "crypto";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { institutionRegistry } from "../schema";

const mx = vi.hoisted(() => ({ configured: false }));
vi.mock("./sync/mx.client", () => ({
  isMxConfigured: () => mx.configured,
}));

const { institutionRegistryService } =
  await import("./institution-registry.service");

describe("InstitutionRegistryService", () => {
  const suffix = randomUUID().slice(0, 8);
  // Each name is searched on its own: a query matching several rows lets
  // InstitutionMatcher merge them, and these names differ only by prefix.
  const tag = `ZzsrchTag${suffix}`;
  const plaidName = `AlphaBank ${tag}`;
  const mxName = `GammaSavings ${tag}`;
  const quilttName = `BetaCredit ${tag}`;
  let insertedIds: number[] = [];

  beforeAll(async () => {
    const rows = await db
      .insert(institutionRegistry)
      .values([
        {
          name: plaidName,
          countryCode: "US",
          providerCompositeKey: `plaid_${suffix}_p`,
          plaidData: {
            institutionId: `ins_${suffix}_p`,
            countryCodes: ["US"],
            oauth: true,
            products: ["transactions"],
            routingNumbers: [],
          },
          supportedAccountTypes: ["depository"],
          lastSynced: new Date(),
        },
        {
          name: mxName,
          countryCode: "US",
          providerCompositeKey: `mx_${suffix}_mx`,
          mxData: {
            institutionCode: `${suffix}_mx`,
            name: mxName,
          },
          supportedAccountTypes: ["depository"],
          lastSynced: new Date(),
        },
        // The shape QuilttService writes when a connection is made.
        {
          name: quilttName,
          logo: "https://cdn.quiltt.io/institutions/logo.png",
          countryCode: "",
          providerCompositeKey: `quiltt_inst_${suffix}`,
          lastSynced: new Date(),
        },
        // A top-list bank in both catalogs.
        {
          name: "Chase",
          countryCode: "US",
          providerCompositeKey: "plaid_ins_56",
          plaidData: {
            institutionId: "ins_56",
            countryCodes: ["US"],
            oauth: true,
            products: ["transactions"],
            routingNumbers: [],
          },
          lastSynced: new Date(),
        },
        {
          name: "Chase",
          countryCode: "US",
          providerCompositeKey: "mx_chase",
          mxData: { institutionCode: "chase", name: "Chase" },
          lastSynced: new Date(),
        },
      ])
      .returning({ id: institutionRegistry.id });
    insertedIds = rows.map((r) => r.id);
  });

  afterEach(() => {
    mx.configured = false;
  });

  afterAll(async () => {
    if (insertedIds.length) {
      await db
        .delete(institutionRegistry)
        .where(inArray(institutionRegistry.id, insertedIds));
    }
  });

  async function searchNames(query: string) {
    const results = await institutionRegistryService.searchInstitutions({
      query,
    });
    return results.map((r) => r.name);
  }

  it("offers Plaid rows, and MX rows only when MX is configured", async () => {
    expect(await searchNames(plaidName)).toEqual([plaidName]);
    expect(await searchNames(mxName)).toEqual([]);

    mx.configured = true;
    expect(await searchNames(mxName)).toEqual([mxName]);
  });

  it("never offers a row written for a Quiltt connection", async () => {
    expect(await searchNames(quilttName)).toEqual([]);

    mx.configured = true;
    expect(await searchNames(quilttName)).toEqual([]);
  });

  it("leaves MX out of the top list when MX isn't configured", async () => {
    const top = await institutionRegistryService.getTopInstitutions({
      country: "US",
    });
    expect(top.find((i) => i.name === "Chase")?.providers).toEqual(["plaid"]);

    mx.configured = true;
    const merged = await institutionRegistryService.getTopInstitutions({
      country: "US",
    });
    expect(merged.find((i) => i.name === "Chase")?.providers?.sort()).toEqual(
      ["mx", "plaid"],
    );
  });
});
