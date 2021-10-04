<script lang="ts">
import { Subheader, Switch } from "svelte-materialify";
import type { Options } from "../types";
import { setOption } from "../utils";

export let options: Options;

let { isRemoveNativeDownload } = options;

$: {
  setOption("isRemoveNativeDownload", isRemoveNativeDownload);
}

</script>

<Subheader>Native Download Removal</Subheader>

<Switch bind:checked={isRemoveNativeDownload}
  >Remove the native Download button</Switch
>
