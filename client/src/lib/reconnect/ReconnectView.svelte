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
  import { AlertTriangle, Check, Clock, Unlink } from "lucide-svelte";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";

  interface Props {
    state: ReconnectViewState;
    link?: ReconnectLinkStatus | null;
    /** Shown in the error state. */
    message?: string | null;
    onReconnect?: () => void;
    onRetry?: () => void;
  }

  let {
    state,
    link = null,
    message = null,
    onReconnect,
    onRetry,
  }: Props = $props();

  const PROVIDER_NAMES = { plaid: "Plaid", quiltt: "Quiltt" } as const;

  const bank = $derived(link?.institutionName ?? null);
  const account = $derived(
    link
      ? `${link.accountName}${link.accountMask ? ` ••${link.accountMask}` : ""}`
      : "",
  );
  const expiresAt = $derived(
    link
      ? new Date(link.expiresAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "",
  );
</script>

{#snippet logo()}
  <InstitutionLogo
    institutionUrl={link?.institutionUrl ?? null}
    institutionLogoUrl={link?.institutionLogoUrl ?? null}
    institutionName={bank ?? undefined}
    size="lg"
    class="h-14 w-14 rounded-2xl border border-[var(--border)] bg-[var(--bg)]"
  />
{/snippet}

{#snippet badgedLogo(tone: "done" | "warn")}
  <div class="relative mx-auto h-14 w-14">
    {@render logo()}
    <span
      class="absolute -right-2 -bottom-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--bg)] text-white {tone ===
      'done'
        ? 'bg-emerald-500'
        : 'bg-amber-500'}"
    >
      {#if tone === "done"}
        <Check class="h-4 w-4" strokeWidth={3} />
      {:else}
        <AlertTriangle class="h-3.5 w-3.5" strokeWidth={2.5} />
      {/if}
    </span>
  </div>
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

<main
  class="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-muted)] px-4 py-10"
>
  <div
    class="w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--bg)] px-6 py-8 text-center shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)] sm:px-8"
  >
    {#if state === "loading"}
      <div class="flex justify-center py-10">
        <Spinner class="size-6 text-[var(--text-muted)]" />
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
        message ??
          "We couldn't reach OpenFinance. Check your connection and try again.",
      )}
      <Button class="mt-6 w-full" size="lg" onclick={onRetry}>Try again</Button>
    {:else if state === "ready" || state === "connecting"}
      <div class="flex justify-center">{@render logo()}</div>
      <p class="eyebrow mt-6">Reconnect</p>
      <h1 class="mt-2 text-xl font-semibold text-[var(--text)]">
        {bank ?? "Your bank"}
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        Sign in to {bank ?? "your bank"} again to keep
        <span class="font-mono text-[13px] whitespace-nowrap text-[var(--text)]"
          >{account}</span
        > syncing.
      </p>
      <Button
        class="mt-7 w-full"
        size="lg"
        disabled={state === "connecting"}
        onclick={onReconnect}
      >
        {#if state === "connecting"}
          <Spinner />
          Opening {link ? PROVIDER_NAMES[link.provider] : ""}…
        {:else}
          Reconnect
        {/if}
      </Button>
      {#if link}
        <p class="mt-4 font-mono text-[11px] text-[var(--text-muted)]">
          via {PROVIDER_NAMES[link.provider]} · expires {expiresAt}
        </p>
      {/if}
    {:else if state === "syncing" || state === "synced"}
      {@render badgedLogo("done")}
      <h1 class="mt-6 text-xl font-semibold text-[var(--text)]">
        {bank ?? "Your bank"} is connected
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        You can close this page. New transactions will appear as {bank ??
          "your bank"} sends them.
      </p>
    {:else if state === "failed"}
      {@render badgedLogo("warn")}
      <h1 class="mt-6 text-xl font-semibold text-[var(--text)]">
        {bank ?? "Your bank"} still needs you
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        {bank ?? "Your bank"} asked you to sign in again.
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
