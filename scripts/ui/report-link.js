// Optional, GM-initiated: a ONE-LINE chat message with an "Open" button that opens the report popup for
// whoever clicks it. The report itself never lands in the chat log.
import { MODULE_ID } from "../constants.js";
import { sessionLabel } from "../sessions/bucket.js";

export async function postReportLink(sessionKey) {
  if (!game.user.isGM) return null;
  const label = foundry.utils.escapeHTML(sessionLabel(sessionKey));
  const text = game.i18n.format("PF2E-D20.Report.LinkText", { label });
  const open = game.i18n.localize("PF2E-D20.Report.Open");
  return ChatMessage.create({
    content: `<div class="pf2e-d20-report-link"><i class="fa-solid fa-dice-d20"></i> <span>${text}</span> <button type="button" data-d20-report="${sessionKey}">${open}</button></div>`,
    speaker: { alias: game.i18n.localize("PF2E-D20.Title") },
    flags: { [MODULE_ID]: { reportLink: true, sessionKey } },
  });
}

/** Wire the Open button on rendered chat messages (v13 hook: renderChatMessageHTML). */
export function registerReportLinks(openReport) {
  Hooks.on("renderChatMessageHTML", (_message, html) => {
    const button = html?.querySelector?.("[data-d20-report]");
    if (!button) return;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openReport(button.dataset.d20Report);
    });
  });
}
