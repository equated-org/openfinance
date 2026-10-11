<script lang="ts">
  import type { ConnectedAccount } from "@openfinance/shared";
  import type { EmblaCarouselType } from "embla-carousel";
  import AccountCard from "./AccountCard.svelte";
  import emblaCarouselSvelte from "embla-carousel-svelte";
  import ChevronLeft from "lucide-svelte/icons/chevron-left";
  import ChevronRight from "lucide-svelte/icons/chevron-right";

  interface Props {
    accounts: ConnectedAccount[];
    onReauth?: (account: ConnectedAccount) => void;
    onAccountClick?: (accountId: number) => void;
  }

  let {
    accounts,
    onReauth = undefined,
    onAccountClick = undefined,
  }: Props = $props();

  let emblaApi: EmblaCarouselType | undefined = $state();
  let canScrollPrev = $state(false);
  let canScrollNext = $state(false);

  function onInit(event: CustomEvent<EmblaCarouselType>) {
    emblaApi = event.detail;
    updateButtons();
    emblaApi.on("select", updateButtons);
    emblaApi.on("reInit", updateButtons);
  }

  function updateButtons() {
    if (!emblaApi) return;
    canScrollPrev = emblaApi.canScrollPrev();
    canScrollNext = emblaApi.canScrollNext();
  }
</script>

<!-- Bleeds into the page gutter (px-4 on mobile, px-8 from md) so cards scroll to the edge. -->
<div
  class="relative group -mx-4 md:-mx-8"
  role="region"
  aria-label="Accounts carousel"
>
  <div
    class="overflow-hidden"
    use:emblaCarouselSvelte={{
      options: { align: "start", containScroll: "trimSnaps", dragFree: true },
      plugins: [],
    }}
    onemblaInit={onInit}
  >
    <div class="flex gap-4 px-4 md:px-8">
      {#each accounts as account (account.id)}
        <div class="flex-shrink-0">
          <AccountCard {account} {onReauth} onClick={onAccountClick} />
        </div>
      {/each}
    </div>
  </div>

  {#if canScrollPrev}
    <button
      class="absolute left-2 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg)] text-[var(--text)] rounded-full p-1.5 shadow-md hover:bg-[var(--bg-muted)] hover:text-[var(--text)]"
      onclick={() => emblaApi?.scrollPrev()}
      aria-label="Scroll left"
    >
      <ChevronLeft size={18} />
    </button>
  {/if}

  {#if canScrollNext}
    <button
      class="absolute right-2 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg)] text-[var(--text)] rounded-full p-1.5 shadow-md hover:bg-[var(--bg-muted)] hover:text-[var(--text)]"
      onclick={() => emblaApi?.scrollNext()}
      aria-label="Scroll right"
    >
      <ChevronRight size={18} />
    </button>
  {/if}
</div>
