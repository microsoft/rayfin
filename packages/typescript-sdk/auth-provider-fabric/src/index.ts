// Types
export type { FabricAuthOptions } from './types';
export type { EntraTokenSignInOptions } from './signInWithEntraToken';
export type { EmbeddedAuthResult } from './initEmbeddedAuth';
export {
  signInWithEntraToken,
  signInWithBrokeredToken,
} from './signInWithEntraToken';

// Functions
export { bridgeFabricCallback } from './bridgeFabricCallback';
export { embeddedFabricLogin } from './embeddedFabricLogin';
export { ensureSignedInWithFabric } from './ensureSignedInWithFabric';
export {
  initEmbeddedAuth,
  initEmbeddedAuthWithResult,
} from './initEmbeddedAuth';
export { initiateFabricLogin } from './initiateFabricLogin';
export { requestHandoff } from './PostMessageAuthTransport';
export type { PostMessageHandoffResult } from './PostMessageAuthTransport';
