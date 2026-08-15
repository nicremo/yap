/* Minimal stand-in for the electron main-process module so that pure logic
   modules can be imported in Vitest. Only the members our main modules touch
   are implemented; anything else is intentionally absent so a test that needs
   more fails loudly instead of silently passing. */

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8'),
};

export const app = {
  getPath: (name: string) => `/tmp/yap-test/${name}`,
};

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
};

export const shell = {
  showItemInFolder: () => undefined,
  openPath: async () => '',
};
