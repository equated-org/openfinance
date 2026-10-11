<script lang="ts">
  import {
    createPlaidLinkToken,
    createPlaidLinkTokenForUpdate,
    exchangePlaidPublicToken,
  } from "./api";
  import { loadPlaidSdk, type PlaidHandler } from "./sdk";

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
        }
      },
      onExit: (_err, _metadata) => {
        handler = null;
        onExit();
      },
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
        }
      },
      onExit: (_err, _metadata) => {
        handler = null;
        onExit();
      },
      onEvent: (_eventName, _metadata) => {},
    });

    handler.open();
  }
</script>
