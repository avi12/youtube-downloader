<script generics="T extends string" lang="ts">
  interface Props {
    tabs: {
      id: T;
      label: string;
      badge?: number;
      icon?: string;
    }[];
    activeTab: T;
    initialActiveTab: T;
    onChange(id: T): void;
  }

  const { tabs, activeTab, initialActiveTab, onChange }: Props = $props();

  let tabButtonElements = $state<Record<string, HTMLButtonElement>>({});
  let tabListEl: HTMLDivElement | null = $state(null);
  let indLeft = $state(0);
  let indWidth = $state(0);
  let hasChanged = $state(false);

  function registerTabButton(tabId: T) {
    return (element: Element) => {
      if (element instanceof HTMLButtonElement) {
        tabButtonElements[tabId] = element;
      }
    };
  }

  function updateIndicator(tabId: T): void {
    const elTabButton = tabButtonElements[tabId];
    if (!elTabButton || !tabListEl) {
      return;
    }

    const parentLeft = tabListEl.getBoundingClientRect().left;
    const btnRect = elTabButton.getBoundingClientRect();
    const indicatorWidth = Math.min(72, btnRect.width - 28);
    indLeft = btnRect.left - parentLeft + btnRect.width / 2 - indicatorWidth / 2;
    indWidth = indicatorWidth;
  }

  $effect(() => {
    updateIndicator(activeTab);
  });

  $effect(() => {
    if (activeTab !== initialActiveTab) {
      hasChanged = true;
    }
  });

  function handleTabKeydown(e: KeyboardEvent): void {
    const keyDirections: Partial<Record<string, 1 | -1>> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1
    };
    const direction = keyDirections[e.key];
    if (direction === undefined) {
      return;
    }

    e.preventDefault();
    const iCurrent = tabs.findIndex(tab => tab.id === activeTab);
    const nextId = tabs[(iCurrent + direction + tabs.length) % tabs.length].id;
    onChange(nextId);
    tabButtonElements[nextId]?.focus();
  }
</script>

<div bind:this={tabListEl} class="tab-nav" role="tablist">
  {#each tabs as tab (tab.id)}
    <button
      class="tab-nav-button"
      class:tab-nav-button--active={activeTab === tab.id}
      {@attach registerTabButton(tab.id)}
      aria-controls="panel-{tab.id}"
      aria-selected={activeTab === tab.id}
      data-id={tab.id}
      onclick={() => onChange(tab.id)}
      onkeydown={handleTabKeydown}
      role="tab"
      tabindex={activeTab === tab.id ? 0 : -1}
    >
      {#if tab.icon}
        {@html tab.icon}
      {/if}
      {tab.label}
      {#if tab.badge !== undefined && tab.badge > 0}
        <span class="badge">{tab.badge}</span>
      {/if}
    </button>
  {/each}
</div>
<div class="tab-track">
  <div
    style:--ind-left="{indLeft}px"
    style:--ind-width="{indWidth}px"
    class="tab-ind"
    class:tab-ind--animated={hasChanged}
  ></div>
</div>

<style>
  .tab-nav {
    position: relative;
    display: flex;
  }

  .tab-nav-button {
    display: flex;
    flex: 1;
    gap: 6px;
    justify-content: center;
    align-items: center;
    height: 46px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--fg-muted);
    font-family: inherit;
    font-weight: 500;
    font-size: 0.84375rem;
    white-space: nowrap;
    cursor: pointer;
    transition: color 200ms cubic-bezier(0.2, 0, 0, 1);

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    :global(svg) {
      width: 18px;
      height: 18px;
    }
  }

  .tab-nav-button--active {
    color: var(--accent);
  }

  .tab-track {
    position: relative;
    height: 3px;
    background: transparent;

    &::before {
      content: "";
      position: absolute;
      inset-inline: 0;
      bottom: 0;
      height: 1px;
      background: var(--border);
    }
  }

  .tab-ind {
    position: absolute;
    bottom: 0;
    width: var(--ind-width, 0);
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: var(--accent);
    transform: translateX(var(--ind-left, 0));

    &.tab-ind--animated {
      /* stylelint-disable plugin/no-low-performance-animation-properties */
      transition:
        transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1),
        width 300ms cubic-bezier(0.3, 0, 0, 1);
      /* stylelint-enable plugin/no-low-performance-animation-properties */
    }
  }

  .badge {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-primary, #ffffff);
    font-weight: 700;
    font-size: 0.65625rem;
  }
</style>
