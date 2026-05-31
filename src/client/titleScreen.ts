import {
  Group,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  ConeGeometry,
  TorusGeometry,
  CylinderGeometry,
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
  updateArrow,
  spinBall,
  fx,
  P_COLORS,
  P_CHARGE,
} from "./balls";
import { makeSpacedText } from "./text3d";
import { playHitThud, playMenuTick, toggleMute, isMuted } from "./audio";

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

  // Mute toggle: 3D speaker icon, press [M]
  const iconMat = new MeshStandardMaterial({
    color: 0x33ff66,
    emissive: 0x114422,
    emissiveIntensity: 0.6,
    metalness: 0.3,
    roughness: 0.5,
  });
  const slashMat = new MeshStandardMaterial({
    color: 0xff3344,
    emissive: 0x551111,
    emissiveIntensity: 0.9,
    metalness: 0.2,
    roughness: 0.5,
  });
  const muteGroup = new Group();
  const speakerBody = new Mesh(new BoxGeometry(0.22, 0.34, 0.22), iconMat);
  speakerBody.position.x = -0.16;
  const speakerHorn = new Mesh(new ConeGeometry(0.34, 0.5, 24), iconMat);
  speakerHorn.rotation.z = Math.PI / 2; // flare opens toward +x
  speakerHorn.position.x = 0.05;
  muteGroup.add(speakerBody, speakerHorn);
  const waves = [0.2, 0.34].map((r) => {
    const w = new Mesh(new TorusGeometry(r, 0.03, 8, 20, Math.PI * 0.8), iconMat);
    w.rotation.z = -Math.PI * 0.4; // arc centered on +x → ")" facing right
    w.position.x = 0.42;
    muteGroup.add(w);
    return w;
  });
  const slash = new Mesh(new CylinderGeometry(0.04, 0.04, 1.0, 10), slashMat);
  slash.rotation.z = Math.PI / 4;
  slash.visible = false;
  muteGroup.add(slash);
  muteGroup.position.set(-4.7, -2.7, 3.5);
  muteGroup.scale.setScalar(0.95);
  scene.add(muteGroup);

  const hintMat = new MeshStandardMaterial({
    color: 0x888888,
    emissive: 0x222222,
    emissiveIntensity: 0.4,
    metalness: 0.2,
    roughness: 0.6,
  });
  const muteHint = makeSpacedText(
    "[M]",
    { font, size: 0.3, depth: 0.08, curveSegments: 4, bevelEnabled: false },
    hintMat,
    0.08,
    0.5,
  );
  muteHint.group.position.set(-4.7, -3.35, 3.5);
  scene.add(muteHint.group);

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
    muteGroup.visible = true;
    muteHint.group.visible = true;
    resetDemo();
  }

  function hide() {
    active = false;
    titleGroup.visible = false;
    for (const e of menuEntries) e.group.visible = false;
    muteGroup.visible = false;
    muteHint.group.visible = false;
  }

  function update(dt: number) {
    if (!active) return;
    t += dt;

    // Demo sim
    botTick(titleBalls[0], titleBalls[1], titleBots[0], dt);
    botTick(titleBalls[1], titleBalls[0], titleBots[1], dt);
    const hit = physicsStep(titleBalls, dt);
    if (hit) playHitThud(hit.closing);
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

      updateArrow(i, mesh.position, b.cx, b.cy, b.charging);
      spinBall(i, b.vx, b.vy, dt);
    }

    // Title text bob/sway
    titleGroup.position.x = Math.sin(t * 0.7) * 0.5;
    titleGroup.position.y = TITLE_BASE_Y + Math.sin(t * 1.8) * 0.2;
    titleGroup.rotation.z = Math.sin(t * 0.5) * 0.06;

    // Menu highlight — color/emissive only. Geometry stays put: scaling the
    // selected entry caused the cached glyph sprites to leave a stale render
    // of the leftmost letter (the red-first-letter glitch).
    for (let i = 0; i < menuEntries.length; i++) {
      const { mat } = menuEntries[i];
      const selected = i === selectedIdx;
      if (selected) {
        mat.color.setHex(0xff3355);
        mat.emissive.setHex(0xff3355);
        mat.emissiveIntensity = 1.0 + Math.sin(t * 6) * 0.4;
      } else {
        mat.color.setHex(0xcccccc);
        mat.emissive.setHex(0x222222);
        mat.emissiveIntensity = 0.4;
      }
    }

    // Mute icon state + idle wiggle
    const muted = isMuted();
    iconMat.color.setHex(muted ? 0x666666 : 0x33ff66);
    iconMat.emissive.setHex(muted ? 0x111111 : 0x114422);
    slash.visible = muted;
    for (const w of waves) w.visible = !muted;
    muteGroup.rotation.y = Math.sin(t * 1.2) * 0.3;
    muteGroup.position.y = -2.7 + Math.sin(t * 2.2) * 0.05;
  }

  function onKey(name: string | undefined): MenuChoice | null {
    if (!active) return null;
    if (name === "m") {
      toggleMute();
      return null;
    }
    if (name === "up" || name === "w") {
      selectedIdx =
        (selectedIdx + MENU_ITEMS.length - 1) % MENU_ITEMS.length;
      playMenuTick();
      return null;
    }
    if (name === "down" || name === "s") {
      selectedIdx = (selectedIdx + 1) % MENU_ITEMS.length;
      playMenuTick();
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
