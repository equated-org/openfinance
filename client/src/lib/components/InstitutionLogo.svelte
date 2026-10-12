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

  // Logos to try, best first. Object mode: Plaid's base64 logo, then MX's
  // logo URL. String mode: logo.dev by homepage, then the provider's logo. One
  // that fails to load moves on to the next, and past the last to the letter.
  const candidates = $derived(
    (institution
      ? [base64Logo(institution.logo), institution.logoUrl ?? null]
      : getInstitutionLogoUrls(
          institutionUrl ?? null,
          institutionLogoUrl ?? null,
          config.apiSize,
        )
    ).filter((src): src is string => !!src),
  );
  let missed = $state<string[]>([]);
  const imgSrc = $derived(
    candidates.find((src) => !missed.includes(src)) ?? null,
  );

  function base64Logo(logo: string | null | undefined): string | null {
    if (!logo || /^(https?:\/\/|data:)/.test(logo)) return null;
    return `data:image/png;base64,${logo}`;
  }

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
        if (imgSrc) missed = [...missed, imgSrc];
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
