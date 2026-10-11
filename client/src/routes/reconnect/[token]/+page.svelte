<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
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

  const POLL_INTERVAL_MS = 3000;
  // After a reconnect, Plaid's sync waits for the bank to send fresh data,
  // which can take minutes. Say so once it's been running a while.
  const SLOW_AFTER_MS = 45_000;
  // The server gives up waiting on the bank after about 20 minutes.
  const STOP_POLLING_AFTER_MS = 20 * 60_000;

  const token = $derived(page.params.token ?? "");

  let viewState = $state<ReconnectViewState>("loading");
  let link = $state<ReconnectLinkStatus | null>(null);
  let message = $state<string | null>(null);
  let slow = $state(false);

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let syncStartedAt = 0;
  let plaidHandler: PlaidHandler | null = null;

  function show(status: ReconnectLinkStatus) {
    link = status;
    message = status.message;
    viewState = status.state;
    if (status.state === "syncing") schedulePoll();
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

  function schedulePoll() {
    if (pollTimer) return;
    syncStartedAt ||= Date.now();

    pollTimer = setTimeout(async () => {
      pollTimer = null;
      const elapsed = Date.now() - syncStartedAt;
      slow = elapsed > SLOW_AFTER_MS;
      if (elapsed > STOP_POLLING_AFTER_MS) return;

      try {
        show(await getReconnectLink(token));
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
          showError(err);
        } else {
          schedulePoll();
        }
      }
    }, POLL_INTERVAL_MS);
  }

  type FlowOutcome = "success" | "cancelled" | "error";

  async function runProviderFlow(session: ReconnectSession): Promise<FlowOutcome> {
    if (session.provider === "plaid") {
      await loadPlaidSdk();
      return new Promise((resolve) => {
        plaidHandler?.destroy();
        plaidHandler = window.Plaid.create({
          token: session.linkToken,
          // Update mode keeps the Item's access token: nothing to exchange.
          onSuccess: () => resolve("success"),
          onExit: (err) => resolve(err ? "error" : "cancelled"),
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
        onExitSuccess: () => resolve("success"),
        onExitAbort: () => resolve("cancelled"),
        onExitError: () => resolve("error"),
      }).open();
    });
  }

  async function reconnect() {
    viewState = "connecting";
    try {
      const outcome = await runProviderFlow(await startReconnectSession(token));
      if (outcome === "cancelled") {
        viewState = "ready";
        return;
      }
      if (outcome === "error") {
        viewState = "error";
        message = `${link?.institutionName ?? "Your bank"}'s sign-in didn't finish. Try again.`;
        return;
      }

      viewState = "syncing";
      slow = false;
      syncStartedAt = Date.now();
      show(await completeReconnect(token));
    } catch (err) {
      // Already reconnected (say, from another tab): show where it got to.
      if (err instanceof ApiError && err.status === 409) await load();
      else showError(err);
    }
  }

  onMount(load);

  onDestroy(() => {
    if (pollTimer) clearTimeout(pollTimer);
    plaidHandler?.destroy();
  });
</script>

<svelte:head>
  <title>
    {link ? `Reconnect ${link.institutionName}` : "Reconnect"} · OpenFinance
  </title>
  <meta name="robots" content="noindex" />
</svelte:head>

<ReconnectView
  state={viewState}
  {link}
  {message}
  {slow}
  onReconnect={reconnect}
  onRetry={load}
/>
