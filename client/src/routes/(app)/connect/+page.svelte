<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { getApiKey, resetApiKey, type ApiKey } from "$lib/sync/api";
  import { API_BASE } from "$lib/api-client";
  import * as Tabs from "$lib/components/ui/tabs";
  import {
    Download,
    Copy,
    Terminal,
    Eye,
    EyeOff,
    RefreshCw,
    Sparkles,
  } from "lucide-svelte";

  let existingKey = $state<ApiKey | null>(null);
  let fullKey = $state<string | null>(null);
  let keyRevealed = $state(false);
  let resetting = $state(false);
  let keyError = $state<string | null>(null);
  let keyCopied = $state(false);
  let codexCopied = $state(false);
  let clawhubCopied = $state(false);
  let exportCopied = $state(false);
  let configCopied = $state(false);
  let keyLoaded = $state(false);
  let claudeDownloading = $state(false);
  let claudeDownloadError = $state<string | null>(null);
  let skillContent = $state<string | null>(null);
  let skillError = $state<string | null>(null);
  let skillCopied = $state(false);

  const logoDevKey = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY;

  const MCP_PACKAGE_NAME = "@openfinance-sh/mcp";
  const DEFAULT_OPENFINANCE_URL = "https://api.openfinance.sh";

  const maskedKey = $derived(
    fullKey ? fullKey.slice(0, 5) + "..." + fullKey.slice(-6) : "sk-...",
  );

  function buildMcpConfig(key: string) {
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

  const mcpConfigSnippet = $derived(buildMcpConfig(fullKey ?? "sk-..."));
  const displayMcpConfigSnippet = $derived(buildMcpConfig(maskedKey));

  function buildCodexCommand(key: string) {
    return `codex mcp add openfinance --env OPENFINANCE_API_KEY=${key} --env OPENFINANCE_URL=${DEFAULT_OPENFINANCE_URL} -- npx -y ${MCP_PACKAGE_NAME}`;
  }

  const codexCommand = $derived(buildCodexCommand(fullKey ?? "sk-..."));
  const displayCodexCommand = $derived(buildCodexCommand(maskedKey));

  const displaySkillExportCommand = $derived(
    `export OPENFINANCE_API_KEY=${maskedKey}`,
  );

  // Load existing key on mount
  $effect(() => {
    loadKey();
    loadSkill();
  });

  async function loadSkill() {
    try {
      const response = await fetch(`${API_BASE}/api/skill`);
      if (!response.ok) {
        throw new Error(`Load failed with status ${response.status}`);
      }
      skillContent = await response.text();
    } catch {
      skillError = "Failed to load SKILL.md. Please try again.";
    }
  }

  async function handleCopySkill() {
    if (!skillContent) return;
    await navigator.clipboard.writeText(skillContent);
    skillCopied = true;
    setTimeout(() => (skillCopied = false), 2000);
  }

  async function loadKey() {
    try {
      const { key } = await getApiKey();
      existingKey = key;
      if (key?.key) {
        fullKey = key.key;
      }
    } catch {
      // ignore
    } finally {
      keyLoaded = true;
    }
  }

  const displayKey = $derived.by(() => {
    if (fullKey) {
      if (keyRevealed) return fullKey;
      return fullKey.slice(0, 5) + "..." + fullKey.slice(-6);
    }
    if (existingKey) {
      return existingKey.prefix + "...";
    }
    return null;
  });

  async function handleReset() {
    resetting = true;
    keyError = null;
    keyCopied = false;
    try {
      const created = await resetApiKey();
      fullKey = created.key;
      existingKey = {
        id: created.id,
        key: null,
        prefix: created.prefix,
        name: created.name,
        createdAt: created.createdAt,
        lastUsedAt: null,
      };
      keyRevealed = true;
    } catch {
      keyError = "Failed to reset key. Please try again.";
    } finally {
      resetting = false;
    }
  }

  async function handleCopyKey() {
    if (!fullKey) return;
    await navigator.clipboard.writeText(fullKey);
    keyCopied = true;
    setTimeout(() => (keyCopied = false), 2000);
  }

  async function handleCopyCodex() {
    await navigator.clipboard.writeText(codexCommand);
    codexCopied = true;
    setTimeout(() => (codexCopied = false), 2000);
  }

  const clawhubCommand = "npx clawhub@latest install openfinance";

  async function handleCopyClawHub() {
    await navigator.clipboard.writeText(clawhubCommand);
    clawhubCopied = true;
    setTimeout(() => (clawhubCopied = false), 2000);
  }

  async function handleCopyExport() {
    const cmd = `export OPENFINANCE_API_KEY=${fullKey ?? "sk-..."}`;
    await navigator.clipboard.writeText(cmd);
    exportCopied = true;
    setTimeout(() => (exportCopied = false), 2000);
  }

  async function handleCopyConfig() {
    await navigator.clipboard.writeText(mcpConfigSnippet);
    configCopied = true;
    setTimeout(() => (configCopied = false), 2000);
  }

  async function handleDownloadClaude() {
    if (claudeDownloading) return;

    claudeDownloading = true;
    claudeDownloadError = null;

    try {
      const response = await fetch(`${API_BASE}/api/mcp-bundle`);
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "openfinance.mcpb";
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(objectUrl);
    } catch {
      claudeDownloadError = "Download failed. Please try again.";
    } finally {
      claudeDownloading = false;
    }
  }
</script>

<div class="max-w-4xl mx-auto md:px-8 pt-8">
  <section class="p-2">
    <div class="mb-4">
      <h2 class="text-base font-semibold text-[var(--text)]">
        Connect accounts to your AI
      </h2>
      <p class="text-sm text-[var(--text-muted)] mt-1">
        Install the Skill or MCP server, then use your API key to connect.
      </p>
    </div>

    <Tabs.Root value="claude">
      <Tabs.List
        class="flex max-w-full justify-start gap-1 overflow-x-auto [scrollbar-width:none] border-b border-[var(--border)] mb-4"
      >
        <Tabs.Trigger
          value="claude"
          class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--text-muted)] border-b-2 border-transparent data-[state=active]:text-[var(--text)] data-[state=active]:border-[var(--text)] transition-colors cursor-pointer"
        >
          <img
            src="https://img.logo.dev/anthropic.com?token={logoDevKey}&size=64&format=png"
            alt="Claude"
            class="h-4 w-4"
          />
          Claude
        </Tabs.Trigger>
        <Tabs.Trigger
          value="codex"
          class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--text-muted)] border-b-2 border-transparent data-[state=active]:text-[var(--text)] data-[state=active]:border-[var(--text)] transition-colors cursor-pointer"
        >
          <img
            src="https://img.logo.dev/openai.com?token={logoDevKey}&size=64&format=png"
            alt="Codex"
            class="h-4 w-4"
          />
          Codex
        </Tabs.Trigger>
        <Tabs.Trigger
          value="openclaw"
          class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--text-muted)] border-b-2 border-transparent data-[state=active]:text-[var(--text)] data-[state=active]:border-[var(--text)] transition-colors cursor-pointer"
        >
          <img
            src="https://img.logo.dev/openclaw.ai?token={logoDevKey}&size=64&format=png"
            alt="OpenClaw"
            class="h-4 w-4"
          />
          OpenClaw
        </Tabs.Trigger>
        <Tabs.Trigger
          value="skill"
          class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--text-muted)] border-b-2 border-transparent data-[state=active]:text-[var(--text)] data-[state=active]:border-[var(--text)] transition-colors cursor-pointer"
        >
          <Sparkles class="h-4 w-4" />
          Skill
        </Tabs.Trigger>
        <Tabs.Trigger
          value="mcp"
          class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--text-muted)] border-b-2 border-transparent data-[state=active]:text-[var(--text)] data-[state=active]:border-[var(--text)] transition-colors cursor-pointer"
        >
          <Terminal class="h-4 w-4" />
          MCP server
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content
        value="skill"
        class="rounded-lg border border-[var(--border)] p-4"
      >
        <div class="mb-4">
          <h3 class="text-sm font-medium text-[var(--text)]">
            Install as a Skill
          </h3>
          <p class="text-xs text-[var(--text-muted)] mt-1">
            Skills are a markdown file your agent loads. Save
            <code class="text-[var(--text)]">SKILL.md</code> where your agent
            reads skills, and set
            <code class="text-[var(--text)]">OPENFINANCE_API_KEY</code> in its environment.
          </p>
        </div>

        <div class="flex items-center justify-between mb-2">
          <h4 class="text-xs font-medium text-[var(--text)]">
            Step 1. Copy SKILL.md
          </h4>
          <Button
            variant="secondary"
            size="sm"
            disabled={!skillContent}
            onclick={handleCopySkill}
          >
            <Copy class="h-3.5 w-3.5 mr-1" />
            {skillCopied ? "Copied" : "Copy SKILL.md"}
          </Button>
        </div>
        {#if skillError}
          <p class="text-xs text-red-600 mb-2">{skillError}</p>
        {:else if skillContent}
          <pre
            class="text-xs text-[var(--text)] bg-[var(--bg-muted)] rounded p-3 overflow-auto max-h-96 whitespace-pre-wrap break-words"><code
              >{skillContent}</code
            ></pre>
        {:else}
          <p class="text-xs text-[var(--text-muted)]">Loading...</p>
        {/if}

        <div class="mt-5 flex items-center justify-between mb-2">
          <h4 class="text-xs font-medium text-[var(--text)]">
            Step 2. Set this environment variable
          </h4>
          <Button variant="secondary" size="sm" onclick={handleCopyExport}>
            <Copy class="h-3.5 w-3.5 mr-1" />
            {exportCopied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre
          class="text-xs text-[var(--text)] bg-[var(--bg-muted)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all"><code
            >{displaySkillExportCommand}</code
          ></pre>
        {#if !fullKey}
          <p class="text-xs text-[var(--text-muted)] mt-2">
            Replace <code>sk-...</code> with your API key.
          </p>
        {/if}
      </Tabs.Content>

      <Tabs.Content
        value="claude"
        class="rounded-lg border border-[var(--border)] p-4"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-medium text-[var(--text)]">Claude Desktop</h3>
          <button
            type="button"
            onclick={handleDownloadClaude}
            disabled={claudeDownloading}
            class="inline-flex items-center gap-1.5 rounded-md bg-[#E87B35] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#D16A2A] transition-colors"
          >
            {#if claudeDownloading}
              <RefreshCw class="h-3.5 w-3.5 animate-spin" />
              Downloading...
            {:else}
              <Download class="h-3.5 w-3.5" />
              Add to Claude
            {/if}
          </button>
        </div>
        {#if claudeDownloadError}
          <p class="text-xs text-red-600 mb-2">{claudeDownloadError}</p>
        {/if}
        <p class="text-xs text-[var(--text-muted)]">
          Downloads an <code>.mcpb</code> bundle. Double-click to install. You'll
          be prompted for your API key during setup.
        </p>
      </Tabs.Content>

      <Tabs.Content
        value="codex"
        class="rounded-lg border border-[var(--border)] p-4"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-medium text-[var(--text)]">Codex</h3>
          <Button variant="secondary" size="sm" onclick={handleCopyCodex}>
            <Copy class="h-3.5 w-3.5 mr-1" />
            {codexCopied ? "Copied" : "Copy command"}
          </Button>
        </div>
        <pre
          class="text-xs text-[var(--text)] bg-[var(--bg-muted)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all"><code
            >{displayCodexCommand}</code
          ></pre>
        {#if !fullKey}
          <p class="text-xs text-[var(--text-muted)] mt-2">
            Replace <code>sk-...</code> with your API key.
          </p>
        {/if}
      </Tabs.Content>

      <Tabs.Content
        value="openclaw"
        class="rounded-lg border border-[var(--border)] p-4"
      >
        <div class="mb-2">
          <h3 class="text-sm font-medium text-[var(--text)]">OpenClaw</h3>
        </div>
        <p class="text-xs text-[var(--text-muted)] mb-2">
          Install the openfinance skill:
        </p>
        <pre
          class="text-xs text-[var(--text)] bg-[var(--bg-muted)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all"><code
            >{clawhubCommand}</code
          ></pre>
        <div class="flex justify-end mt-1">
          <Button variant="secondary" size="sm" onclick={handleCopyClawHub}>
            <Copy class="h-3.5 w-3.5 mr-1" />
            {clawhubCopied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p class="text-xs text-[var(--text-muted)] mt-3">
          Then add your API key to your shell profile (<code>~/.zshrc</code>,
          <code>~/.bashrc</code>, or equivalent):
        </p>
        <pre
          class="text-xs text-[var(--text)] bg-[var(--bg-muted)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all mt-2"><code
            >export OPENFINANCE_API_KEY={fullKey ? fullKey : "sk-..."}</code
          ></pre>
        <div class="flex justify-end mt-1">
          <Button variant="secondary" size="sm" onclick={handleCopyExport}>
            <Copy class="h-3.5 w-3.5 mr-1" />
            {exportCopied ? "Copied" : "Copy"}
          </Button>
        </div>
        {#if !fullKey}
          <p class="text-xs text-[var(--text-muted)] mt-2">
            Replace <code>sk-...</code> with your API key.
          </p>
        {/if}
      </Tabs.Content>

      <Tabs.Content
        value="mcp"
        class="rounded-lg border border-[var(--border)] p-4"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-medium text-[var(--text)]">
            MCP server config
          </h3>
          <Button variant="secondary" size="sm" onclick={handleCopyConfig}>
            <Copy class="h-3.5 w-3.5 mr-1" />
            {configCopied ? "Copied" : "Copy config"}
          </Button>
        </div>
        <p class="text-xs text-[var(--text-muted)] mb-2">
          Use this MCP server configuration in your MCP client. Uses
          <code>{MCP_PACKAGE_NAME}</code>.
        </p>
        <pre
          class="text-xs text-[var(--text)] bg-[var(--bg-muted)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all"><code
            >{displayMcpConfigSnippet}</code
          ></pre>
      </Tabs.Content>
    </Tabs.Root>

    <!-- API Key Section -->
    <div class="mt-6">
      <h3 class="text-sm font-semibold text-[var(--text)]">API Key</h3>
      <p class="text-xs text-[var(--text-muted)] mt-1">
        Your API key for OpenFinance. Use this key to connect your AI tools.
      </p>

      {#if keyError}
        <p class="mt-3 text-sm text-red-600">{keyError}</p>
      {/if}

      {#if displayKey}
        <div class="mt-3 flex items-center gap-2">
          <div
            class="flex flex-1 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2"
          >
            <code class="flex-1 text-sm text-[var(--text)] break-all"
              >{displayKey}</code
            >
            {#if fullKey}
              <button
                type="button"
                class="text-[var(--text-muted)] hover:text-[var(--text-muted)] transition-colors"
                onclick={() => (keyRevealed = !keyRevealed)}
              >
                {#if keyRevealed}
                  <EyeOff class="h-4 w-4" />
                {:else}
                  <Eye class="h-4 w-4" />
                {/if}
              </button>
            {/if}
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!fullKey}
            onclick={handleCopyKey}
          >
            <Copy class="h-3.5 w-3.5 mr-1" />
            {keyCopied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={resetting}
            onclick={handleReset}
          >
            <RefreshCw
              class="h-3.5 w-3.5 mr-1 {resetting ? 'animate-spin' : ''}"
            />
            Reset
          </Button>
        </div>
      {:else if keyLoaded}
        <div class="mt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={resetting}
            onclick={handleReset}
          >
            <RefreshCw
              class="h-3.5 w-3.5 mr-1 {resetting ? 'animate-spin' : ''}"
            />
            Generate Key
          </Button>
        </div>
      {:else}
        <div class="mt-3">
          <p class="text-xs text-[var(--text-muted)]">Loading...</p>
        </div>
      {/if}
    </div>
  </section>
</div>
