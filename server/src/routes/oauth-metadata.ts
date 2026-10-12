import { Hono } from "hono";
import {
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
} from "better-auth/plugins";
import { auth } from "../auth.js";

// Discovery documents MCP clients read to find the OAuth server behind /mcp.
const authorizationServer = oAuthDiscoveryMetadata(auth);
const protectedResource = oAuthProtectedResourceMetadata(auth);

const oauthMetadataRoutes = new Hono();

oauthMetadataRoutes.get("/oauth-authorization-server", (c) =>
  authorizationServer(c.req.raw),
);
oauthMetadataRoutes.get("/oauth-protected-resource", (c) =>
  protectedResource(c.req.raw),
);
// Some clients add the resource's path to the metadata URL.
oauthMetadataRoutes.get("/oauth-protected-resource/mcp", (c) =>
  protectedResource(c.req.raw),
);

export default oauthMetadataRoutes;
