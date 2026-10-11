<script lang="ts" module>
  export type ReconnectViewState =
    | "loading"
    | "invalid"
    | "expired"
    | "error"
    | "ready"
    | "connecting"
    | "syncing"
    | "synced"
    | "failed";
</script>

<script lang="ts">
  import type { ReconnectLinkStatus } from "@openfinance/shared";
  import {
    AlertTriangle,
    Check,
    Clock,
    LoaderCircle,
    Unlink,
  } from "lucide-svelte";
  import { Button } from "$lib/components/ui/button";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";

  interface Props {
    state: ReconnectViewState;
    link?: ReconnectLinkStatus | null;
    message?: string | null;
    /** The sync has been running long enough to say it can take a while. */
    slow?: boolean;
    onReconnect?: () => void;
    onRetry?: () => void;
  }

  let {
    state,
    link = null,
    message = null,
    slow = false,
    onReconnect,
    onRetry,
  }: Props = $props();

  const PROVIDER_NAMES = { plaid: "Plaid", quiltt: "Quiltt" } as const;

  const institution = $derived(link?.institutionName ?? "your bank");
  const account = $derived(
    link
      ? `${link.accountName}${link.accountMask ? ` ••${link.accountMask}` : ""}`
      : "",
  );

  function expiresIn(expiresAt: string): string {
    const minutes = Math.max(
      1,
      Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000),
    );
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
</script>

{#snippet logo(size: "sm" | "lg" = "lg")}
  <InstitutionLogo
    institutionUrl={link?.institutionUrl ?? null}
    institutionName={link?.institutionName}
    size="lg"
    class={size === "lg"
      ? "h-14 w-14 rounded-2xl border border-[var(--border)] bg-[var(--bg)]"
      : ""}
  />
{/snippet}

{#snippet notice(Icon: typeof Clock, title: string, body: string)}
  <div
    class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-muted)] text-[var(--text-muted)]"
  >
    <Icon class="h-5 w-5" />
  </div>
  <h1 class="mt-5 text-xl font-semibold text-[var(--text)]">{title}</h1>
  <p class="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{body}</p>
{/snippet}

{#snippet step(label: string, status: "done" | "active" | "todo")}
  <li class="flex items-center gap-3">
    {#if status === "done"}
      <span
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)]"
      >
        <Check class="h-3 w-3" strokeWidth={3} />
      </span>
    {:else if status === "active"}
      <span
        class="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text)] motion-reduce:animate-none"
      ></span>
    {:else}
      <span
        class="h-5 w-5 shrink-0 rounded-full border-2 border-[var(--border)]"
      ></span>
    {/if}
    <span
      class={status === "todo"
        ? "text-[var(--text-muted)]"
        : "text-[var(--text)]"}>{label}</span
    >
  </li>
{/snippet}

<main
  class="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-muted)] px-4 py-10"
