<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import Circle from "lucide-svelte/icons/circle";
  import CircleCheck from "lucide-svelte/icons/circle-check";
  import X from "lucide-svelte/icons/x";

  interface Props {
    onConnectAccount: () => void;
    onDismiss: () => void;
    accountConnected?: boolean;
    mcpLinked?: boolean;
  }

  let {
    onConnectAccount,
    onDismiss,
    accountConnected = false,
    mcpLinked = false,
  }: Props = $props();
</script>

<section class="mb-8">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-base font-semibold text-[var(--text)]">Getting Started</h2>
    <Button
      variant="ghost"
      size="icon"
      class="text-[var(--text-muted)] hover:text-[var(--text-muted)] -mr-1"
      onclick={onDismiss}
      aria-label="Dismiss getting started"
    >
      <X class="h-4 w-4" />
    </Button>
  </div>
  <div class="space-y-1">
    <div
      class="flex items-center justify-between gap-3 rounded-lg p-4 hover:bg-[var(--bg-muted)] transition-colors"
    >
      <div class="flex items-center gap-3 min-w-0">
        {#if accountConnected}
          <CircleCheck class="h-4 w-4 text-green-500 shrink-0" />
        {:else}
          <Circle class="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        {/if}
        <div class="min-w-0">
          <p
            class="text-sm font-medium text-[var(--text)]"
            class:line-through={accountConnected}
            class:text-[var(--text-muted)]={accountConnected}
          >
            Connect an account
          </p>
          <p class="text-xs text-[var(--text-muted)] mt-0.5">
            Link a bank to start tracking your finances.
          </p>
        </div>
      </div>
      {#if !accountConnected}
        <Button
          variant="outline"
          size="sm"
          class="shrink-0"
          onclick={onConnectAccount}>Connect</Button
        >
      {/if}
    </div>

    <div
      class="flex items-center justify-between gap-3 rounded-lg p-4 hover:bg-[var(--bg-muted)] transition-colors"
    >
      <div class="flex items-center gap-3 min-w-0">
        {#if mcpLinked}
          <CircleCheck class="h-4 w-4 text-green-500 shrink-0" />
        {:else}
          <Circle class="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        {/if}
        <div class="min-w-0">
          <p
            class="text-sm font-medium text-[var(--text)]"
            class:line-through={mcpLinked}
            class:text-[var(--text-muted)]={mcpLinked}
          >
            Link to your MCP server
          </p>
          <p class="text-xs text-[var(--text-muted)] mt-0.5">
            Connect your accounts to AI via MCP.
          </p>
        </div>
      </div>
      {#if !mcpLinked}
        <Button
          variant="outline"
          size="sm"
          class="shrink-0"
          onclick={() => goto("/connect")}
        >
          Set up
        </Button>
      {/if}
    </div>
  </div>
</section>
