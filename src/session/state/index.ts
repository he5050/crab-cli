export {
  SessionState,
  InvalidStateTransitionError,
  isTerminalState,
  canAcceptInput as canAcceptInputByState,
  canExecute,
  SessionStateMachine,
  createSessionStateMachine,
  createLoggedStateMachine,
  createProtectedStateMachine,
  canTransition,
  getAvailableTransitions,
  StateTransitionEvent,
} from "./stateMachine";
export type { StateMachineConfig } from "./stateMachine";

export type { SessionStateManagerConfig, UnifiedSessionState, SessionStateChangedPayload } from "./sessionStateManager";
export {
  SessionStateManager,
  getOrCreateSessionStateManager,
  getSessionStateManager,
  getAllSessionStateManagers,
  destroySessionStateManager,
  destroyAllSessionStateManagers,
} from "./sessionStateManager";

export type { SessionStatus, SessionStatusPayload } from "./sessionStatus";
export {
  getSessionStatus,
  setSessionStatus,
  syncRuntimeSessionStatus,
  isSessionBusy,
  canAcceptInput,
  clearSessionStatus,
  _resetAllStatus,
  getBusySessions,
  resetAllBusy,
} from "./sessionStatus";
