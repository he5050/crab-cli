/**
 * 认证模块 — 统一导出认证相关功能。
 *
 * 模块结构:
 *   - authChain.ts   — 认证链、AuthInfo、AuthProvider
 *   - oauthStore.ts  — OAuth Token 持久化存储
 *   - oauthFlow.ts   — OAuth PKCE 流程
 */
export {
  AuthChain,
  getGlobalAuthChain,
  resetGlobalAuthChain,
  resolveAuthHeaders,
  isAuthExpired,
  type AuthInfo,
  type AuthProvider,
} from "./authChain";

export {
  readProviderAuth,
  writeProviderAuth,
  removeProviderAuth,
  isTokenExpired,
  refreshProviderToken,
  getValidAccessToken,
  type ProviderOAuthToken,
  type ProviderOAuthConfig,
} from "./oauthStore";

export {
  generatePkcePair,
  generateState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  startOAuthFlow,
  type PkcePair,
} from "./oauthFlow";
