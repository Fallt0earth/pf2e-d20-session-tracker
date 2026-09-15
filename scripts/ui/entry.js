// Entry points: a scene-control tool in the tokens group (v13 record-shaped controls, `onChange`).
import { getSetting, SETTINGS } from "../settings.js";

export function canOpen() {
  return game.user.isGM || getSetting(SETTINGS.playerAccess) !== "none";
}

export function registerEntryPoints(open) {
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokens = controls.tokens;
    if (!tokens?.tools) return;
    tokens.tools["pf2e-d20-tracker"] = {
      name: "pf2e-d20-tracker",
      title: "PF2E-D20.Controls.Open",
      icon: "fa-solid fa-dice-d20",
      order: 100,
      button: true,
      visible: canOpen(),
      onChange: () => open(),
    };
  });
}
