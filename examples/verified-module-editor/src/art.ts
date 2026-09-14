import { defineDocument, defineModule, getGlobals } from "@keel/sdk/module";
import "./state";

// Completion after thumbnail. comes from the verified module source.
// Completion after state. comes from state.ts through generated namespace types.
const state = getGlobals("src/state.ts");

function capture() {
  state.captures += 1;
  thumbnail.snapshot(state.label);
}

export default defineModule("editor-example", {
  target: "@keel/eth/sepolia",
  extends: [],
  document: defineDocument({
    title: "KEEL module editor example",
    render({ root }) {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 400;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#10202f";
      context.fillRect(0, 0, 640, 400);
      context.fillStyle = "#76f2bf";
      context.beginPath();
      context.arc(320, 185, 90, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "white";
      context.font = "24px sans-serif";
      context.textAlign = "center";
      context.fillText("Imported. Typed. Ready to capture.", 320, 330);
      const button = document.createElement("button");
      button.textContent = "Capture thumbnail";
      button.onclick = capture;
      const dates = solarDates(2026, { includeLunar: true });
      const info = document.createElement("p");
      info.textContent = `Unverified module ran: year ${dates.year}, lunar ${dates.includeLunar}`;
      // Explicit global path receives the same inferred signature.
      KEEL_solarDates(2026);
      root.append(canvas, document.createElement("br"), button, info);
      thumbnail.init();
    },
  }),
});
