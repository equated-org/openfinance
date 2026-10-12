<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Tabs from "$lib/components/ui/tabs";
  import {
    Check,
    Copy,
    MessageCircle,
    Sparkles,
    Terminal,
  } from "lucide-svelte";

  interface Props {
    /** The API's public URL. The MCP server is at /mcp on it. */
    serverUrl: string;
    /** The full API key, if the app has it. Commands show it masked and copy it in full. */
    apiKey?: string | null;
    downloadingBundle?: boolean;
    downloadError?: string | null;
    onDownloadBundle?: () => void;
    /** Which app's steps are showing. */
    tab?: string;
  }

  let {
    serverUrl,
    apiKey = null,
    downloadingBundle = false,
    downloadError = null,
    onDownloadBundle,
    tab = $bindable("claude"),
  }: Props = $props();

  // One numbered step: a title, and at most a line of detail plus a code
  // block or a button. `copy` is what the copy button copies, when it differs
  // from what's shown (the full key instead of the masked one).
  type Step = {
    title: string;
    detail?: string;
    code?: { display: string; copy?: string };
    action?: {
      label: string;
      onclick?: () => void;
      disabled?: boolean;
      error?: string | null;
    };
  };

  type Guide = {
    value: string;
    label: string;
    /** The app's domain, for its logo, or an icon for generic entries. */
    logo: string | typeof Terminal;
    sections: { title?: string; steps: Step[] }[];
  };

  const logoDevKey = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY;

  const MCP_PACKAGE_NAME = "@openfinance-sh/mcp";
  const DEFAULT_OPENFINANCE_URL = "https://api.openfinance.sh";

  let copiedId = $state<string | null>(null);

  const mcpUrl = $derived(`${serverUrl}/mcp`);
  const agentPrompt = $derived(
    `Read ${serverUrl}/setup.md and follow it to connect OpenFinance.`,
  );
  // Agents fetch the skill themselves instead of the user pasting it in.
  const skillPrompt = $derived(
    `Read ${serverUrl}/skill.md and save it as a skill.`,
  );

  const maskedKey = $derived(
    apiKey ? apiKey.slice(0, 5) + "..." + apiKey.slice(-6) : "sk-...",
  );
  const keyForCopy = $derived(apiKey ?? "sk-...");

  function exportCommand(key: string) {
    return `export OPENFINANCE_API_KEY=${key}`;
  }

  // OpenClaw's gateway runs as a background service and doesn't see shell
  // variables, so the key goes in the server's headers.
  function openClawKeyCommand(key: string) {
    return `openclaw mcp set openfinance '${JSON.stringify({
      url: mcpUrl,
      transport: "streamable-http",
      headers: { Authorization: `Bearer ${key}` },
    })}'`;
  }

  function grokTool(key: string) {
    return JSON.stringify(
      {
        type: "mcp",
        server_url: mcpUrl,
        server_label: "openfinance",
        authorization: `Bearer ${key}`,
      },
      null,
      2,
    );
  }

  // The local server from npm, kept for setups that already use it.
  function legacyMcpConfig(key: string) {
    return JSON.stringify(
      {
        mcpServers: {
          openfinance: {
            command: "npx",
            args: ["-y", MCP_PACKAGE_NAME],
            env: {
              OPENFINANCE_API_KEY: key,
              OPENFINANCE_URL: DEFAULT_OPENFINANCE_URL,
            },
          },
        },
      },
      null,
      2,
    );
  }

  const guides: Guide[] = $derived([
    {
      value: "claude",
      label: "Claude",
      logo: "anthropic.com",
      sections: [
        {
          title: "Claude app",
          steps: [
            {
              title: "Add a custom connector",
              detail: "Customize → Connectors → + → Add custom connector",
            },
            { title: "Paste the URL", code: { display: mcpUrl } },
            { title: "Connect and sign in to OpenFinance" },
          ],
        },
        {
          title: "Claude Code",
          steps: [
            {
              title: "Add the server",
              code: {
                display: `claude mcp add --scope user --transport http openfinance ${mcpUrl}`,
              },
            },
            {
              title: "Sign in",
              detail: "Run /mcp, pick openfinance, then Authenticate",
            },
          ],
        },
      ],
    },
    {
      value: "chatgpt",
      label: "ChatGPT",
      logo: "chatgpt.com",
      sections: [
        {
          steps: [
            {
              title: "Add an MCP server",
              detail: "Plugins → Add → Add MCP server",
            },
            { title: "Paste the URL", code: { display: mcpUrl } },
            { title: "Sign in to OpenFinance when asked" },
          ],
        },
      ],
    },
    {
      value: "codex",
      label: "Codex",
      logo: "openai.com",
      sections: [
        {
          steps: [
            {
              title: "Add the server",
              code: { display: `codex mcp add openfinance --url ${mcpUrl}` },
            },
            {
              title: "Sign in",
              detail:
                "Codex opens your browser. If it doesn't, run codex mcp login openfinance",
            },
          ],
        },
      ],
    },
    {
      value: "cursor",
      label: "Cursor",
      logo: "cursor.com",
      sections: [
        {
          steps: [
            {
              title: "Add the server to ~/.cursor/mcp.json",
              code: {
                display: JSON.stringify(
                  { mcpServers: { openfinance: { url: mcpUrl } } },
                  null,
                  2,
                ),
              },
            },
            { title: "Sign in from Cursor's MCP settings" },
          ],
        },
      ],
    },
    {
      value: "openclaw",
      label: "OpenClaw",
      logo: "openclaw.ai",
      sections: [
        {
          steps: [
            {
              title: "Add the server",
              code: {
                display: `openclaw mcp set openfinance '${JSON.stringify({
                  url: mcpUrl,
                  transport: "streamable-http",
                  auth: "oauth",
                })}'`,
              },
            },
            {
              title: "Sign in",
              code: { display: "openclaw mcp login openfinance" },
            },
          ],
        },
        {
          title: "Or use your API key",
          steps: [
            {
              title: "Add the server with your key",
              code: {
                display: openClawKeyCommand(maskedKey),
                copy: openClawKeyCommand(keyForCopy),
              },
            },
          ],
        },
      ],
    },
    {
      value: "grok",
      label: "Grok",
      logo: "x.ai",
      sections: [
        {
          steps: [
            {
              title: "Add OpenFinance to your xAI API request's tools",
              code: { display: grokTool(maskedKey), copy: grokTool(keyForCopy) },
            },
            {
              title: "Keep the key on your server",
              detail: "Never put it in code that runs in a browser",
            },
          ],
        },
      ],
    },
    {
      value: "muse",
      label: "Muse",
      logo: MessageCircle,
      sections: [
        {
          steps: [
            { title: "Ask Muse to connect to OpenFinance" },
            { title: "Tap Connect on the OpenFinance connector" },
            {
              title: "Paste your API key",
              code: { display: maskedKey, copy: keyForCopy },
            },
          ],
        },
      ],
    },
    {
      value: "skill",
      label: "Skill",
      logo: Sparkles,
      sections: [
        {
          steps: [
            { title: "Paste this into your agent", code: { display: skillPrompt } },
            {
              title: "Set your API key where the agent runs",
              code: {
                display: exportCommand(maskedKey),
                copy: exportCommand(keyForCopy),
              },
            },
          ],
        },
      ],
    },
    {
      value: "legacy",
      label: "Legacy",
      logo: Terminal,
      sections: [
        {
          title: "Claude Desktop",
          steps: [
            {
              title: "Download the bundle",
              action: {
                label: downloadingBundle ? "Downloading…" : "Download .mcpb",
                onclick: onDownloadBundle,
                disabled: downloadingBundle,
                error: downloadError,
              },
            },
            { title: "Open it and enter your API key" },
          ],
        },
        {
          title: "Other MCP clients",
          steps: [
            {
              title: "Add the local server to your MCP config",
              code: {
                display: legacyMcpConfig(maskedKey),
                copy: legacyMcpConfig(keyForCopy),
              },
            },
          ],
        },
      ],
    },
  ]);

  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    copiedId = id;
    setTimeout(() => {
      if (copiedId === id) copiedId = null;
    }, 2000);
  }
