<script lang="ts">
  import { page } from "$app/stores";
  import House from "lucide-svelte/icons/house";
  import Wallet from "lucide-svelte/icons/wallet";
  import ArrowLeftRight from "lucide-svelte/icons/arrow-left-right";
  import Plug from "lucide-svelte/icons/plug";

  interface Props {
    /** Called when a nav link is clicked, e.g. to close the mobile drawer. */
    onNavigate?: () => void;
  }

  let { onNavigate }: Props = $props();

  const navItems = [
    { href: "/", label: "Home", icon: House },
    { href: "/accounts", label: "Accounts", icon: Wallet },
    { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
    { href: "/connect", label: "Connect", icon: Plug },
  ];

  function isActive(pathname: string, href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }
</script>

<nav class="w-48 pt-2 space-y-1.5">
  {#each navItems as item}
    {@const active = isActive($page.url.pathname, item.href)}
    <a
      href={item.href}
      onclick={onNavigate}
      class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-full transition-colors {active
        ? 'bg-[var(--bg-muted)] text-[var(--text)]'
        : 'text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)]'}"
    >
      <item.icon class="h-5 w-5" />
      {item.label}
    </a>
  {/each}
</nav>
