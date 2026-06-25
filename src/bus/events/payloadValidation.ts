export interface CriticalPayloadValidationInput {
  eventName:
    | "ConversationStreamToken"
    | "PermissionAsked"
    | "ToolResult"
    | "SessionStatusChanged"
    | "ConversationCompleted"
    | "McpStatusUpdated"
    | "GoalStatusChanged";
  payload: unknown;
}

export interface CriticalPayloadValidationIssue {
  eventName: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateCriticalAppEventPayloadShapes(
  inputs: CriticalPayloadValidationInput[],
): CriticalPayloadValidationIssue[] {
  const issues: CriticalPayloadValidationIssue[] = [];

  for (const input of inputs) {
    if (!isRecord(input.payload)) {
      issues.push({ eventName: input.eventName, message: "payload 必须是对象" });
      continue;
    }

    switch (input.eventName) {
      case "ConversationStreamToken":
        if (typeof input.payload.content !== "string") {
          issues.push({ eventName: input.eventName, message: "content 必须为 string" });
        }
        if (typeof input.payload.tokenCount !== "number") {
          issues.push({ eventName: input.eventName, message: "tokenCount 必须为 number" });
        }
        break;
      case "PermissionAsked":
        if (typeof input.payload.id !== "string") {
          issues.push({ eventName: input.eventName, message: "id 必须为 string" });
        }
        if (typeof input.payload.permission !== "string") {
          issues.push({ eventName: input.eventName, message: "permission 必须为 string" });
        }
        if (typeof input.payload.tool !== "string") {
          issues.push({ eventName: input.eventName, message: "tool 必须为 string" });
        }
        break;
      case "ToolResult":
        if (typeof input.payload.callId !== "string") {
          issues.push({ eventName: input.eventName, message: "callId 必须为 string" });
        }
        if (typeof input.payload.tool !== "string") {
          issues.push({ eventName: input.eventName, message: "tool 必须为 string" });
        }
        if (typeof input.payload.success !== "boolean") {
          issues.push({ eventName: input.eventName, message: "success 必须为 boolean" });
        }
        if (!("result" in input.payload)) {
          issues.push({ eventName: input.eventName, message: "result 必须存在" });
        }
        break;
      case "SessionStatusChanged":
        if (typeof input.payload.sessionId !== "string") {
          issues.push({ eventName: input.eventName, message: "sessionId 必须为 string" });
        }
        const validStatuses = new Set([
          "idle",
          "busy",
          "retry",
          "error",
          "waiting",
          "completed",
          "failed",
          "cancelled",
        ]);
        if (!validStatuses.has(input.payload.status as string)) {
          issues.push({
            eventName: input.eventName,
            message: "status 必须为 idle|busy|retry|error|waiting|completed|failed|cancelled",
          });
        }
        if (!validStatuses.has(input.payload.previousStatus as string)) {
          issues.push({
            eventName: input.eventName,
            message: "previousStatus 必须为 idle|busy|retry|error|waiting|completed|failed|cancelled",
          });
        }
        break;
      case "ConversationCompleted":
        if (typeof input.payload.ok !== "boolean") {
          issues.push({ eventName: input.eventName, message: "ok 必须为 boolean" });
        }
        if (typeof input.payload.toolRounds !== "number") {
          issues.push({ eventName: input.eventName, message: "toolRounds 必须为 number" });
        }
        if (typeof input.payload.textLength !== "number") {
          issues.push({ eventName: input.eventName, message: "textLength 必须为 number" });
        }
        if (typeof input.payload.durationMs !== "number") {
          issues.push({ eventName: input.eventName, message: "durationMs 必须为 number" });
        }
        break;
      case "McpStatusUpdated":
        if (!Array.isArray(input.payload.servers)) {
          issues.push({ eventName: input.eventName, message: "servers 必须为数组" });
        }
        if (!Array.isArray(input.payload.builtinGroups)) {
          issues.push({ eventName: input.eventName, message: "builtinGroups 必须为数组" });
        }
        break;
      case "GoalStatusChanged":
        if (typeof input.payload.id !== "string") {
          issues.push({ eventName: input.eventName, message: "id 必须为 string" });
        }
        if (typeof input.payload.sessionId !== "string") {
          issues.push({ eventName: input.eventName, message: "sessionId 必须为 string" });
        }
        break;
    }
  }

  return issues;
}
