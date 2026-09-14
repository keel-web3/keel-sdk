import { defineTemplate } from "@keel/sdk/module";

function Scene() {
  let timer: ReturnType<typeof setInterval> | undefined;
  return <canvas width={256} height={256} data-keel-thumbnail data-keel-thumbnail-motion="12" ref={canvas => {
    if (!canvas) { clearInterval(timer); return; }
    thumbnail.init();
    queueMicrotask(() => {
      if (!canvas.isConnected) return;
      const context = canvas.getContext("2d")!;
      let step = 0;
      const draw = () => {
        context.fillStyle = "#101329";
        context.fillRect(0, 0, 256, 256);
        context.fillStyle = "#baff70";
        context.beginPath();
        context.arc(128 + Math.sin(step / 12 * Math.PI * 2) * 64, 128, 32, 0, Math.PI * 2);
        context.fill();
      };
      draw();
      thumbnail.snapshot();
      timer = setInterval(() => {
        step += 1; draw();
        if (step === 24) { clearInterval(timer); thumbnail.stop(); }
      }, 1000 / 12);
    });
  }} />;
}

export default defineTemplate({
  name: "background-preview-example",
  title: "Background capture",
  target: "@keel/eth/sepolia",
}, <Scene />);
