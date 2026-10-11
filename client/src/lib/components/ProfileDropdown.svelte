<script lang="ts">
  import { authClient } from "$lib/auth-client";
  import {
    Avatar,
    AvatarImage,
    AvatarFallback,
  } from "$lib/components/ui/avatar";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from "$lib/components/ui/dropdown-menu";
  import ChevronsUpDown from "lucide-svelte/icons/chevrons-up-down";
  import SettingsDialog from "$lib/components/settings/SettingsDialog.svelte";

  const session = authClient.useSession();

  let settingsOpen = $state(false);

  function getInitials(name: string | null | undefined): string {
    if (!name?.trim()) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
</script>

<DropdownMenu>
  <DropdownMenuTrigger
    class="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-[var(--bg-muted)] transition-colors border-0 cursor-pointer"
  >
    <Avatar class="h-7 w-7">
      <AvatarImage src={$session.data?.user?.image} alt="" />
      <AvatarFallback class="text-sm font-medium text-[var(--text-muted)]"
        >{getInitials($session.data?.user?.name)}</AvatarFallback
      >
    </Avatar>
    <span class="sr-only sm:not-sr-only text-sm font-medium text-[var(--text)]"
      >{$session.data?.user?.name}</span
    >
    <ChevronsUpDown class="h-3.5 w-3.5 text-[var(--text-muted)]" />
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem
      onclick={() => (settingsOpen = true)}
      class="cursor-pointer"
    >
      Settings
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem
      onclick={() => authClient.signOut()}
      class="cursor-pointer"
    >
      Sign out
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

<SettingsDialog bind:isOpen={settingsOpen} />
