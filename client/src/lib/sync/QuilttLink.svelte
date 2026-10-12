<script lang="ts">
  import { createQuilttSession, quilttCallback } from "./api";
  import { loadQuilttSdk, type QuilttCallbacks } from "./sdk";
  import { triggerPoll } from "./sync-status";
  import { toast } from "svelte-sonner";

  interface Props {
    onAccountLinked?: () => void;
    onSyncStarted?: () => void;
  }

  let { onAccountLinked = () => {}, onSyncStarted = () => {} }: Props =
    $props();

  // State
  let isLinking = $state(false);

  /**
   * Opens Quiltt's connector to sign back in to `quilttConnectionId`, or
   * otherwise on its own institution search. It's never handed a bank name:
   * one Quiltt can't resolve dead-ends on "Institution No Longer Supported"
   * instead of letting the user search.
   */
  export async function initiateQuilttLink(quilttConnectionId?: string) {
    if (isLinking) return;

    isLinking = true;
    const action = quilttConnectionId ? "reconnect" : "connect";

    try {
      await loadQuilttSdk();

      const sessionData = await createQuilttSession();

      window.Quiltt.authenticate(sessionData.token);

      const callbacks: QuilttCallbacks = {
        onExitSuccess: (metadata) => {
          handleSuccess(metadata.connectionId!, sessionData.profileId);
        },
        onExitAbort: cleanup,
        onExitError: (metadata) => {
          console.error(`Quiltt ${action} error:`, metadata);
          toast.error(`Failed to ${action} account`);
          cleanup();
        },
      };
      const connector = quilttConnectionId
        ? window.Quiltt.reconnect(sessionData.connectorId, {
            ...callbacks,
            connectionId: quilttConnectionId,
          })
        : window.Quiltt.connect(sessionData.connectorId, callbacks);

      connector.open();
    } catch (error) {
      console.error(`Quiltt ${action} error:`, error);
      toast.error(`Failed to ${action} account`);
      cleanup();
    }
  }

  async function handleSuccess(connectionId: string, profileId: string) {
    try {
      toast.success("Account linked successfully!", {
        description: "We started syncing your transactions.",
      });

      await quilttCallback(connectionId, profileId);

      // Small delay to ensure server-side processing completes
      await new Promise((resolve) => setTimeout(resolve, 1000));

      onAccountLinked();
      onSyncStarted();
      triggerPoll();
    } catch (error) {
      console.error("Quiltt callback error:", error);
    } finally {
      cleanup();
    }
  }

  function cleanup() {
    isLinking = false;
  }
</script>