</script>

{#snippet codeBlock(id: string, display: string, text: string)}
  <div
    class="mt-2 flex items-start gap-2 rounded-md bg-[var(--bg-muted)] py-2 pl-3 pr-1.5"
  >
    <pre
      class="min-w-0 flex-1 whitespace-pre-wrap break-all py-0.5 text-xs text-[var(--text)]"><code
        >{display}</code
      ></pre>
    <button
      type="button"
      aria-label="Copy"
      class="shrink-0 rounded p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      onclick={() => copy(id, text)}
    >
      {#if copiedId === id}
        <Check class="h-3.5 w-3.5" />
      {:else}
        <Copy class="h-3.5 w-3.5" />
      {/if}
    </button>
  </div>
{/snippet}

{#snippet stepList(id: string, steps: Step[])}
  <ol>
    {#each steps as step, i}
      <li class="relative flex gap-3 pb-6 last:pb-0">
        {#if i < steps.length - 1}
          <span
            aria-hidden="true"
            class="absolute bottom-1 left-3 top-8 w-px bg-[var(--border)]"
          ></span>
        {/if}
        <span
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-xs font-medium text-[var(--text-muted)]"
          >{i + 1}</span
        >
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium leading-6 text-[var(--text)]">
            {step.title}
          </p>
          {#if step.detail}
            <p class="text-xs text-[var(--text-muted)]">{step.detail}</p>
          {/if}
          {#if step.code}
            {@render codeBlock(
              `${id}-${i}`,
              step.code.display,
              step.code.copy ?? step.code.display,
            )}
          {/if}
          {#if step.action}
            <Button
              variant="secondary"
              size="sm"
              class="mt-2"
              disabled={step.action.disabled}
              onclick={step.action.onclick}
            >
              {step.action.label}
            </Button>
            {#if step.action.error}
              <p class="mt-1 text-xs text-red-600">{step.action.error}</p>
            {/if}
          {/if}
        </div>
      </li>
    {/each}
  </ol>
{/snippet}

<div class="mb-6">
  <h2 class="text-base font-semibold text-[var(--text)]">
    Connect accounts to your AI
  </h2>
  <p class="mt-1 text-sm text-[var(--text-muted)]">
    Add this URL to any app that supports MCP, then sign in.
  </p>
  {@render codeBlock("url", mcpUrl, mcpUrl)}
  <p class="mt-4 text-xs text-[var(--text-muted)]">
    Or have your agent set itself up:
  </p>
  {@render codeBlock("prompt", agentPrompt, agentPrompt)}
</div>

<Tabs.Root bind:value={tab}>
  <Tabs.List
    class="flex max-w-full justify-start gap-1 overflow-x-auto [scrollbar-width:none] border-b border-[var(--border)] mb-5"
  >
    {#each guides as guide}
      <Tabs.Trigger
        value={guide.value}
        class="flex shrink-0 items-center gap-2 px-2.5 py-2 text-sm font-medium text-[var(--text-muted)] border-b-2 border-transparent data-[state=active]:text-[var(--text)] data-[state=active]:border-[var(--text)] transition-colors cursor-pointer"
      >
        {#if typeof guide.logo === "string"}
          <img
            src="https://img.logo.dev/{guide.logo}?token={logoDevKey}&size=64&format=png"
            alt={guide.label}
            class="h-4 w-4"
          />
        {:else}
          {@const Icon = guide.logo}
          <Icon class="h-4 w-4" />
        {/if}
        {guide.label}
      </Tabs.Trigger>
    {/each}
  </Tabs.List>

  {#each guides as guide}
    <Tabs.Content value={guide.value} class="pl-1">
      {#each guide.sections as section, s}
        <div class={s > 0 ? "mt-8" : ""}>
          {#if section.title}
            <h3 class="mb-3 text-xs font-medium text-[var(--text-muted)]">
              {section.title}
            </h3>
          {/if}
          {@render stepList(`${guide.value}-${s}`, section.steps)}
        </div>
      {/each}
    </Tabs.Content>
  {/each}
</Tabs.Root>
