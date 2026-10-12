// Provider SDKs load from their CDNs on first use instead of being bundled.

export interface PlaidCreateConfig {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidSuccessMetadata) => void;
  onExit: (err: PlaidError | null, metadata: PlaidExitMetadata) => void;
  onEvent: (eventName: string, metadata: Record<string, unknown>) => void;
}

export interface PlaidHandler {
  open: () => void;
  exit: (options?: { force: boolean }) => void;
  destroy: () => void;
}

export interface PlaidSuccessMetadata {
  institution: { institution_id: string; name: string } | null;
  accounts: Array<{
    id: string;
    name: string;
    mask: string;
    type: string;
    subtype: string;
  }>;
  link_session_id: string;
}

export interface PlaidExitMetadata {
  institution: { institution_id: string; name: string } | null;
  status: string;
  link_session_id: string;
}

export interface PlaidError {
  error_type: string;
  error_code: string;
  error_message: string;
  display_message: string | null;
}

export interface QuilttMetadata {
  connectorId: string;
  profileId?: string;
  connectionId?: string;
}

export interface QuilttCallbacks {
  onLoad?: (metadata: QuilttMetadata) => void;
  onExitSuccess?: (metadata: QuilttMetadata) => void;
  onExitAbort?: (metadata: QuilttMetadata) => void;
  onExitError?: (metadata: QuilttMetadata) => void;
}

interface QuilttSdk {
  authenticate: (token: string) => void;
  connect: (
    connectorId: string,
    options: QuilttCallbacks,
  ) => { open: () => void };
  reconnect: (
    connectorId: string,
    options: QuilttCallbacks & { connectionId: string },
  ) => { open: () => void };
}

declare global {
  interface Window {
    Plaid: { create: (config: PlaidCreateConfig) => PlaidHandler };
    Quiltt: QuilttSdk;
  }
}

const loadingScripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let loading = loadingScripts.get(src);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => {
        loadingScripts.delete(src);
        reject(new Error(`Failed to load ${src}`));
      };
      document.head.appendChild(script);
    });
    loadingScripts.set(src, loading);
  }
  return loading;
}

export function loadPlaidSdk(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return loadScript("https://cdn.plaid.com/link/v2/stable/link-initialize.js");
}

export function loadQuilttSdk(): Promise<void> {
  if (window.Quiltt) return Promise.resolve();
  return loadScript("https://cdn.quiltt.io/v1/connector.js");
}
