// Draws two made-up sample images for the examples: a logo and a landscape "photo".
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "examples", "assets");
mkdirSync(out, { recursive: true });

// Logo: night alley disc with a cream and mint finder mark
{
  const c = createCanvas(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#1E1033";
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#FFF2DE";
  g.lineWidth = 18;
  g.strokeRect(72, 72, 112, 112);
  g.fillStyle = "#86E3BE";
  g.fillRect(104, 104, 48, 48);
  writeFileSync(join(out, "sample-logo.png"), c.toBuffer("image/png"));
}

// Landscape: warm dawn cream, soft moon, pale lilac and mint hills
{
  const c = createCanvas(640, 640);
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, 0, 640);
  bg.addColorStop(0, "#F3E8F4");
  bg.addColorStop(1, "#FBF4EA");
  g.fillStyle = bg;
  g.fillRect(0, 0, 640, 640);
  g.fillStyle = "#FFE6A6";
  g.beginPath();
  g.arc(470, 190, 80, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#D8CDEA";
  g.beginPath();
  g.moveTo(0, 470);
  g.quadraticCurveTo(160, 330, 320, 450);
  g.quadraticCurveTo(480, 540, 640, 400);
  g.lineTo(640, 640);
  g.lineTo(0, 640);
  g.fill();
  g.fillStyle = "#D8F5E8";
  g.beginPath();
  g.moveTo(0, 540);
  g.quadraticCurveTo(200, 450, 380, 540);
  g.quadraticCurveTo(520, 610, 640, 520);
  g.lineTo(640, 640);
  g.lineTo(0, 640);
  g.fill();
  writeFileSync(join(out, "sample-photo.png"), c.toBuffer("image/png"));
}
console.log("wrote examples/assets/sample-logo.png and sample-photo.png");
