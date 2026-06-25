import type { EventDefinition } from "../core/types";
import { validateEventName } from "./namingRules";

export interface AppEventNameValidationIssue {
  eventName: string;
  message: string;
  type: string;
}

export function validateAllAppEventNames(
  events: Record<string, EventDefinition<unknown>>,
): AppEventNameValidationIssue[] {
  const issues: AppEventNameValidationIssue[] = [];

  for (const [eventName, eventDefinition] of Object.entries(events)) {
    const message = validateEventName(eventDefinition.type, eventName);
    if (message) {
      issues.push({
        eventName,
        message,
        type: eventDefinition.type,
      });
    }
  }

  return issues;
}
