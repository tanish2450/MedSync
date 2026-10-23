import { stepEvaluate, stepExplain, stepInteractionLookup, stepNormalise, type CheckState } from "../lib/services.js";

// One Lambda bundle, five handlers; the Step Functions state machine wires them in order:
// Normalise -> InteractionLookup -> Evaluate (allergy + duplicate + interaction rules) -> Explain (Bedrock, explanation only)
export const normalise = (s: CheckState) => stepNormalise(s);
export const interactionLookup = (s: CheckState) => stepInteractionLookup(s);
export const evaluate = (s: CheckState) => stepEvaluate(s);
export const explain = (s: CheckState) => stepExplain(s);
