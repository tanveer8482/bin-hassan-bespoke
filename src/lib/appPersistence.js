import { openDB } from "idb";
import { emptySnapshot } from "./emptySnapshot";

const DB_NAME = "bhb_app_persistence";
const DB_VERSION = 1;
const STORE_NAME = "app_state";

export const PERSISTENCE_KEYS = {
  mutationQueue: "mutationQueue",
  snapshotCache: "snapshotCache",
  syncHistory: "syncHistory"
};

let dbPromise = null;

function isIndexedDbSupported() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function warnStorageError(action, error) {
  console.warn(`[APP_STORAGE] ${action} failed`, error);
}

function getDb() {
  if (!isIndexedDbSupported()) {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      }
    });
  }

  return dbPromise;
}

export function normalizeSnapshotCache(snapshotCache) {
  if (!snapshotCache || typeof snapshotCache !== "object") {
    return {
      data: emptySnapshot(),
      settings: [],
      lastSynced: ""
    };
  }

  return {
    data: snapshotCache.data || emptySnapshot(),
    settings: Array.isArray(snapshotCache.settings) ? snapshotCache.settings : [],
    lastSynced: snapshotCache.lastSynced || ""
  };
}

export async function getPersistedValue(key, fallback) {
  if (!isIndexedDbSupported()) return fallback;

  try {
    const db = await getDb();
    const value = await db.get(STORE_NAME, key);
    return value === undefined ? fallback : value;
  } catch (error) {
    warnStorageError(`read:${key}`, error);
    return fallback;
  }
}

export async function setPersistedValue(key, value) {
  if (!isIndexedDbSupported()) return false;

  try {
    const db = await getDb();
    await db.put(STORE_NAME, value, key);
    return true;
  } catch (error) {
    warnStorageError(`write:${key}`, error);
    return false;
  }
}

export async function removePersistedValue(key) {
  if (!isIndexedDbSupported()) return false;

  try {
    const db = await getDb();
    await db.delete(STORE_NAME, key);
    return true;
  } catch (error) {
    warnStorageError(`delete:${key}`, error);
    return false;
  }
}

export async function clearPersistedState() {
  if (!isIndexedDbSupported()) return false;

  try {
    const db = await getDb();
    await db.clear(STORE_NAME);
    return true;
  } catch (error) {
    warnStorageError("clear", error);
    return false;
  }
}

export async function loadPersistedAppState() {
  const [mutationQueue, snapshotCache, syncHistory] = await Promise.all([
    getPersistedValue(PERSISTENCE_KEYS.mutationQueue, []),
    getPersistedValue(PERSISTENCE_KEYS.snapshotCache, null),
    getPersistedValue(PERSISTENCE_KEYS.syncHistory, [])
  ]);

  return {
    mutationQueue: Array.isArray(mutationQueue) ? mutationQueue : [],
    snapshotCache: normalizeSnapshotCache(snapshotCache),
    syncHistory: Array.isArray(syncHistory) ? syncHistory : []
  };
}
