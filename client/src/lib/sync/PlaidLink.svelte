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

  export async function initiatePlaidLink(institutionId?: string) {
    await loadPlaidSdk();

    const { link_token } = await createPlaidLinkToken();

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
      onEvent: (_eventName, _metadata) => {},
    });

    handler.open();
  }

  export async function initiateReauthentication(accountId: number) {
    await loadPlaidSdk();

    const { link_token } = await createPlaidLinkTokenForUpdate(accountId);

    handler = window.Plaid.create({
      token: link_token,
      onSuccess: async (publicToken, metadata) => {
        try {
          await exchangePlaidPublicToken(
            publicToken,
            metadata.institution?.institution_id,
          );
          onAccountLinked();
          onSyncStarted();
        } catch (err) {
          console.error("Failed to exchange token during reauth:", err);
          toast.error("Failed to reconnect account");
        }
      },
      onExit: handleExit,
      onEvent: (_eventName, _metadata) => {},
    });

    handler.open();
  }
</script>
