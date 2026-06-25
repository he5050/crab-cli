export { skillManager, createSkillManager, inferSkillPhase } from "./manager";
export { discoverSkills, parseSkillFile } from "./discovery";
export { SkillRunner } from "./runner";
export { builtinSkills } from "./builtin";
export { skillFrontmatterSchema } from "./types";
export { generateSkillDraftWithAI, writeSkillDraft } from "./generator";
export {
  recommendSkillsForContext,
  resolveExplicitSkillReference,
  buildSkillIndexReminder,
  setSkillSearchProvider,
  type SkillSearchProvider,
} from "./recommendation";
