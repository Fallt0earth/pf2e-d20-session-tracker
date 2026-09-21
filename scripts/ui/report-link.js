// Optional, GM-initiated: a ONE-LINE chat message with an "Open" button that opens the report popup for
// whoever clicks it. The report itself never lands in the chat log.
import { MODULE_ID } from "../constants.js";
import { sessionLabel, isSessionKey } from "../sessions/bucket.js";

export async function postReportLink(sessionKey) {
  if (!game.user.isGM || !isSessionKey(sessionKey)) return null;
  const esc = foundry.utils.escapeHTML;
  const text = game.i18n.format("PF2E-D20.Report.LinkText", { label: esc(sessionLabel(sessionKey)) });
  const open = esc(game.i18n.localize("PF2E-D20.Report.Open"));
  return ChatMessage.create({
    content: `<div class="pf2e-d20-report-link"><i class="fa-solid fa-dice-d20"></i> <span>${text}</span> <button type="button" data-d20-report="${esc(sessionKey)}">${open}</button></div>`,
    speaker: { alias: game.i18n.localize("PF2E-D20.Title") },
    flags: { [MODULE_ID]: { reportLink: true, sessionKey } },
  });
}

/**
 * Wire the Open button on rendered chat messages (v13 hook: renderChatMessageHTML). Only on the GM's
 * own link messages, and only for a well-formed key: a look-alike button in someone's chat text stays inert.
 */
export function registerReportLinks(openReport) {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message?.flags?.[MODULE_ID]?.reportLink !== true || message.author?.isGM !== true) return;
    const button = html?.querySelector?.("[data-d20-report]");
    if (!button || !isSessionKey(button.dataset.d20Report)) return;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openReport(button.dataset.d20Report);
    });
  });
}
