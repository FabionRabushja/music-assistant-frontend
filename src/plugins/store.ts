import { computed, reactive } from "vue";
import { MediaType, Player, PlayerQueue, QueueItem, MediaItem } from "./api/interfaces";

import api from "./api";
import { StoredState } from "@/components/ItemsListing.vue";
import { isTouchscreenDevice } from "@/helpers/utils";

import MobileDetect from "mobile-detect";

type DeviceType = "desktop" | "phone" | "tablet";
const md = new MobileDetect(window.navigator.userAgent);

const DEVICE_TYPE: DeviceType = md.tablet()
  ? "tablet"
  : md.phone() || md.mobile()
    ? "phone"
    : "desktop";

export enum AlertType {
  ERROR = "error",
  WARNING = "warning",
  INFO = "info",
  SUCCESS = "success",
}

interface Alert {
  type: AlertType;
  message: string;
  persistent: boolean;
}

export interface Shortcut extends MediaItem {
  id: string;
  name: string;
  icon: string;
  itemType: MediaType;
  itemId: string;
  provider: string;
  uri: string;
}

interface Store {
  shortcuts: Shortcut[];  // Add shortcuts array to store
  activePlayerId?: string;
  isInStandaloneMode: boolean;
  showPlayersMenu: boolean;
  navigationMenuStyle: string;
  showFullscreenPlayer: boolean;
  frameless: boolean;
  showQueueItems: boolean;
  apiInitialized: boolean;
  apiBaseUrl: string;
  dialogActive: boolean;
  activePlayer?: Player;
  activePlayerQueue?: PlayerQueue;
  curQueueItem?: QueueItem;
  globalSearchTerm?: string;
  globalSearchType?: MediaType;
  prevState?: StoredState;
  activeAlert?: Alert;
  prevRoute?: string;
  libraryArtistsCount?: number;
  libraryAlbumsCount?: number;
  libraryTracksCount?: number;
  libraryPlaylistsCount?: number;
  libraryRadiosCount?: number;
  libraryPodcastsCount?: number;
  libraryAudiobooksCount?: number;
  connected?: boolean;
  isTouchscreen: boolean;
  playMenuShown: boolean;
  playActionInProgress: boolean;
  deviceType: DeviceType;
}

export const store: Store = reactive({
  shortcuts: JSON.parse(localStorage.getItem('shortcuts') || '[]'),
  activePlayerId: undefined,
  isInStandaloneMode: false,
  showPlayersMenu: false,
  navigationMenuStyle: "horizontal",
  showFullscreenPlayer: false,
  frameless: false,
  showQueueItems: false,
  apiInitialized: false,
  apiBaseUrl: "",
  dialogActive: false,
  activePlayer: computed(() => {
    if (store.activePlayerId && store.activePlayerId in api.players) {
      return api.players[store.activePlayerId];
    }
    return undefined;
  }),
  activePlayerQueue: computed(() => {
    if (
      store.activePlayer?.active_source &&
      store.activePlayer.active_source in api.queues
    ) {
      return api.queues[store.activePlayer.active_source];
    }
    if (
      store.activePlayer &&
      !store.activePlayer.active_source &&
      store.activePlayer.player_id in api.queues &&
      api.queues[store.activePlayer.player_id].active
    ) {
      return api.queues[store.activePlayer.player_id];
    }
    return undefined;
  }),
  curQueueItem: computed(() => {
    if (store.activePlayerQueue && store.activePlayerQueue.active)
      return store.activePlayerQueue.current_item;
    return undefined;
  }),
  globalSearchTerm: undefined,
  globalSearchType: undefined,
  prevState: undefined,
  activeAlert: undefined,
  prevRoute: undefined,
  libraryArtistsCount: undefined,
  libraryAlbumsCount: undefined,
  libraryTracksCount: undefined,
  libraryPlaylistsCount: undefined,
  libraryRadiosCount: undefined,
  connected: false,
  isTouchscreen: isTouchscreenDevice(),
  playMenuShown: false,
  playActionInProgress: false,
  deviceType: DEVICE_TYPE,
});

