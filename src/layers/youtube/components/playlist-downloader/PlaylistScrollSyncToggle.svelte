<script lang="ts">
  interface Props {
    isEnabled: boolean;
    ontoggle: (isEnabled: boolean) => void;
  }

  const { isEnabled, ontoggle }: Props = $props();
</script>

<div class="ytdl-scroll-sync-opt" class:is-on={isEnabled}>
  <tp-yt-paper-checkbox
    checked={isEnabled ? "" : undefined}
    onchange={e => {
      const isHtmlElement = e.target instanceof HTMLElement;
      if (isHtmlElement) {
        ontoggle(e.target.hasAttribute("checked"));
      }
    }}
  >
    <span class="ytdl-scroll-sync-label">Auto-scroll the playlist as videos download</span>
    <span class="ytdl-scroll-sync-sub">Applies to both selected and whole-playlist downloads</span>
  </tp-yt-paper-checkbox>
</div>

<style>
  .ytdl-scroll-sync-opt {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border: 1px dashed var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 28%));
    border-radius: 10px;
    background: color-mix(in oklab, var(--yt-sys-color-baseline--text-primary, #0f0f0f) 4%, transparent);
    cursor: pointer;
    transition: border-color 120ms ease;

    &:hover {
      border-color: var(--yt-sys-color-baseline--text-secondary, #606060);
    }

    &.is-on {
      border-color: color-mix(in oklab, var(--yt-sys-color-baseline--call-to-action, #065fd4) 50%, transparent);
      border-style: solid;
      background: color-mix(in oklab, var(--yt-sys-color-baseline--call-to-action, #065fd4) 10%, transparent);
    }
  }

  .ytdl-scroll-sync-label {
    display: block;
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    font-weight: 500;
    font-size: 1.4rem;
  }

  .ytdl-scroll-sync-sub {
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-size: 1.1rem;
    line-height: 1.35;
  }
</style>
