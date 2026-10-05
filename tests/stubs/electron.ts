/* Minimal stand-in for the electron main-process module so that logic
   modules can be imported in Vitest. Only what our modules touch exists;
   anything else is absent so a test that needs more fails loudly. */

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').replace(/^enc:/, ''),
};

export const app = {
  getPath: (name: string) => `/tmp/yap-test/${name}`,
  isPackaged: false,
};

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
};

export const shell = {
  showItemInFolder: () => undefined,
  openPath: async () => '',
  openExternal: async () => undefined,
};

let clipboardText = '';
export const clipboard = {
  writeText: (text: string) => {
    clipboardText = text;
  },
  readText: () => clipboardText,
};

export const net = {
  fetch: async () => {
    throw new Error('net.fetch is not available in tests; use setGroqTransport.');
  },
};

export const session = {
  defaultSession: {
    preconnect: () => undefined,
  },
};

export const systemPreferences = {
  getMediaAccessStatus: () => 'granted',
  askForMediaAccess: async () => true,
};
