<script lang="ts">
  interface Props {
    version: string;
  }

  const { version }: Props = $props();

  const LATEST_RELEASE_URL = "https://github.com/avi12/youtube-downloader/releases/latest";
</script>

<a class="update-banner" href={LATEST_RELEASE_URL} target="_blank">
  <svg class="update-banner-icon" aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18">
    <path d="M12 2 4 10h4v8h8v-8h4zm-2 14v-6H8.83L12 6.83 15.17 10H14v6z" />
  </svg>
  <span class="update-banner-text">
    Update available
    <span class="update-banner-version">v{version}</span>
  </span>
  <span class="update-banner-action">Get it</span>
</a>

<style>
    .update-banner {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-block: 0 12px;
      margin-inline: 16px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--accent-container);
      color: var(--accent);
      font-weight: 500;
      font-size: 0.8125rem;
      text-decoration: none;
      transition: filter 150ms cubic-bezier(0.2, 0, 0, 1);

      &:hover {
        filter: brightness(0.96);
      }

      .update-banner-icon {
        flex-shrink: 0;
      }

      .update-banner-text {
        flex: 1;
      }

      .update-banner-version {
        opacity: 75%;
      }

      .update-banner-action {
        flex-shrink: 0;
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
    }
</style>
