import { API_BASE } from "$lib/api-client";

// When an MCP connector's authorize request finds no session, better-auth sends
// the user to /login with the request's parameters, client_id among them.
export function isConnectorSignIn(url: URL): boolean {
  return url.pathname.startsWith("/login") && url.searchParams.has("client_id");
}

// Where to go after signing in so the connector's authorize request resumes.
export function connectorAuthorizeUrl(url: URL): string {
  const authorize = new URL(`${API_BASE}/api/auth/mcp/authorize`, url);
  authorize.search = url.search;
  return authorize.toString();
}
