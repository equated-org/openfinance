<script lang="ts">
  import type { InstitutionType } from "@openfinance/shared";
  import { getInstitutionLogoUrls } from "$lib/accounts/utils";
  import { cn } from "$lib/utils";

  interface Props {
    /** Object mode: pass a full institution (for InstitutionSearch with base64/logoUrl) */
    institution?: InstitutionType;
    /** String mode: pass url + name (for accounts, transactions, notifications) */
    institutionUrl?: string | null;
    /** String mode: the provider's own logo, for when logo.dev has none */
    institutionLogoUrl?: string | null;
    institutionName?: string;
    size?: "sm" | "md" | "lg";
    class?: string;
  }

  const SIZE_CONFIG = {
    sm: { container: "w-5 h-5 rounded", apiSize: 32, text: "text-xs" },
    md: { container: "w-8 h-8 rounded-lg", apiSize: 64, text: "text-xs" },
    lg: { container: "w-10 h-10 rounded-lg", apiSize: 64, text: "text-sm" },
  } as const;

  let {
    institution,
    institutionUrl,
    institutionLogoUrl,
    institutionName,
    size = "sm",
    class: className,
  }: Props = $props();

  const config = $derived(SIZE_CONFIG[size]);

  const name = $derived(institution?.name ?? institutionName ?? "?");

  // Object mode: base64 logo from Plaid
  const base64Src = $derived.by(() => {
    if (!institution?.logo) return null;
    const logo = institution.logo;
    if (
      logo.startsWith("http://") ||
      logo.startsWith("https://") ||
      logo.startsWith("data:")
    ) {
      return null;
    }
    return `data:image/png;base64,${logo}`;
  });

  // Object mode: logoUrl (e.g. MX medium logo)
  const objectLogoUrl = $derived(institution?.logoUrl ?? null);

  // String mode: logo.dev by homepage, then the provider's logo. A logo that
  // fails to load moves on to the next, and past the last to the letter below.
  const stringLogoUrls = $derived(
    !institution
      ? getInstitutionLogoUrls(
          institutionUrl ?? null,
          institutionLogoUrl ?? null,
          config.apiSize,
        )
      : [],
  );
  let missed = $state<string[]>([]);
  const stringLogoUrl = $derived(
    stringLogoUrls.find((src) => !missed.includes(src)) ?? null,
  );

  // Final resolved image src: base64 → logoUrl → string mode's logo
  const imgSrc = $derived(base64Src ?? objectLogoUrl ?? stringLogoUrl);

  const primaryColor = $derived(institution?.primaryColor ?? null);
</script>

<span
  class={cn(
    "flex-shrink-0 overflow-hidden flex items-center justify-center",
    imgSrc ? "" : "bg-[var(--bg-muted)]",
    config.container,
    className,
  )}
  style={!imgSrc && primaryColor
    ? `background-color: ${primaryColor}`
    : undefined}
>
  {#if imgSrc}
    <img
      src={imgSrc}
      alt={name}
      class="w-full h-full object-contain"
      onerror={() => {
        if (stringLogoUrl) missed = [...missed, stringLogoUrl];
      }}
    />
  {:else}
    <span
      class={cn(
        "font-medium",
        primaryColor ? "text-white" : "text-[var(--text-muted)]",
        config.text,
      )}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  {/if}
</span>
