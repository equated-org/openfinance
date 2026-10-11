<script lang="ts">
  import { onMount } from "svelte";
  import type {
    ReconnectLinkStatus,
    ReconnectSession,
  } from "@openfinance/shared";
  import { ApiError } from "$lib/api-client";
  import {
    completeReconnect,
    getReconnectLink,
    startReconnectSession,
  } from "$lib/reconnect/api";
  import ReconnectView, {
    type ReconnectViewState,
  } from "$lib/reconnect/ReconnectView.svelte";
  import { loadPlaidSdk, loadQuilttSdk, type PlaidHandler } from "$lib/sync/sdk";

  // Poll quickly while a sync is new, then back off: a re-sync can wait on
  // the bank for many minutes.
  const FAST_POLL_MS = 3000;
  const SLOW_POLL_MS = 15_000;
  const FAST_POLL_FOR_MS = 2 * 60_000;
  // Finishing can hit a transient error after the bank sign-in succeeded.
  // Retry it rather than send the owner through the sign-in again.
  const COMPLETE_RETRY_DELAYS_MS = [1000, 3000];

  let token = "";
  let viewState = $state<ReconnectViewState>("loading");
  let link = $state<ReconnectLinkStatus | null>(null);
  let message = $state<string | null>(null);

  // Set once the owner finishes a sign-in here, so a connection that's back
  // to needing one reads as "the bank wants another sign-in".
  let reconnected = false;
  // A finished sign-in the server hasn't heard about yet.
  let pendingCompletion: (() => Promise<void>) | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollingSince = 0;
  let plaidHandler: PlaidHandler | null = null;

  function show(status: ReconnectLinkStatus) {
    link = status;
    viewState =
      status.state === "ready" && reconnected ? "failed" : status.state;

    if (status.state === "syncing") {
      schedulePoll();
    } else {
      stopPolling();
    }
    if (status.state === "ready") {
      // Have the SDK ready by the time the owner presses Reconnect.
      (status.provider === "plaid" ? loadPlaidSdk() : loadQuilttSdk()).catch(
        () => {},
      );
    }
  }

  function showError(err: unknown) {
    message = null;
    if (err instanceof ApiError && err.status === 404) viewState = "invalid";
    else if (err instanceof ApiError && err.status === 410)
      viewState = "expired";
    else viewState = "error";
  }

  async function load() {
    viewState = "loading";
    try {
      show(await getReconnectLink(token));
    } catch (err) {
      showError(err);
    }
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    pollingSince = 0;
  }

  function schedulePoll() {
    if (pollTimer) return;
    pollingSince ||= Date.now();
    const fast = Date.now() - pollingSince < FAST_POLL_FOR_MS;
    pollTimer = setTimeout(poll, fast ? FAST_POLL_MS : SLOW_POLL_MS);
  }

  async function poll() {
    pollTimer = null;
    // A hidden tab checks again as soon as it's shown.
    if (document.hidden) return;

    try {
      show(await getReconnectLink(token));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410))
        showError(err);
      else schedulePoll();
    }
  }

  function onVisibilityChange() {
    if (!document.hidden && viewState === "syncing" && !pollTimer) poll();
  }

  interface FlowResult {
    outcome: "success" | "cancelled" | "error";
    /** Quiltt's connection after the reconnect, which can be a new one. */
    connectionId?: string;
  }

  async function runProviderFlow(session: ReconnectSession): Promise<FlowResult> {
    if (session.provider === "plaid") {
      await loadPlaidSdk();
      return new Promise((resolve) => {
        plaidHandler?.destroy();
        plaidHandler = window.Plaid.create({
          token: session.linkToken,
          // Update mode keeps the Item's access token: nothing to exchange.
          onSuccess: () => resolve({ outcome: "success" }),
          onExit: (err) => resolve({ outcome: err ? "error" : "cancelled" }),
          onEvent: () => {},
        });
        plaidHandler.open();
      });
    }

    await loadQuilttSdk();
    return new Promise((resolve) => {
      window.Quiltt.authenticate(session.sessionToken);
      window.Quiltt.reconnect(session.connectorId, {
        connectionId: session.connectionId,
        onExitSuccess: (metadata) =>
          resolve({ outcome: "success", connectionId: metadata.connectionId }),
        onExitAbort: () => resolve({ outcome: "cancelled" }),
        onExitError: () => resolve({ outcome: "error" }),
      }).open();
    });
  }

  async function finish(connectionId?: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        show(await completeReconnect(token, connectionId));
        pendingCompletion = null;
        return;
      } catch (err) {
        const delay = COMPLETE_RETRY_DELAYS_MS[attempt];
        const retryable = !(err instanceof ApiError) || err.status >= 500;
        if (delay === undefined || !retryable) throw err;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  function showFinishError(err: unknown) {
    showError(err);
    if (viewState === "error") {
      message = `${link?.institutionName ?? "Your bank"} accepted your sign-in, but we couldn't finish reconnecting. Try again.`;
    }
  }

  async function reconnect() {
    viewState = "connecting";
    let result: FlowResult;
    try {
      result = await runProviderFlow(await startReconnectSession(token));
    } catch (err) {
      // Not needed any more (say, reconnected on another device): show why.
      if (err instanceof ApiError && err.status === 409) await load();
      else showError(err);
      return;
    }

    if (result.outcome === "cancelled") {
      if (link) show(link);
      return;
    }
    if (result.outcome === "error") {
      viewState = "error";
      message = `${link?.institutionName ?? "Your bank"}'s sign-in didn't finish. Try again.`;
      return;
    }

    reconnected = true;
    viewState = "syncing";
    pendingCompletion = () => finish(result.connectionId);
    try {
      await pendingCompletion();
    } catch (err) {
      showFinishError(err);
    }
  }

  async function retry() {
    if (!pendingCompletion) return load();
    viewState = "syncing";
    try {
      await pendingCompletion();
    } catch (err) {
      showFinishError(err);
    }
  }

  onMount(() => {
    // The token is in the fragment, which browsers never send to a server.
    token = window.location.hash.slice(1);
    document.addEventListener("visibilitychange", onVisibilityChange);
    load();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopPolling();
      plaidHandler?.destroy();
    };
  });
</script>

<svelte:head>
  <title>
    {link?.institutionName ? `Reconnect ${link.institutionName}` : "Reconnect"} · OpenFinance
  </title>
  <meta name="robots" content="noindex" />
</svelte:head>

<ReconnectView
  state={viewState}
  {link}
  {message}
  onReconnect={reconnect}
  onRetry={retry}
/>
