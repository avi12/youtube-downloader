<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { List, ListItem, Button, Icon, Subheader } from "svelte-materialify";
  import { mdiCancel, mdiClose } from "@mdi/js";
  import type { VideoDetails, StatusProgress } from "../types";
  import { getProgress } from "./component-utils";

  export let label: string;
  export let list: string[];
  export let videoDetails: VideoDetails;
  export let statusProgress: StatusProgress;

  const dispatch = createEventDispatcher();

  function stopDownloads(ids: string[]) {
    dispatch("remove-from-list", ids);
  }
</script>

<Subheader>
  {label} list
  {#if list.length > 0}
    <Button on:click={() => stopDownloads(list)}>
      <Icon path={mdiCancel} /> Stop all
    </Button>
  {/if}
</Subheader>

{#if list.length === 0}
  <section>(Currently empty)</section>
{/if}

<List>
  {#each list as videoId}
    <ListItem>
      {videoDetails[videoId].filenameOutput}
      <span slot="subtitle">
        {#if statusProgress[videoId]}
          downloading... {getProgress(statusProgress[videoId]?.progress)}
        {/if}
      </span>
      <span slot="append">
        <Button on:click={() => stopDownloads([videoId])}>
          <Icon path={mdiClose} />
        </Button>
      </span>
    </ListItem>
  {/each}
</List>
