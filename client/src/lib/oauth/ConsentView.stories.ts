import type { Meta, StoryObj } from "@storybook/svelte";
import ConsentView from "./ConsentView.svelte";

const meta: Meta = {
  title: "OAuth/ConsentView",
  component: ConsentView as any,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  argTypes: {
    state: {
      control: "select",
      options: ["loading", "invalid", "signedOut", "ready"],
    },
    submitting: { control: "select", options: [null, "allow", "deny"] },
  },
};

export default meta;
type Story = StoryObj;

const ready = {
  state: "ready",
  email: "alex@example.com",
  onDecide: (accept: boolean) => console.log(accept ? "Allow" : "Decline"),
};

// Claude Code and Codex redirect to localhost, so the logo comes from the name.
export const ClaudeCode: Story = {
  args: {
    ...ready,
    client: { name: "Claude Code", redirectHosts: ["localhost:53682"] },
  },
};

export const ChatGPT: Story = {
  args: {
    ...ready,
    client: { name: "ChatGPT", redirectHosts: ["chatgpt.com"] },
  },
};

// A client that registered without a name and an unfamiliar host.
export const UnknownApp: Story = {
  args: {
    ...ready,
    client: { name: null, redirectHosts: ["agent.example.dev"] },
  },
};

export const Allowing: Story = {
  args: {
    ...ready,
    client: { name: "Claude", redirectHosts: ["claude.ai"] },
    submitting: "allow",
  },
};

export const ErrorState: Story = {
  name: "Error",
  args: {
    ...ready,
    client: { name: "Claude", redirectHosts: ["claude.ai"] },
    error:
      "This request has expired. Start again from the app you're connecting.",
  },
};

export const SignedOut: Story = {
  args: { state: "signedOut" },
};

export const Invalid: Story = {
  args: { state: "invalid" },
};

export const Loading: Story = {
  args: { state: "loading" },
};
