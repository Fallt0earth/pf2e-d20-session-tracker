// @ts-check
// JSDoc type definitions shared by the pure layer and the Foundry-facing code. No runtime code.

/**
 * One physical d20 result, as persisted (docs/PLAN.md §4.3, SCOPE §4.1).
 * @typedef {object} RollRecord
 * @property {string} id            Deterministic: `${msgId}:r${roll}:t${term}:d${result}`, `${msgId}:tb:${target}:${seq}`, or `${msgId}:html:${n}`.
 * @property {string} msgId         ChatMessage id the record came from.
 * @property {number} dieIndex      Position of the die in a depth-first walk of the message's rolls.
 * @property {number} ts            message.timestamp (ms epoch).
 * @property {string} sessionKey    `YYYY-MM-DD` evening key (docs/PLAN.md §4.4).
 * @property {string|null} userId   message.author id, or the best guess (see userGuess).
 * @property {boolean} [userGuess]  True when userId was inferred rather than read from the message.
 * @property {string|null} actorId
 * @property {string|null} tokenId
 * @property {string|null} alias    speaker.alias
 * @property {number|null} natural  The die face, 1–20; null when unrecoverable (see valueHidden / discardUnknown).
 * @property {boolean} kept         False for the discarded die of 2d20kh/kl, a rerolled-away die, or a discarded reroll.
 * @property {string} formula       Die term formula, e.g. "1d20", "2d20kh", "2d20kl".
 * @property {number|null} total    roll.total of the roll the die belongs to.
 * @property {string} type          PF2e CheckType, "raw", or "flat-check" (from pf2-flat-check).
 * @property {string} source        "pf2e-check" | "raw" | "toolbelt" | "pf2-flat-check" | "reroll-html" | "reroll-enrich".
 * @property {string[]} domains     flags.pf2e.context.domains (empty for non-PF2e rolls; not persisted).
 * @property {string|null} [stat]   Derived statistic slug: "reflex", "stealth", "perception", "melee-strike", … (persisted).
 * @property {string|null} ident    flags.pf2e.context.identifier.
 * @property {string|null} action
 * @property {number|null} dc
 * @property {boolean|null} dcVisible
 * @property {string|null} outcome  "criticalSuccess" | "success" | "failure" | "criticalFailure" | null.
 * @property {string|null} unadjustedOutcome
 * @property {boolean} isReroll
 * @property {string} [rerollOf]    msgId of the original message (rerolls).
 * @property {string} [rerolledBy]  msgId of the reroll message (set on the original record).
 * @property {string} [rerollOutcome] "kept" | "discarded" — for the original die of a reroll.
 * @property {string} [resource]    "heroPoint" | "mythicPoint" | other reroll resource.
 * @property {string|null} [rollTwice] "keep-higher" | "keep-lower" | null.
 * @property {string|null} mode     flags.pf2e.context.messageMode: "roll" | "gmroll" | "blindroll" | "selfroll" | null.
 * @property {boolean} blind        message.blind
 * @property {boolean} whispered    message.whisper.length > 0
 * @property {boolean|null} inCombat  Live capture only; null on catch-up.
 * @property {boolean} [valueHidden]  pf2-flat-check with hideRollValue: natural is null.
 * @property {boolean} [discardUnknown] Reroll discard could not be parsed from HTML.
 */

/**
 * Plain-object shape of a ChatMessage as produced by `ChatMessage#toObject()`; the only input the normalizer accepts.
 * `rolls` entries may be JSON strings (as stored) or already-parsed objects.
 * @typedef {object} MessageData
 * @property {string} _id
 * @property {number} timestamp
 * @property {string|null} author
 * @property {{scene?: string|null, token?: string|null, actor?: string|null, alias?: string|null}} [speaker]
 * @property {boolean} [blind]
 * @property {string[]} [whisper]
 * @property {Array<string|object>} [rolls]
 * @property {Record<string, any>} [flags]
 * @property {string} [content]
 * @property {string} [flavor]
 */

/**
 * Context handed to the normalizer by live capture or catch-up.
 * @typedef {object} NormalizeContext
 * @property {(ts: number) => string} sessionKeyFor
 * @property {"create"|"update"|"backfill"} event
 * @property {string|null} [updaterUserId]   The user who made the update (live `updateChatMessage` only).
 * @property {boolean|null} [inCombat]
 * @property {(baseId: string) => RollRecord|undefined} [existing]
 * @property {boolean} [captureRawRolls]
 */

export {};
