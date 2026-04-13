import { SvelteSet } from "svelte/reactivity";

const SESSION_KEY = "session:ytdl-checked-playlist-videos";

class PersistedSvelteSet extends SvelteSet<string> {
  override add(value: string) {
    super.add(value);
    void storage.setItem(SESSION_KEY, [...this]);
    return this;
  }

  override delete(value: string) {
    const result = super.delete(value);
    void storage.setItem(SESSION_KEY, [...this]);
    return result;
  }

  override clear() {
    super.clear();
    void storage.setItem(SESSION_KEY, []);
  }

  loadSaved(values: string[]) {
    for (const value of values) {
      super.add(value);
    }
  }
}

export const checkedPlaylistVideos = new PersistedSvelteSet();

void (async () => {
  const saved = await storage.getItem<string[]>(SESSION_KEY);
  if (saved) {
    checkedPlaylistVideos.loadSaved(saved);
  }
})();