>
  <div
    class="w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--bg)] px-6 py-8 text-center shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)] sm:px-8"
  >
    {#if state === "loading"}
      <div class="flex justify-center py-10">
        <LoaderCircle
          class="h-6 w-6 animate-spin text-[var(--text-muted)]"
          aria-label="Loading"
        />
      </div>
    {:else if state === "invalid"}
      {@render notice(
        Unlink,
        "This link isn't valid",
        "Check that you opened the whole link, or ask for a new one.",
      )}
    {:else if state === "expired"}
      {@render notice(
        Clock,
        "This link has expired",
        "Reconnect links work for 24 hours. Ask for a new one to reconnect your account.",
      )}
    {:else if state === "error"}
      {@render notice(
        AlertTriangle,
        "Something went wrong",
        message ?? "We couldn't reach OpenFinance. Check your connection and try again.",
      )}
      <Button class="mt-6 w-full" size="lg" onclick={onRetry}>Try again</Button>
    {:else if state === "ready" || state === "connecting"}
      <div class="flex justify-center">{@render logo()}</div>
      <p class="eyebrow mt-6">Reconnect</p>
      <h1 class="mt-2 text-xl font-semibold text-[var(--text)]">
        {institution}
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        Sign in to {institution} again to keep
        <span class="font-mono text-[var(--text)]">{account}</span> syncing.
      </p>
      <Button
        class="mt-7 w-full"
        size="lg"
        disabled={state === "connecting"}
        onclick={onReconnect}
      >
        {#if state === "connecting"}
          <LoaderCircle class="animate-spin" />
          Opening {link ? PROVIDER_NAMES[link.provider] : ""}…
        {:else}
          Reconnect
        {/if}
      </Button>
      {#if link}
        <p class="mt-4 font-mono text-[11px] text-[var(--text-muted)]">
          via {PROVIDER_NAMES[link.provider]} · expires in {expiresIn(
            link.expiresAt,
          )}
        </p>
      {/if}
    {:else if state === "syncing"}
      <div class="relative mx-auto flex h-24 w-24 items-center justify-center">
        <span
          class="absolute inset-0 rounded-full bg-[var(--text)] animate-sync-pulse motion-reduce:hidden"
        ></span>
        <svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="var(--border)"
            stroke-width="3"
          />
        </svg>
        <svg
          class="absolute inset-0 h-full w-full animate-spin [animation-duration:1.4s] motion-reduce:animate-none"
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="var(--text)"
            stroke-width="3"
            stroke-linecap="round"
            stroke-dasharray="72 217"
          />
        </svg>
        {@render logo()}
      </div>
      <h1 class="mt-6 text-xl font-semibold text-[var(--text)]">
        Syncing {institution}
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        Pulling in your latest balances and transactions.
      </p>
      <div
        class="relative mt-6 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]"
        role="progressbar"
        aria-label="Syncing"
      >
        <span
          class="absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--text)] animate-indeterminate motion-reduce:animate-none"
        ></span>
      </div>
      <ul class="mt-6 space-y-3 text-left text-sm">
        {@render step(`Reconnected to ${institution}`, "done")}
        {@render step("Syncing transactions", "active")}
        {@render step("Up to date", "todo")}
      </ul>
      {#if slow}
        <p class="mt-6 text-xs leading-relaxed text-[var(--text-muted)]">
          This can take a few minutes. You can close this page; syncing keeps
          going in the background.
        </p>
      {/if}
    {:else if state === "synced"}
      <div class="relative mx-auto flex h-24 w-24 items-center justify-center">
        <svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="var(--text)"
            stroke-width="3"
          />
        </svg>
        {@render logo()}
        <span
          class="absolute right-1 bottom-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--bg)] bg-emerald-500 text-white"
        >
          <Check class="h-4 w-4" strokeWidth={3} />
        </span>
      </div>
      <h1 class="mt-6 text-xl font-semibold text-[var(--text)]">
        {institution} is reconnected
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        {message ?? "Your transactions are up to date."} You can close this page.
      </p>
      <ul class="mt-6 space-y-3 text-left text-sm">
        {@render step(`Reconnected to ${institution}`, "done")}
        {@render step("Synced transactions", "done")}
        {@render step("Up to date", message ? "todo" : "done")}
      </ul>
    {:else if state === "failed"}
      <div class="relative mx-auto flex h-24 w-24 items-center justify-center">
        {@render logo()}
        <span
          class="absolute right-3 bottom-3 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--bg)] bg-amber-500 text-white"
        >
          <AlertTriangle class="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
      </div>
      <h1 class="mt-4 text-xl font-semibold text-[var(--text)]">
        {institution} still needs you
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        {message ?? "Your bank asked you to sign in again."}
      </p>
      <Button class="mt-7 w-full" size="lg" onclick={onReconnect}>
        Try again
      </Button>
    {/if}
  </div>

  <a
    href="https://openfinance.sh"
    class="mt-6 flex items-center gap-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
  >
    <img src="/favicon.svg" alt="" class="h-4 w-4" />
    OpenFinance
  </a>
</main>
