<script generics="T extends string" lang="ts">
  interface Props {
    tabs: {
      id: T;
      label: string;
      badge?: number;
    }[];
    activeTab: T;
    onChange(id: T): void;
  }

  const { tabs, activeTab, onChange }: Props = $props();

  const tabButtonElements: Record<string, HTMLButtonElement> = {};

  function registerTabButton(tabId: T) {
    return (element: Element) => {
      if (element instanceof HTMLButtonElement) {
        tabButtonElements[tabId] = element;
      }
    };
  }
</script>

<div class="tab-nav" role="tablist">
  {#each tabs as tab (tab.id)}
    <button
      class="tab-nav-button"
      class:tab-nav-button--active={activeTab === tab.id}
      {@attach registerTabButton(tab.id)}
      aria-controls="panel-{tab.id}"
      aria-selected={activeTab === tab.id}
      onclick={() => onChange(tab.id)}
      onkeydown={e => {
        const iCurrent = tabs.findIndex(tab => tab.id === activeTab);
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          const next = tabs[(iCurrent + 1) % tabs.length].id;
          onChange(next);
          tabButtonElements[next]?.focus();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const prev = tabs[(iCurrent - 1 + tabs.length) % tabs.length].id;
          onChange(prev);
          tabButtonElements[prev]?.focus();
        }
      }}
      role="tab"
      tabindex={activeTab === tab.id ? 0 : -1}
    >
      {tab.label}
      {#if tab.badge !== undefined && tab.badge > 0}
        <span class="badge" aria-label="{tab.badge} active">{tab.badge}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .tab-nav {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 16px;
    background: var(--surface);
  }

  .tab-nav-button {
    display: flex;
    flex: 1;
    gap: 6px;
    justify-content: center;
    align-items: center;
    padding: 8px 16px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--fg-muted);
    font-family: inherit;
    font-weight: 500;
    font-size: 0.8125rem;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 200ms, color 200ms;

    &:hover {
      background: var(--accent-hover);
      color: var(--fg);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .tab-nav-button--active {
    background: var(--accent-container);
    color: var(--accent);
    font-weight: 600;
  }

  .badge {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--danger);
    color: var(--on-danger);
    font-weight: 600;
    font-size: 0.6875rem;
  }
</style>
