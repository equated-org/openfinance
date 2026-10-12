import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { SearchInstitutionsResponse } from "@openfinance/shared";
import { type AuthEnv } from "$lib/middleware";
import { institutionRegistryService } from "$lib/institution-registry.service";

const searchQuerySchema = z.object({
  query: z.string().optional(),
  country: z.string().optional(),
});

const institutionRoutes = new Hono<AuthEnv>();

// GET /api/institutions/search?query=&country=
institutionRoutes.get(
  "/search",
  zValidator("query", searchQuerySchema),
  async (c) => {
    const q = c.req.valid("query");
    const result = await institutionRegistryService.searchInstitutions(q);
    const response: SearchInstitutionsResponse = { institutions: result };
    return c.json(response);
  },
);

export default institutionRoutes;
