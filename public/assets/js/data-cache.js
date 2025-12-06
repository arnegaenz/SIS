/**
 * Persistent Data Cache using localStorage
 *
 * This module provides a caching layer for daily data that persists across
 * page navigations and browser sessions. It automatically invalidates the
 * cache when the server data is updated.
 */

(function() {
  'use strict';

  const CACHE_PREFIX = 'sis_daily_cache_';
  const VERSION_KEY = 'sis_data_version';
  const MAX_CACHE_SIZE = 5 * 1024 * 1024; // 5MB limit for safety

  /**
   * DataCache class - manages persistent caching of daily data
   */
  class DataCache {
    constructor() {
      this.currentVersion = this._getStoredVersion(); // Load from localStorage immediately
      this.memoryCache = new Map(); // Fast in-memory cache for current session
      this.initialized = false;

      // Start background validation
      this.init();
    }

    /**
     * Initialize the cache by checking server data version (runs in background)
     */
    async init() {
      try {
        const response = await fetch('/api/data-version');
        if (!response.ok) {
          console.warn('Failed to fetch data version, using cached version');
          this.initialized = true;
          return;
        }

        const versionData = await response.json();
        const serverVersion = versionData.version;

        // Check if cached version matches server version
        const cachedVersion = this._getStoredVersion();

        if (cachedVersion !== serverVersion) {
          console.log('Data version mismatch, clearing cache', {
            cached: cachedVersion,
            server: serverVersion
          });
          this.clearAll();
          this.currentVersion = serverVersion;
          this._setStoredVersion(serverVersion);
        } else {
          console.log('Cache version valid:', serverVersion);
          this.currentVersion = serverVersion;
        }

        this.initialized = true;
      } catch (err) {
        console.warn('Cache initialization failed:', err);
        this.initialized = true; // Continue anyway with cached version
      }
    }

    /**
     * Get data from cache (checks memory first, then localStorage)
     */
    get(key) {
      // Check memory cache first
      if (this.memoryCache.has(key)) {
        return this.memoryCache.get(key);
      }

      // Check localStorage
      try {
        const cacheKey = CACHE_PREFIX + key;
        const cached = localStorage.getItem(cacheKey);

        if (cached) {
          const data = JSON.parse(cached);
          // Store in memory cache for faster subsequent access
          this.memoryCache.set(key, data);
          return data;
        }
      } catch (err) {
        console.warn('Cache read error:', err);
      }

      return null;
    }

    /**
     * Store data in cache (both memory and localStorage)
     */
    set(key, data) {
      // Store in memory cache
      this.memoryCache.set(key, data);

      // Store in localStorage
      try {
        const cacheKey = CACHE_PREFIX + key;
        const serialized = JSON.stringify(data);

        // Check size before storing
        if (serialized.length > MAX_CACHE_SIZE) {
          console.warn('Data too large to cache:', key);
          return false;
        }

        localStorage.setItem(cacheKey, serialized);
        return true;
      } catch (err) {
        // Handle QuotaExceededError
        if (err.name === 'QuotaExceededError') {
          console.warn('localStorage quota exceeded, clearing old cache');
          this.clearOldest();
          // Try again after clearing
          try {
            localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
            return true;
          } catch (retryErr) {
            console.error('Failed to cache after clearing:', retryErr);
          }
        } else {
          console.warn('Cache write error:', err);
        }
        return false;
      }
    }

    /**
     * Check if key exists in cache
     */
    has(key) {
      if (this.memoryCache.has(key)) {
        return true;
      }

      try {
        return localStorage.getItem(CACHE_PREFIX + key) !== null;
      } catch (err) {
        return false;
      }
    }

    /**
     * Remove specific key from cache
     */
    remove(key) {
      this.memoryCache.delete(key);

      try {
        localStorage.removeItem(CACHE_PREFIX + key);
      } catch (err) {
        console.warn('Cache remove error:', err);
      }
    }

    /**
     * Clear all cached data
     */
    clearAll() {
      this.memoryCache.clear();

      try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith(CACHE_PREFIX)) {
            localStorage.removeItem(key);
          }
        });
        console.log('Cache cleared');
      } catch (err) {
        console.warn('Cache clear error:', err);
      }
    }

    /**
     * Clear oldest cache entries (LRU-style cleanup)
     * This is a simplified version - removes all cache when quota exceeded
     */
    clearOldest() {
      try {
        const keys = Object.keys(localStorage);
        const cacheKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));

        // Remove half of the cached items
        const toRemove = Math.ceil(cacheKeys.length / 2);
        cacheKeys.slice(0, toRemove).forEach(key => {
          localStorage.removeItem(key);
        });

        console.log(`Cleared ${toRemove} old cache entries`);
      } catch (err) {
        console.warn('Failed to clear oldest cache:', err);
      }
    }

    /**
     * Get cache statistics
     */
    getStats() {
      try {
        const keys = Object.keys(localStorage);
        const cacheKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));

        let totalSize = 0;
        cacheKeys.forEach(key => {
          totalSize += localStorage.getItem(key).length;
        });

        return {
          entries: cacheKeys.length,
          memoryEntries: this.memoryCache.size,
          totalSize: totalSize,
          version: this.currentVersion
        };
      } catch (err) {
        return {
          entries: 0,
          memoryEntries: this.memoryCache.size,
          totalSize: 0,
          version: this.currentVersion,
          error: err.message
        };
      }
    }

    /**
     * Get stored version from localStorage
     */
    _getStoredVersion() {
      try {
        return localStorage.getItem(VERSION_KEY);
      } catch (err) {
        return null;
      }
    }

    /**
     * Set stored version in localStorage
     */
    _setStoredVersion(version) {
      try {
        localStorage.setItem(VERSION_KEY, version);
      } catch (err) {
        console.warn('Failed to store version:', err);
      }
    }
  }

  // Create global instance immediately (init runs in constructor)
  window.DataCache = new DataCache();

  // Expose stats for debugging
  window.getCacheStats = () => window.DataCache.getStats();

  console.log('DataCache module loaded and ready');
})();
