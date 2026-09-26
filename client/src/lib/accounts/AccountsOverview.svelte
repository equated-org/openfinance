<script lang="ts">
  import type { ConnectedAccount } from "@openfinance/shared";
  import { Button } from "$lib/components/ui/button";
  import { Plus } from "lucide-svelte";
  import AccountCarousel from "./AccountCarousel.svelte";
  import { balanceBuckets } from "./utils";

  interface Props {
    accounts: ConnectedAccount[];
    onAddAccount?: () => void;
    onReauth?: (account: ConnectedAccount) => void;
    onAccountClick?: (accountId: number) => void;
  }

  let {
    accounts,
    onAddAccount = undefined,
    onReauth = undefined,
    onAccountClick = undefined,
  }: Props = $props();

  // Cash, investments, and loans are totalled separately (see balanceBuckets),
  // each with one total per currency — balances are never converted between
  // currencies. A lone currency reads fine as a symbol ("CA$182,180.48"), but
  // once the header holds several, every figure gets its ISO code so no line
  // can be mistaken for a second figure about the same money.
  let buckets = $derived.by(() => {
    const buckets = balanceBuckets(accounts);
    const currencies = new Set(
      buckets.flatMap((b) => b.totals.map((t) => t.currency)),
    );
    const currencyDisplay = currencies.size > 1 ? "code" : "symbol";
    return buckets.map(({ key, label, totals }) => ({
      key,
      label,
      totals: totals.map(({ currency, amount }) => ({
        currency,
        formatted: new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          currencyDisplay,
        }).format(amount),
      })),
    }));
  });
</script>

<section>
  <div class="flex items-center justify-between gap-6 mb-4">
    <div class="flex flex-wrap gap-x-12 gap-y-4">
      {#each buckets as bucket (bucket.key)}
        <div>
          <p class="text-xs text-[var(--text-muted)]">{bucket.label}</p>
          {#each bucket.totals as total (total.currency)}
            <p class="text-2xl font-semibold text-[var(--text)] leading-snug">
              {total.formatted}
            </p>
          {/each}
        </div>
      {/each}
    </div>
    <Button
      variant="linkBlue"
      size="link"
      class="shrink-0"
      onclick={onAddAccount}
    >
      <Plus class="h-3.5 w-3.5" />
      add account
    </Button>
  </div>
  <AccountCarousel {accounts} {onReauth} {onAccountClick} />
</section>
