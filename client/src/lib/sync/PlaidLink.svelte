<script lang="ts">
  import {
    createPlaidLinkToken,
    createPlaidLinkTokenForUpdate,
    exchangePlaidPublicToken,
    reportPlaidLinkExit,
  } from "./api";
  import {
    loadPlaidSdk,
    type PlaidError,
    type PlaidExitMetadata,
    type PlaidHandler,
  } from "./sdk";
  import { toast } from "svelte-sonner";

  interface Props {
    onAccountLinked?: () => void;
    onSyncStarted?: () => void;
    onExit?: () => void;
  }

  let {
    onAccountLinked = () => {},
    onSyncStarted = () => {},
    onExit = () => {},
  }: Props = $props();

  let handler: PlaidHandler | null = null;

  function handleExit(err: PlaidError | null, metadata: PlaidExitMetadata) {
    handler = null;
    // Only the browser learns how a session ended, so pass it on.
    reportPlaidLinkExit(err, metadata).catch(() => {});
    if (err) {
      const bank = metadata.institution?.name ?? "your bank";
      toast.error(`Couldn't connect ${bank}`, {
        description:
          err.display_message ?? "Please try again in a few minutes.",
      });
    }
    onExit();
  }

  async function openLink(
    getLinkToken: () => Promise<{ link_token: string }>,
    institutionId?: string,
  ) {
    try {
      await loadPlaidSdk();
      const { link_token } = await getLinkToken();

      handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (publicToken, metadata) => {
          try {
            await exchangePlaidPublicToken(
              publicToken,
              metadata.institution?.institution_id ?? institutionId,
            );
            onAccountLinked();
            onSyncStarted();
          } catch (err) {
            console.error("Failed to exchange token:", err);
            toast.error("Failed to connect account");
          }
        },
        onExit: handleExit,
        onEvent: () => {},
      });

      handler.open();
    } catch (err) {
      console.error("Failed to open Plaid Link:", err);
      toast.error("Couldn't open Plaid", {
        description:
          "Please try again. If this keeps happening, remove the account and add it again.",
      });
    }
  }

  export function initiatePlaidLink(institutionId?: string) {
    return openLink(createPlaidLinkToken, institutionId);
  }

  export function initiateReauthentication(accountId: number) {
    return openLink(() => createPlaidLinkTokenForUpdate(accountId));
  }
</script>
