<script lang="ts">
  import { createQuilttSession, quilttCallback } from "./api";
  import { loadQuilttSdk } from "./sdk";
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
  let currentRegistryId = $state<number | undefined>();

  /**
   * Normalize institution name for Quiltt search.
   * Removes common suffixes that don't work with Quiltt search.
   */
  function normalizeInstitutionName(name: string): string {
    return name
      .replace(/\s*[-\u2013]\s*(Personal|Business|Corporate|Commercial)$/i, "")
      .replace(/\s*\((Personal|Business|Corporate|Commercial)\)$/i, "")
      .trim();
  }

  export async function initiateQuilttLink(
    institutionName?: string,
    institutionRegistryId?: number,
  ) {
    if (isLinking) return;

    isLinking = true;
    currentRegistryId = institutionRegistryId;

    try {
      await loadQuilttSdk();

      const sessionData = await createQuilttSession();

      window.Quiltt.authenticate(sessionData.token);

      const profileId = sessionData.profileId;

      const connector = window.Quiltt.connect(sessionData.connectorId, {
        institution: institutionName
          ? normalizeInstitutionName(institutionName)
          : undefined,
        onExitSuccess: (metadata) => {
          handleSuccess(metadata.connectionId!, profileId);
        },
        onExitAbort: () => {
          cleanup();
        },
        onExitError: (metadata) => {
          console.error("Quiltt connection error:", metadata);
          toast.error("Failed to connect account");
          cleanup();
        },
      });

      connector.open();
    } catch (error) {
      console.error("Quiltt link error:", error);
      toast.error("Failed to start account linking");
      cleanup();
    }
  }

  async function handleSuccess(connectionId: string, profileId: string) {
    try {
      toast.success("Account linked successfully!", {
        description: "We started syncing your transactions.",
      });

      await quilttCallback(connectionId, profileId, currentRegistryId);

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

  export async function initiateReauthentication(quilttConnectionId: string) {
    if (isLinking) return;

    isLinking = true;

    try {
      await loadQuilttSdk();

      const sessionData = await createQuilttSession();

      window.Quiltt.authenticate(sessionData.token);

      const profileId = sessionData.profileId;

      const connector = window.Quiltt.reconnect(sessionData.connectorId, {
        connectionId: quilttConnectionId,
        onExitSuccess: (metadata) => {
          handleSuccess(metadata.connectionId!, profileId);
        },
        onExitAbort: () => {
          cleanup();
        },
        onExitError: (metadata) => {
          console.error("Quiltt reconnection error:", metadata);
          toast.error("Failed to reconnect account");
          cleanup();
        },
      });

      connector.open();
    } catch (error) {
      console.error("Quiltt reconnect error:", error);
      toast.error("Failed to start account reconnection");
      cleanup();
    }
  }

  function cleanup() {
    isLinking = false;
    currentRegistryId = undefined;
  }
</script>
