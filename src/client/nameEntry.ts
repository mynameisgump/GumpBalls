import {
  Group,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
} from "three";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { scene } from "./scene";
import { makeSpacedText } from "./text3d";
import { playMenuTick } from "./audio";

const MAX_LEN = 16;
const PROMPT_OPTS = {
  size: 0.5,
  depth: 0.12,
  curveSegments: 5,
  bevelEnabled: true,
  bevelThickness: 0.02,
  bevelSize: 0.018,
  bevelSegments: 2,
};
const VALUE_OPTS = {
  size: 0.8,
  depth: 0.22,
  curveSegments: 6,
  bevelEnabled: true,
  bevelThickness: 0.04,
  bevelSize: 0.03,
  bevelSegments: 2,
};
const HINT_OPTS = {
  size: 0.28,
  depth: 0.08,
  curveSegments: 4,
  bevelEnabled: false,
};

// Letters/digits arrive as single-char key names; everything else is ignored.
function charFor(name: string | undefined, shift: boolean): string | null {
  if (!name) return null;
  if (name === "space") return " ";
  if (/^[a-z0-9]$/.test(name)) return shift ? name.toUpperCase() : name;
  if (/^[A-Z]$/.test(name)) return name;
  return null;
}

function disposeGroup(g: Group | null) {
  if (!g) return;
  g.traverse((o) => {
    if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose?.();
  });
  g.parent?.remove(g);
}

export type NameKeyResult = { submit: string } | null;

export function createNameEntry(font: Font) {
  const root = new Group();
  root.position.set(0, 0.9, 6);
  root.visible = false;
  scene.add(root);

  const promptMat = new MeshStandardMaterial({
    color: 0xff3355,
    emissive: 0x551122,
    emissiveIntensity: 0.7,
    metalness: 0.4,
    roughness: 0.4,
  });
  const valueMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x33ff66,
    emissiveIntensity: 0.6,
    metalness: 0.3,
    roughness: 0.45,
  });
  const hintMat = new MeshStandardMaterial({
    color: 0x888888,
    emissive: 0x222222,
    emissiveIntensity: 0.4,
    metalness: 0.2,
    roughness: 0.6,
  });

  const prompt = makeSpacedText("ENTER YOUR NAME", { font, ...PROMPT_OPTS }, promptMat, 0.12, 0.55);
  prompt.group.position.y = 1.1;
  root.add(prompt.group);

  const hint = makeSpacedText("[ENTER] TO FIGHT", { font, ...HINT_OPTS }, hintMat, 0.08, 0.5);
  hint.group.position.y = -1.0;
  root.add(hint.group);

  let valueGroup: Group | null = null;
  let value = "";
  let active = false;
  let t = 0;
  let cursorOn = true;

  function rebuildValue() {
    disposeGroup(valueGroup);
    const shown = value + (cursorOn ? "_" : " ");
    const text = makeSpacedText(shown, { font, ...VALUE_OPTS }, valueMat, 0.14, 0.55);
    text.group.position.y = 0;
    valueGroup = text.group;
    root.add(valueGroup);
  }

  function show() {
    active = true;
    root.visible = true;
    value = "";
    t = 0;
    cursorOn = true;
    rebuildValue();
  }

  function hide() {
    active = false;
    root.visible = false;
  }

  function update(dt: number) {
    if (!active) return;
    t += dt;
    // Blink the caret ~1.5Hz; only rebuild geometry when the glyph flips.
    const on = Math.floor(t * 3) % 2 === 0;
    if (on !== cursorOn) {
      cursorOn = on;
      rebuildValue();
    }
    promptMat.emissiveIntensity = 0.7 + Math.sin(t * 4) * 0.25;
    root.position.x = Math.sin(t * 0.8) * 0.15;
  }

  function onKey(name: string | undefined, shift: boolean): NameKeyResult {
    if (!active) return null;
    if (name === "return") {
      const final = value.trim();
      return { submit: final.length > 0 ? final : "PLAYER" };
    }
    if (name === "backspace" || name === "delete") {
      if (value.length > 0) {
        value = value.slice(0, -1);
        playMenuTick();
        rebuildValue();
      }
      return null;
    }
    const ch = charFor(name, shift);
    if (ch && value.length < MAX_LEN) {
      value += ch;
      playMenuTick();
      rebuildValue();
    }
    return null;
  }

  return { show, hide, update, onKey, isActive: () => active };
}

export type NameEntry = ReturnType<typeof createNameEntry>;
