<script lang="ts">
  import { LoaderCircle, Check, X } from "lucide-svelte";
  import { syncStatus, dismiss } from "./sync-status";
</script>

{#if $syncStatus.syncing}
  <div
    class="fixed top-4 left-1/2 -translate-x-1/2 w-max max-w-[calc(100vw-2rem)] bg-zinc-900/95 border border-white/15 rounded-full shadow-xl px-6 py-3 flex items-center gap-3 z-50 backdrop-blur-sm"
  >
    <LoaderCircle class="animate-spin h-4 w-4 shrink-0 text-white/80" />
    <span class="text-sm text-white truncate">
      Syncing{$syncStatus.syncingInstitutions.length > 0
        ? ` ${$syncStatus.syncingInstitutions.join(", ")}`
        : ""}...
    </span>
  </div>
{:else if $syncStatus.completed}
  <div
    class="fixed top-4 left-1/2 -translate-x-1/2 w-max max-w-[calc(100vw-2rem)] bg-zinc-900/95 border border-white/15 rounded-full shadow-xl px-6 py-3 flex items-center gap-3 z-50 backdrop-blur-sm"
  >
    <Check class="h-4 w-4 shrink-0 text-green-400" />
    <span class="text-sm text-white truncate">Account sync completed</span>
    <button
      class="text-white/60 hover:text-white ml-1 shrink-0"
      onclick={dismiss}
      aria-label="Dismiss"
    >
      <X class="h-4 w-4" />
    </button>
  </div>
{/if}
