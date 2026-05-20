import {
  Group,
  MeshStandardMaterial,
  Vector3,
} from "three";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import {
  CEIL_Y,
  makeBall,
  physicsStep,
  type Ball,
} from "../shared";
import { botTick, makeBotState, resetBotState } from "../bot";
import { scene } from "./scene";
import {
  ballMats,
  ballMeshes,
  arrows,
  fx,
  P_COLORS,
  P_CHARGE,
} from "./balls";
import { makeSpacedText } from "./text3d";

export type MenuChoice = "single" | "multi" | "quit";

const MENU_ITEMS: { label: string; choice: MenuChoice }[] = [
  { label: "SINGLEPLAYER", choice: "single" },
  { label: "MULTIPLAYER", choice: "multi" },
  { label: "QUIT", choice: "quit" },
];

const TITLE_BASE_Y = CEIL_Y + 1.1;

export function createTitleScreen(font: Font) {
  // 3D "GUMP BALLS" title — per-letter spacing for readability
  const titleMat = new MeshStandardMaterial({
    color: 0xff3355,
    emissive: 0x551122,
    emissiveIntensity: 0.6,
    metalness: 0.4,
    roughness: 0.4,
  });
  const titleText = makeSpacedText(
    "GUMP BALLS",
    {
      font,
      size: 0.9,
      depth: 0.22,
      curveSegments: 6,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.03,
      bevelSegments: 2,
    },
    titleMat,
    0.18,
    0.6,
  );
  const titleGroup = titleText.group;
  titleGroup.position.set(0, TITLE_BASE_Y, 0);
  scene.add(titleGroup);

  // 3D menu items, stacked vertically front of arena
  type MenuEntry = {
    group: Group;
    mat: MeshStandardMaterial;
    baseY: number;
  };
  const menuEntries: MenuEntry[] = MENU_ITEMS.map((item, i) => {
    const mat = new MeshStandardMaterial({
      color: 0xcccccc,
      emissive: 0x000000,
      emissiveIntensity: 0,
      metalness: 0.3,
      roughness: 0.4,
    });
    const text = makeSpacedText(
      item.label,
      {
        font,
        size: 0.5,
        depth: 0.14,
        curveSegments: 5,
        bevelEnabled: true,
        bevelThickness: 0.025,
        bevelSize: 0.02,
        bevelSegments: 2,
      },
      mat,
      0.12,
      0.55,
    );
    const baseY = 1.6 - i * 1.3;
    text.group.position.set(0, baseY, 3.5);
    scene.add(text.group);
    return { group: text.group, mat, baseY };
  });

  // Demo battle: 2 bots fighting in background
  let titleBalls: Ball[] = [makeBall(0), makeBall(1)];
  const titleBots = [makeBotState(), makeBotState()];

  let selectedIdx = 0;
  let active = true;
  let t = 0;

  function resetDemo() {
    titleBalls = [makeBall(0), makeBall(1)];
    titleBots.forEach(resetBotState);
  }

  function show() {
    active = true;
    titleGroup.visible = true;
    for (const e of menuEntries) e.group.visible = true;
    resetDemo();
  }

  function hide() {
    active = false;
    titleGroup.visible = false;
    for (const e of menuEntries) e.group.visible = false;
  }

  function update(dt: number) {
    if (!active) return;
    t += dt;

    // Demo sim
    botTick(titleBalls[0], titleBalls[1], titleBots[0], dt);
    botTick(titleBalls[1], titleBalls[0], titleBots[1], dt);
    physicsStep(titleBalls, dt);
    if (titleBalls[0].hp <= 0 || titleBalls[1].hp <= 0) resetDemo();

    // Drive ball meshes from demo sim
    for (let i = 0; i < 2; i++) {
      const b = titleBalls[i]!;
      const mesh = ballMeshes[i];
      mesh.visible = true;
      mesh.position.set(b.x, b.y, 0);
      mesh.scale.setScalar(1);

      const f = fx[i];
      f.flash = 0;
      f.punch = 0;
      const base = b.charging ? P_CHARGE[i] : P_COLORS[i];
      const mat = ballMats[i];
      mat.color.setHex(base);
      mat.emissiveIntensity = 0;

      const a = arrows[i];
      const len = Math.hypot(b.cx, b.cy);
      if (b.charging && len > 1e-3) {
        a.visible = true;
        a.position.copy(mesh.position);
        a.setDirection(new Vector3(b.cx, b.cy, 0).normalize());
        const visLen = Math.min(len * 0.18, 5);
        a.setLength(
          visLen,
          Math.min(0.5, visLen * 0.25),
          Math.min(0.3, visLen * 0.18),
        );
      } else {
        a.visible = false;
      }
    }

    // Title text bob/sway
    titleGroup.position.x = Math.sin(t * 0.7) * 0.5;
    titleGroup.position.y = TITLE_BASE_Y + Math.sin(t * 1.8) * 0.2;
    titleGroup.rotation.z = Math.sin(t * 0.5) * 0.06;

    // Menu highlight + bob
    for (let i = 0; i < menuEntries.length; i++) {
      const { group, mat, baseY } = menuEntries[i];
      const selected = i === selectedIdx;
      if (selected) {
        mat.color.setHex(0xff3355);
        mat.emissive.setHex(0xff3355);
        mat.emissiveIntensity = 1.4;
        group.scale.setScalar(1.15 + Math.sin(t * 6) * 0.04);
        group.position.y = baseY + Math.sin(t * 4) * 0.08;
      } else {
        mat.color.setHex(0xcccccc);
        mat.emissive.setHex(0x222222);
        mat.emissiveIntensity = 0.4;
        group.scale.setScalar(1);
        group.position.y = baseY;
      }
    }
  }

  function onKey(name: string | undefined): MenuChoice | null {
    if (!active) return null;
    if (name === "up" || name === "w") {
      selectedIdx =
        (selectedIdx + MENU_ITEMS.length - 1) % MENU_ITEMS.length;
      return null;
    }
    if (name === "down" || name === "s") {
      selectedIdx = (selectedIdx + 1) % MENU_ITEMS.length;
      return null;
    }
    if (name === "return" || name === "space") {
      return MENU_ITEMS[selectedIdx]!.choice;
    }
    return null;
  }

  function isActive() {
    return active;
  }

  return { show, hide, update, onKey, isActive };
}
