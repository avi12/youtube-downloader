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
