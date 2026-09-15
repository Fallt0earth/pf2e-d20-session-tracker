// Anonymize a fixture dump from macros/dump-fixtures.js (or dev/e2e/make-fixtures.mjs) before committing.
//   node dev/anonymize-fixtures.mjs <in.json> [out.json]
// Replaces user and actor names with stable pseudonyms (User1…, Actor1…) everywhere they occur (users,
// actors, speaker.alias, flavor/content text) and strips `content` down to the parts the normalizer
// reads: the pf2-flat-check card and reroll blocks. Ids are kept (they are random and carry no identity).

import { readFileSync, writeFileSync } from "node:fs";

const [, , inFile, outFile = inFile.replace(/\.json$/, ".anon.json")] = process.argv;
if (!inFile) { console.error("usage: node dev/anonymize-fixtures.mjs <in.json> [out.json]"); process.exit(1); }

const dump = JSON.parse(readFileSync(inFile, "utf8"));
const names = new Map();
const pseudo = (name, prefix, list) => {
  if (!name) return name;
  if (!names.has(name)) names.set(name, `${prefix}${list.size + 1}`);
  return names.get(name);
};
const userNames = new Map(), actorNames = new Map();
for (const u of dump.users ?? []) { const p = pseudo(u.name, "User", userNames); userNames.set(u.name, p); u.name = p; }
for (const a of dump.actors ?? []) { const p = pseudo(a.name, "Actor", actorNames); actorNames.set(a.name, p); a.name = p; }

const replaceNames = (text) => {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const [real, fake] of [...userNames, ...actorNames].sort((x, y) => y[0].length - x[0].length)) {
    if (real.length >= 3) out = out.split(real).join(fake);
  }
  return out;
};

const keepContent = (msg) => {
  const c = msg.content;
  if (typeof c !== "string") return c;
  if (msg.flags?.["pf2-flat-check"]) return replaceNames(c);
  if (/\breroll-(?:discard|second)\b/.test(c)) return replaceNames(c);
  return "";
};

for (const m of dump.messages ?? []) {
  if (m.speaker?.alias) m.speaker.alias = replaceNames(m.speaker.alias);
  m.flavor = replaceNames(m.flavor);
  m.content = keepContent(m);
}
writeFileSync(outFile, JSON.stringify(dump, null, 1));
console.log(`anonymized ${dump.messages?.length ?? 0} messages → ${outFile} (${userNames.size} users, ${actorNames.size} actors renamed)`);
