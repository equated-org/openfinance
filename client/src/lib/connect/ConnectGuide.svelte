<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Tabs from "$lib/components/ui/tabs";
  import {
    Download,
    Copy,
    Terminal,
    RefreshCw,
    Sparkles,
    MessageCircle,
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

  const logoDevKey = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY;

  const MCP_PACKAGE_NAME = "@openfinance-sh/mcp";
  const DEFAULT_OPENFINANCE_URL = "https://api.openfinance.sh";
  // The docs site publishes the skill, so agents fetch it instead of the user
  // pasting it in.
  const SKILL_PAGE_URL = "https://openfinance.sh/docs/skill";
  const skillPrompt =
    "Read https://openfinance.sh/docs/skill.md and save it as a skill.";

  let copiedId = $state<string | null>(null);

  const mcpUrl = $derived(`${serverUrl}/mcp`);
  const agentPrompt = $derived(
    `Read ${serverUrl}/setup.md and follow it to connect OpenFinance.`,
  );

  const maskedKey = $derived(
    apiKey ? apiKey.slice(0, 5) + "..." + apiKey.slice(-6) : "sk-...",
  );
  const keyForCopy = $derived(apiKey ?? "sk-...");

  const claudeCodeCommand = $derived(
    `claude mcp add --scope user --transport http openfinance ${mcpUrl}`,
  );
  const codexCommand = $derived(`codex mcp add openfinance --url ${mcpUrl}`);
  const cursorConfig = $derived(
    JSON.stringify({ mcpServers: { openfinance: { url: mcpUrl } } }, null, 2),
  );
  // OpenClaw fills in ${OPENFINANCE_API_KEY} from the gateway's environment.
  const openClawCommand = $derived(
    `openclaw mcp set openfinance '${JSON.stringify({
      url: mcpUrl,
      transport: "streamable-http",
      headers: { Authorization: "Bearer ${OPENFINANCE_API_KEY}" },
    })}'`,
  );
  const clawhubCommand = "npx clawhub@latest install openfinance";

  function exportCommand(key: string) {
    return `export OPENFINANCE_API_KEY=${key}`;
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

  function legacyCodexCommand(key: string) {
    return `codex mcp add openfinance --env OPENFINANCE_API_KEY=${key} --env OPENFINANCE_URL=${DEFAULT_OPENFINANCE_URL} -- npx -y ${MCP_PACKAGE_NAME}`;
  }

  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    copiedId = id;
    setTimeout(() => {
      if (copiedId === id) copiedId = null;
    }, 2000);
  }
</script>

{#snippet copyBlock(id: string, label: string, display: string, text: string)}
  <div class="mt-4 flex items-center justify-between gap-2 mb-2">
    <h4 class="text-xs font-medium text-[var(--text)]">{label}</h4>
    <Button variant="secondary" size="sm" onclick={() => copy(id, text)}>
      <Copy class="h-3.5 w-3.5 mr-1" />
      {copiedId === id ? "Copied" : "Copy"}
    </Button>
  </div>
  <pre
    class="text-xs text-[var(--text)] bg-[var(--bg-muted)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all"><code
      >{display}</code
    ></pre>
{/snippet}

{#snippet steps(items: string[])}
  <ol
    class="mt-2 list-decimal space-y-1 pl-4 text-xs text-[var(--text-muted)]"
  >
    {#each items as item}
      <li>{item}</li>
    {/each}
  </ol>
{/snippet}

{#snippet keyNote()}
  {#if !apiKey}
    <p class="text-xs text-[var(--text-muted)] mt-2">
      Replace <code>sk-...</code> with your API key.
    </p>
  {/if}
{/snippet}

<!-- logo is the app's domain, for its logo, or an icon for generic entries. -->
{#snippet tabTrigger(value: string, label: string, logo: string | typeof Terminal)}
  <Tabs.Trigger
    {value}
    class="flex shrink-0 items-center gap-2 px-2.5 py-2 text-sm font-medium text-[var(--text-muted)] border-b-2 border-transparent data-[state=active]:text-[var(--text)] data-[state=active]:border-[var(--text)] transition-colors cursor-pointer"
  >
    {#if typeof logo === "string"}
      <img
        src="https://img.logo.dev/{logo}?token={logoDevKey}&size=64&format=png"
        alt={label}
        class="h-4 w-4"
      />
    {:else}
      {@const Icon = logo}
      <Icon class="h-4 w-4" />
    {/if}
    {label}
  </Tabs.Trigger>
{/snippet}

<div class="mb-4">
  <h2 class="text-base font-semibold text-[var(--text)]">
    Connect accounts to your AI
  </h2>
  <p class="text-sm text-[var(--text-muted)] mt-1">
    Add OpenFinance to any app that supports MCP with this URL. You'll sign in
    to OpenFinance the first time. Apps that can't sign in use your API key
    instead.
  </p>
</div>

<div class="rounded-lg border border-[var(--border)] p-4 mb-6">
  <div class="flex items-center gap-2">
    <code
      class="flex-1 min-w-0 break-all rounded-md bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text)]"
      >{mcpUrl}</code
    >
    <Button variant="secondary" size="sm" onclick={() => copy("url", mcpUrl)}>
      <Copy class="h-3.5 w-3.5 mr-1" />
      {copiedId === "url" ? "Copied" : "Copy URL"}
    </Button>
  </div>
  {@render copyBlock(
    "prompt",
    "Or let your agent set it up: paste this into Claude Code, Codex, Cursor, or OpenClaw",
    agentPrompt,
    agentPrompt,
  )}
</div>

<Tabs.Root bind:value={tab}>
  <Tabs.List
    class="flex max-w-full justify-start gap-1 overflow-x-auto [scrollbar-width:none] border-b border-[var(--border)] mb-4"
  >
    {@render tabTrigger("claude", "Claude", "anthropic.com")}
    {@render tabTrigger("chatgpt", "ChatGPT", "chatgpt.com")}
    {@render tabTrigger("codex", "Codex", "openai.com")}
    {@render tabTrigger("cursor", "Cursor", "cursor.com")}
    {@render tabTrigger("openclaw", "OpenClaw", "openclaw.ai")}
    {@render tabTrigger("grok", "Grok", "x.ai")}
    {@render tabTrigger("muse", "Muse", MessageCircle)}
    {@render tabTrigger("skill", "Skill", Sparkles)}
    {@render tabTrigger("legacy", "Legacy", Terminal)}
  </Tabs.List>

  <Tabs.Content
    value="claude"
    class="rounded-lg border border-[var(--border)] p-4"
  >
    <h3 class="text-sm font-medium text-[var(--text)]">
      Claude on the web, desktop, and mobile
    </h3>
    {@render steps([
      "In Claude, open Customize → Connectors (Settings → Connectors in the desktop app), then choose + → Add custom connector.",
      "Paste the URL above and select Add.",
      "Select Connect and sign in to OpenFinance. Leave the advanced OAuth settings empty.",
    ])}
    <p class="mt-2 text-xs text-[var(--text-muted)]">
      On Team and Enterprise plans, an owner adds the connector first under
      Organization settings → Connectors.
    </p>

    <h3 class="mt-6 text-sm font-medium text-[var(--text)]">Claude Code</h3>
    {@render copyBlock(
      "claude-code",
      "Run this in a terminal",
      claudeCodeCommand,
      claudeCodeCommand,
    )}
    <p class="mt-2 text-xs text-[var(--text-muted)]">
      Then run <code>/mcp</code> in Claude Code, select openfinance, and choose Authenticate.
    </p>
  </Tabs.Content>

  <Tabs.Content
    value="chatgpt"
    class="rounded-lg border border-[var(--border)] p-4"
  >
    <h3 class="text-sm font-medium text-[var(--text)]">ChatGPT</h3>
    {@render steps([
      "In ChatGPT, open Plugins, then choose Add → Add MCP server.",
      "Paste the URL above and name it OpenFinance.",
      "Sign in to OpenFinance when ChatGPT asks.",
    ])}
  </Tabs.Content>

  <Tabs.Content
    value="codex"
    class="rounded-lg border border-[var(--border)] p-4"
  >
    <h3 class="text-sm font-medium text-[var(--text)]">Codex</h3>
    {@render copyBlock(
      "codex",
      "Run this in a terminal",
      codexCommand,
      codexCommand,
    )}
    <p class="mt-2 text-xs text-[var(--text-muted)]">
      Codex opens your browser to sign in to OpenFinance. If it doesn't, run
      <code>codex mcp login openfinance</code>. To use your API key instead, add
      <code>--bearer-token-env-var OPENFINANCE_API_KEY</code>.
    </p>
  </Tabs.Content>

  <Tabs.Content
    value="cursor"
    class="rounded-lg border border-[var(--border)] p-4"
  >
    <h3 class="text-sm font-medium text-[var(--text)]">Cursor</h3>
    {@render copyBlock(
      "cursor",
      "Add this to ~/.cursor/mcp.json, keeping any other servers",
      cursorConfig,
      cursorConfig,
    )}
    <p class="mt-2 text-xs text-[var(--text-muted)]">
      Then sign in to OpenFinance from Cursor's MCP settings.
    </p>
  </Tabs.Content>

  <Tabs.Content
    value="openclaw"
    class="rounded-lg border border-[var(--border)] p-4"
  >
    <h3 class="text-sm font-medium text-[var(--text)]">OpenClaw</h3>
    {@render copyBlock(
      "openclaw",
      "Add the server",
      openClawCommand,
      openClawCommand,
    )}
    {@render copyBlock(
      "openclaw-key",
      "Then set your API key where the gateway runs",
      exportCommand(maskedKey),
      exportCommand(keyForCopy),
    )}
    {@render keyNote()}
    {@render copyBlock(
      "clawhub",
      "Or install the skill instead",
      clawhubCommand,
      clawhubCommand,
    )}
  </Tabs.Content>

  <Tabs.Content
    value="grok"
    class="rounded-lg border border-[var(--border)] p-4"
  >
    <h3 class="text-sm font-medium text-[var(--text)]">Grok bots (xAI API)</h3>
    <p class="mt-1 text-xs text-[var(--text-muted)]">
      Add OpenFinance as a remote MCP tool in your xAI API requests. Keep the key
      on your server, never in code that runs in a browser.
    </p>
    {@render copyBlock(
      "grok",
      "Tool definition",
      grokTool(maskedKey),
      grokTool(keyForCopy),
    )}
    {@render keyNote()}
  </Tabs.Content>

  <Tabs.Content value="muse" class="rounded-lg border border-[var(--border)] p-4">
    <h3 class="text-sm font-medium text-[var(--text)]">Muse</h3>
    <p class="mt-1 text-xs text-[var(--text-muted)]">
      Muse doesn't support MCP yet, so it connects with your API key.
    </p>
    {@render steps([
      "In Muse, say “Connect to OpenFinance”.",
      "Tap Connect on the OpenFinance connector.",
      "Paste your API key.",
    ])}
    <div class="mt-4">
      <Button
        variant="secondary"
        size="sm"
        disabled={!apiKey}
        onclick={() => apiKey && copy("muse-key", apiKey)}
      >
        <Copy class="h-3.5 w-3.5 mr-1" />
        {copiedId === "muse-key" ? "Copied" : "Copy API key"}
      </Button>
    </div>
  </Tabs.Content>

  <Tabs.Content
    value="skill"
    class="rounded-lg border border-[var(--border)] p-4"
  >
    <h3 class="text-sm font-medium text-[var(--text)]">Install as a Skill</h3>
    <p class="mt-1 text-xs text-[var(--text-muted)]">
      For agents that load skills instead of MCP. The skill is in the
      <a
        href={SKILL_PAGE_URL}
        target="_blank"
        rel="noreferrer"
        class="underline underline-offset-2 hover:text-[var(--text)]">docs</a
      >, so your agent can fetch it.
    </p>
    {@render copyBlock(
      "skill-prompt",
      "Paste this into your agent",
      skillPrompt,
      skillPrompt,
    )}
    {@render copyBlock(
      "skill-key",
      "Then set your API key where the agent runs",
      exportCommand(maskedKey),
      exportCommand(keyForCopy),
    )}
    {@render keyNote()}
  </Tabs.Content>

  <Tabs.Content
    value="legacy"
    class="rounded-lg border border-[var(--border)] p-4"
  >
    <h3 class="text-sm font-medium text-[var(--text)]">Local MCP server</h3>
    <p class="mt-1 text-xs text-[var(--text-muted)]">
      The original server runs on your computer with Node, using
      <code>{MCP_PACKAGE_NAME}</code>. Existing setups keep working, but the URL
      above needs nothing installed and gets new tools automatically.
    </p>

    <div class="mt-4 flex items-center justify-between gap-2">
      <h4 class="text-xs font-medium text-[var(--text)]">Claude Desktop</h4>
      <button
        type="button"
        onclick={onDownloadBundle}
        disabled={downloadingBundle}
        class="inline-flex items-center gap-1.5 rounded-md bg-[#E87B35] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#D16A2A] transition-colors"
      >
        {#if downloadingBundle}
          <RefreshCw class="h-3.5 w-3.5 animate-spin" />
          Downloading...
        {:else}
          <Download class="h-3.5 w-3.5" />
          Download .mcpb
        {/if}
      </button>
    </div>
    {#if downloadError}
      <p class="text-xs text-red-600 mt-2">{downloadError}</p>
    {/if}
    <p class="mt-2 text-xs text-[var(--text-muted)]">
      Double-click the bundle to install it. You'll be asked for your API key.
    </p>

    {@render copyBlock(
      "legacy-codex",
      "Codex",
      legacyCodexCommand(maskedKey),
      legacyCodexCommand(keyForCopy),
    )}
    {@render copyBlock(
      "legacy-config",
      "Other MCP clients",
      legacyMcpConfig(maskedKey),
      legacyMcpConfig(keyForCopy),
    )}
    {@render keyNote()}
  </Tabs.Content>
</Tabs.Root>
