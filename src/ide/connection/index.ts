// WebSocket server (inbound from IDE extensions)
export { IDEWebSocketServer, ideWsServer } from "./wsServer";
export type { IDEClient, SendRequestResult } from "./wsServer";

// Aggregated connection state manager
export { ideStateManager } from "./stateManager";
export type { IDEConnectionState } from "./stateManager";

// Context aggregation layer
export { getAggregatedContext, getAggregatedContextPrompt, onAggregatedContextChange } from "./contextManager";
export type { AggregatedContext } from "./contextManager";

// IDE interaction request router
export {
  wireInteractionManager,
  registerInteractionHandler,
  unregisterInteractionHandler,
  sendToIDE,
  handleIDERequest,
  broadcastToIDE,
} from "./interactionManager";
export type { InteractionRequest, InteractionResponse } from "./interactionManager";

// Message format adapters
export { editorContextFromParams, diagnosticsFromParams, validateSimpleMessageBounds } from "./wsMessageAdapters";
export type { IdeDiagnosticPayload } from "./wsMessageAdapters";
