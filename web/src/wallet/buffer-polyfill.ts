import { Buffer } from 'buffer';

/**
 * WalletConnect's sign-in helpers (ReCap encoding in @walletconnect/utils, used by AppKit's one-click sign-in) call the
 * Node `Buffer` global without checking for it, so choosing WalletConnect failed with "Buffer is not defined". Browsers
 * have no Buffer: provide the standard polyfill before any wallet code runs. Imported first by appkit.tsx.
 */
const g = globalThis as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
