import type { Meta, StoryObj } from "@storybook/svelte";
import AccountRow from "./AccountRow.svelte";
import type { ConnectedAccount } from "@openfinance/shared";

const meta: Meta = {
  title: "Accounts/AccountRow",
  component: AccountRow as any,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj;

const baseAccount: ConnectedAccount = {
  id: 1,
  name: "Checking Account",
  officialName: "Premier Checking",
  type: "depository",
  subtype: "checking",
  mask: "4321",
  currentBalance: "5432.10",
  availableBalance: "5432.10",
  isoCurrencyCode: "USD",
  institutionName: "Chase",
  institutionUrl: "https://www.chase.com",
  institutionLogoUrl: null,
  syncError: null,
  isSyncing: false,
  connectionId: 1,
  provider: "plaid",
  quilttConnectionId: null,
  status: "active",
};

export const Default: Story = {
  args: {
    account: baseAccount,
    groupKey: "depository",
  },
};

export const Disconnected: Story = {
  args: {
    account: {
      ...baseAccount,
      syncError: {
        message: "LOGIN_REQUIRED",
        lastFailedAt: "2026-02-20T00:00:00Z",
      },
    },
    groupKey: "depository",
    onReauth: (account: ConnectedAccount) =>
      console.log("Reauth requested for", account.name),
  },
};

export const Syncing: Story = {
  args: {
    account: {
      ...baseAccount,
      isSyncing: true,
    },
    groupKey: "depository",
  },
};

export const DisconnectedLoading: Story = {
  args: {
    account: {
      ...baseAccount,
      syncError: {
        message: "LOGIN_REQUIRED",
        lastFailedAt: "2026-02-20T00:00:00Z",
      },
    },
    groupKey: "depository",
    isConnectorLoading: true,
    onReauth: (account: ConnectedAccount) =>
      console.log("Reauth requested for", account.name),
  },
};