// Helper functions for managing shortcuts
export async function addShortcut(item: MediaItem) {
    // Resolve a full item from library or provider to ensure images are present
    let fullItem: MediaItem = item;
    try {
        const fromLibrary = await api.getLibraryItem(item.media_type, item.item_id, item.provider);
        if (fromLibrary) fullItem = fromLibrary as MediaItem;
        if (!fullItem.metadata?.images || fullItem.metadata.images.length === 0) {
            const fromProvider = await api.getItem(item.media_type, item.item_id, item.provider);
            if (fromProvider) fullItem = fromProvider as MediaItem;
        }
        if (!fullItem.metadata?.images || fullItem.metadata.images.length === 0) {
            fullItem = (await api.updateMetadata(fullItem, true)) as MediaItem;
        }
    } catch (err) {
        // ignore resolution errors; we'll fallback to the provided item
        fullItem = item;
    }

    const completeItem = { ...fullItem } as any;
    if ('album' in fullItem) completeItem.album = (fullItem as any).album;
    if ('artists' in fullItem) completeItem.artists = (fullItem as any).artists;

    const shortcut: Shortcut = {
        ...completeItem,
        id: `${item.media_type}-${item.item_id}`,
        name: item.name,
        icon: getIconForMediaType(item.media_type),
        itemType: item.media_type,
        itemId: item.item_id,
        provider: item.provider,
        uri: item.uri
    };

    if (!store.shortcuts.some(s => s.id === shortcut.id)) {
        store.shortcuts.push(shortcut);
        saveShortcuts();
    }
}

export async function hydrateShortcutsImages() {
    try {
        for (let i = 0; i < store.shortcuts.length; i++) {
            const sc = store.shortcuts[i] as any;
            const hasImages = sc?.metadata?.images && sc.metadata.images.length > 0;
            if (hasImages) continue;
            try {
                let fullItem = (await api.getLibraryItem(sc.media_type || sc.itemType, sc.item_id || sc.itemId, sc.provider)) as any;
                if (!fullItem) {
                    fullItem = (await api.getItem(sc.media_type || sc.itemType, sc.item_id || sc.itemId, sc.provider)) as any;
                }
                if (fullItem && (!fullItem.metadata?.images || fullItem.metadata.images.length === 0)) {
                    fullItem = (await api.updateMetadata(fullItem, true)) as any;
                }
                if (fullItem) {
                    const merged = { ...sc, ...fullItem };
                    // preserve shortcut fields
                    merged.id = sc.id;
                    merged.itemType = sc.itemType || fullItem.media_type;
                    merged.itemId = sc.itemId || fullItem.item_id;
                    merged.provider = sc.provider || fullItem.provider;
                    merged.uri = sc.uri || fullItem.uri;
                    store.shortcuts[i] = merged;
                }
            } catch (_e) {
                // ignore per-item failures
            }
        }
        localStorage.setItem('shortcuts', JSON.stringify(store.shortcuts));
    } catch (_err) {
        // ignore
    }
}

export function removeShortcut(id: string) {
    const index = store.shortcuts.findIndex(s => s.id === id);
    if (index !== -1) {
        store.shortcuts.splice(index, 1);
        saveShortcuts();
    }
}

function saveShortcuts() {
    localStorage.setItem('shortcuts', JSON.stringify(store.shortcuts));
}

function getIconForMediaType(type: MediaType): string {
    switch (type) {
        case MediaType.TRACK:
            return 'mdi-music-note';
        case MediaType.ALBUM:
            return 'mdi-album';
        case MediaType.ARTIST:
            return 'mdi-account-music';
        case MediaType.PLAYLIST:
            return 'mdi-playlist-music';
        default:
            return 'mdi-bookmark';
    }
}
