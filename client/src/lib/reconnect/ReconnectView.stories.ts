import type { Meta, StoryObj } from "@storybook/svelte";
import ReconnectView from "./ReconnectView.svelte";
import type { ReconnectLinkStatus } from "@openfinance/shared";

const meta: Meta = {
  title: "Reconnect/ReconnectView",
  component: ReconnectView as any,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  argTypes: {
    state: {
      control: "select",
      options: [
        "loading",
        "invalid",
        "expired",
        "error",
        "ready",
        "connecting",
        "syncing",
        "synced",
        "failed",
      ],
    },
  },
};

export default meta;
type Story = StoryObj;

const link: ReconnectLinkStatus = {
  provider: "plaid",
  institutionName: "Chase",
  institutionUrl: "https://www.chase.com",
  accountName: "Total Checking",
  accountMask: "4321",
  expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
  state: "ready",
  message: null,
};

const handlers = {
  onReconnect: () => console.log("Reconnect"),
  onRetry: () => console.log("Retry"),
};

export const Ready: Story = {
  args: { state: "ready", link, ...handlers },
};

export const ReadyQuiltt: Story = {
  args: {
    state: "ready",
    link: {
      ...link,
      provider: "quiltt",
      institutionName: "Capital One",
      institutionUrl: "https://www.capitalone.com",
      accountName: "360 Savings",
      accountMask: "9876",
    },
    ...handlers,
  },
};

export const Connecting: Story = {
  args: { state: "connecting", link, ...handlers },
};

export const Syncing: Story = {
  args: { state: "syncing", link: { ...link, state: "syncing" } },
};

export const SyncingForAWhile: Story = {
  args: { state: "syncing", link: { ...link, state: "syncing" }, slow: true },
};

export const Synced: Story = {
  args: { state: "synced", link: { ...link, state: "synced" } },
};

export const SyncedStillCatchingUp: Story = {
  args: {
    state: "synced",
    link: { ...link, state: "synced" },
    message:
      "Your bank is still sending data. New transactions will show up on their own.",
  },
};

export const Failed: Story = {
  args: {
    state: "failed",
    link: { ...link, state: "failed" },
    message: "Your bank connection needs to be reauthorized. Please reconnect.",
    ...handlers,
  },
};

export const Expired: Story = {
  args: { state: "expired" },
};

export const Invalid: Story = {
  args: { state: "invalid" },
};

export const ErrorState: Story = {
  name: "Error",
  args: { state: "error", ...handlers },
};

export const Loading: Story = {
  args: { state: "loading" },
};
