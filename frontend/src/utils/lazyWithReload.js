import { lazy } from 'react';

const CHUNK_ERROR_PATTERN = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i;

export const lazyWithReload = (factory, key = 'route') =>
  lazy(async () => {
    try {
      const mod = await factory();
      try {
        sessionStorage.removeItem(`lazy-reload:${key}`);
      } catch {
        // Ignore storage failures.
      }
      return mod;
    } catch (error) {
      const message = `${error?.message || ''} ${error?.stack || ''}`;
      const isChunkError = CHUNK_ERROR_PATTERN.test(message);
      let alreadyRetried = false;
      try {
        alreadyRetried = sessionStorage.getItem(`lazy-reload:${key}`) === '1';
      } catch {
        alreadyRetried = false;
      }
      if (isChunkError && !alreadyRetried && typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(`lazy-reload:${key}`, '1');
        } catch {
          // Ignore storage failures.
        }
        window.location.reload();
        return new Promise(() => {});
      }
      throw error;
    }
  });
