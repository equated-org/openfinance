import type { Meta, StoryObj } from "@storybook/svelte";
import ConnectGuide from "./ConnectGuide.svelte";

const meta: Meta = {
  title: "Connect/ConnectGuide",
  component: ConnectGuide as any,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  argTypes: {
    tab: {
      control: "select",
      options: [
        "claude",
        "chatgpt",
        "codex",
        "cursor",
        "openclaw",
        "grok",
        "muse",
        "skill",
        "legacy",
      ],
    },
  },
};

export default meta;
type Story = StoryObj;

const args = {
  serverUrl: "https://api.openfinance.sh",
  apiKey: "sk-q6Fh2LxW8eTnR4bYc7Vd0Jm9Pa3KsZ1uQo5XD9MM",
  onDownloadBundle: () => console.log("Download .mcpb"),
};

export const Claude: Story = { args: { ...args, tab: "claude" } };
export const ChatGPT: Story = { args: { ...args, tab: "chatgpt" } };
export const Codex: Story = { args: { ...args, tab: "codex" } };
export const Cursor: Story = { args: { ...args, tab: "cursor" } };
export const OpenClaw: Story = { args: { ...args, tab: "openclaw" } };
export const Grok: Story = { args: { ...args, tab: "grok" } };
export const Muse: Story = { args: { ...args, tab: "muse" } };
export const Skill: Story = { args: { ...args, tab: "skill" } };
export const Legacy: Story = { args: { ...args, tab: "legacy" } };

// Before the key loads, commands show a placeholder to replace.
export const WithoutApiKey: Story = {
  args: { ...args, apiKey: null, tab: "grok" },
};

export const DownloadingBundle: Story = {
  args: { ...args, tab: "legacy", downloadingBundle: true },
};
