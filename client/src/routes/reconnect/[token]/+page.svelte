<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";

  // Links used to carry the token in the path. Move it to the fragment, where
  // the reconnect page reads it and no server ever sees it.
  onMount(() => {
    window.location.replace(`/reconnect#${page.params.token}`);
  });
</script>
