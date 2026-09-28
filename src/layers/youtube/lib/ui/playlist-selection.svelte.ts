import { checkedPlaylistVideosItem, mutateStorageItem } from "@/lib/storage/storage";
import { SvelteSet } from "svelte/reactivity";

class PersistedSvelteSet extends SvelteSet<string> {
  #isApplyingExternal = false;
  #isInitialized = false;

  constructor() {
    super();
    checkedPlaylistVideosItem.watch(next => {
      this.#isInitialized = true;
      this.applyExternal(next);
    });
    void this.#seedFromStorage();
  }

  async #seedFromStorage() {
    const saved = await checkedPlaylistVideosItem.getValue();
    if (this.#isInitialized) {
      return;
    }

    this.#isInitialized = true;
    this.applyExternal(saved);
  }

  override add(value: string) {
    super.add(value);

    if (!this.#isApplyingExternal) {
      void this.#persist();
    }

    return this;
  }

  override delete(value: string) {
    const result = super.delete(value);
    if (!this.#isApplyingExternal) {
      void this.#persist();
    }

    return result;
  }

  override clear() {
    super.clear();

    if (!this.#isApplyingExternal) {
      void this.#persist();
    }
  }

  applyExternal(next: string[]) {
    const incoming = new Set(next);
    let isDifferent = incoming.size !== this.size;
    if (!isDifferent) {
      for (const value of incoming) {
        if (!super.has(value)) {
          isDifferent = true;
          break;
        }
      }
    }

    if (!isDifferent) {
      return;
    }

    this.#isApplyingExternal = true;
    try {
      for (const value of this) {
        if (!incoming.has(value)) {
          super.delete(value);
        }
      }
      for (const value of incoming) {
        super.add(value);
      }
    } finally {
      this.#isApplyingExternal = false;
    }
  }

  async #persist() {
    const snapshot = [...this];
    await mutateStorageItem({
      item: checkedPlaylistVideosItem,
      mutator(current) {
        current.length = 0;
        current.push(...snapshot);
      }
    });
  }
}

export const checkedPlaylistVideos = new PersistedSvelteSet();
