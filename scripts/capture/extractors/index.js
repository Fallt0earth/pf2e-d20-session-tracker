// @ts-check
// Ordered extractor list. Each exports { id, on, matches(msg), extract(msg, ctx, base) }.
// A message is offered to every extractor whose `on` includes the event and whose `matches` passes;
// their `matches` predicates are mutually exclusive by construction (PF2e-typed rolls, untyped d20
// rolls, Toolbelt save flags, pf2-flat-check flags).

import * as pf2eCheck from "./pf2e-check.js";
import * as rawD20 from "./raw-d20.js";
import * as toolbeltSaves from "./toolbelt-saves.js";
import * as flatCheck from "./flat-check.js";

export const EXTRACTORS = [pf2eCheck, rawD20, toolbeltSaves, flatCheck];
