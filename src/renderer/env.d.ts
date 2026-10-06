/// <reference types="vite/client" />

import type { YapApi } from '../preload';

declare global {
  interface Window {
    yap: YapApi;
  }
}

export {};
