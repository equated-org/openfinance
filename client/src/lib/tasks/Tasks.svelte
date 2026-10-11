<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import AlertTriangle from "lucide-svelte/icons/triangle-alert";
  import type { Task } from "./api";

  interface Props {
    tasks: Task[];
    onReconnect: (accountId: number) => void;
  }

  let { tasks, onReconnect }: Props = $props();
</script>

{#if tasks.length > 0}
  <section>
    <h2 class="text-base font-semibold text-[var(--text)] mb-4">Tasks</h2>
    <div class="space-y-1">
      {#each tasks as task (task.id)}
        <div
          class="flex items-center justify-between gap-3 rounded-lg p-4 hover:bg-[var(--bg-muted)] transition-colors"
        >
          <div class="flex items-center gap-3 min-w-0">
            <AlertTriangle class="h-4 w-4 text-amber-500 shrink-0" />
            <div class="min-w-0">
              <p class="text-sm font-medium text-[var(--text)]">{task.title}</p>
              <p class="text-xs text-[var(--text-muted)] mt-0.5">{task.description}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            onclick={() => onReconnect(task.accountId)}>Reconnect</Button
          >
        </div>
      {/each}
    </div>
  </section>
{/if}
