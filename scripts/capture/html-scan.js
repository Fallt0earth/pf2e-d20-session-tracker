// @ts-check
// Reading numbers out of card HTML with regular expressions (no DOM under node). Message content is
// free text from a player's client, so the cost has to stay linear whatever it holds: the input is
// clipped, whitespace runs are collapsed, and every quantifier is bounded. Pure: no Foundry globals.

import { MAX_HTML_LENGTH } from "./sanitize.js";

const ATTRS = "[^<>]{0,400}";

/** Clip to MAX_HTML_LENGTH and collapse whitespace runs to one space. */
export function prepareHtml(html) {
  if (typeof html !== "string" || !html) return "";
  return (html.length > MAX_HTML_LENGTH ? html.slice(0, MAX_HTML_LENGTH) : html).replace(/\s+/g, " ");
}

/** Class names in a tag's attribute text (`class="a b c"`). */
export function classesOf(attrs) {
  const m = /\bclass ?= ?"([^"<>]{0,300})"/i.exec(attrs ?? "");
  return m ? m[1].split(" ").filter(Boolean) : [];
}

/**
 * Every `<tag …>number</tag>` of the given tag names, with the tag's class list.
 * @param {string} html   prepared HTML
 * @param {string[]} tags
 * @returns {Array<{ tag: string, classes: string[], value: number }>}
 */
export function numericElements(html, tags) {
  const re = new RegExp(`<(${tags.join("|")})\\b(${ATTRS})> ?(-?\\d{1,4}) ?</\\1 ?>`, "gi");
  const out = [];
  for (const m of html.matchAll(re)) out.push({ tag: m[1].toLowerCase(), classes: classesOf(m[2]), value: Number(m[3]) });
  return out;
}

/**
 * The first `<tag …>` carrying `className`: where it starts and where its content starts.
 * @returns {{ index: number, contentStart: number } | null}
 */
export function findOpenTag(html, tag, className) {
  const re = new RegExp(`<${tag}\\b(${ATTRS})>`, "gi");
  for (const m of html.matchAll(re)) {
    if (classesOf(m[1]).includes(className)) return { index: m.index ?? 0, contentStart: (m.index ?? 0) + m[0].length };
  }
  return null;
}

/**
 * Index of the `</tag>` that closes the element whose content starts at `from`, tracking nesting.
 * Falls back to the end of the string when tags are unbalanced.
 */
export function findCloseTag(html, tag, from) {
  const re = new RegExp(`</?${tag}\\b${ATTRS}>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") { depth--; if (depth === 0) return m.index; }
    else depth++;
  }
  return html.length;
}
