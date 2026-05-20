import {
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Box3,
} from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
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

export type MenuChoice = "start" | "quit";

const MENU_ITEMS: { label: string; choice: MenuChoice }[] = [
  { label: "START", choice: "start" },
  { label: "QUIT", choice: "quit" },
];

const TITLE_BASE_Y = CEIL_Y + 1.4;

export function createTitleScreen(font: Font) {
  // 3D "GUMP BALLS" title mesh
  const titleGeo = new TextGeometry("GUMP BALLS", {
    font,
    size: 1.2,
    depth: 0.3,
    curveSegments: 6,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  titleGeo.computeBoundingBox();
  const tbb = titleGeo.boundingBox as Box3;
  const titleCx = -(tbb.max.x + tbb.min.x) / 2;
  const titleMat = new MeshStandardMaterial({
    color: 0xff3355,
    emissive: 0x551122,
    emissiveIntensity: 0.6,
    metalness: 0.4,
    roughness: 0.4,
  });
  const titleMesh = new Mesh(titleGeo, titleMat);
  titleMesh.position.set(titleCx, TITLE_BASE_Y, 0);
  scene.add(titleMesh);

  // 3D menu items, stacked vertically front of arena
  const menuMeshes = MENU_ITEMS.map((item, i) => {
    const geo = new TextGeometry(item.label, {
      font,
      size: 0.7,
      depth: 0.18,
      curveSegments: 5,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.025,
      bevelSegments: 2,
    });
    geo.computeBoundingBox();
    const bb = geo.boundingBox as Box3;
    const cx = -(bb.max.x + bb.min.x) / 2;
    const mat = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x000000,
      emissiveIntensity: 0,
      metalness: 0.3,
      roughness: 0.4,
    });
    const mesh = new Mesh(geo, mat);
    const baseY = 1.2 - i * 1.6;
    mesh.position.set(cx, baseY, 3.5);
    mesh.userData.baseY = baseY;
    mesh.userData.baseX = cx;
    scene.add(mesh);
    return { mesh, mat };
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
    titleMesh.visible = true;
    for (const { mesh } of menuMeshes) mesh.visible = true;
    resetDemo();
  }

  function hide() {
    active = false;
    titleMesh.visible = false;
    for (const { mesh } of menuMeshes) mesh.visible = false;
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
    titleMesh.position.x = titleCx + Math.sin(t * 0.7) * 0.6;
    titleMesh.position.y = TITLE_BASE_Y + Math.sin(t * 1.8) * 0.25;
    titleMesh.rotation.z = Math.sin(t * 0.5) * 0.06;

    // Menu highlight + bob
    for (let i = 0; i < menuMeshes.length; i++) {
      const { mesh, mat } = menuMeshes[i];
      const selected = i === selectedIdx;
      if (selected) {
        mat.color.setHex(0xff3355);
        mat.emissive.setHex(0xff3355);
        mat.emissiveIntensity = 1.2;
        mesh.scale.setScalar(1.15 + Math.sin(t * 6) * 0.04);
        mesh.position.y =
          (mesh.userData.baseY as number) + Math.sin(t * 4) * 0.08;
      } else {
        mat.color.setHex(0xcccccc);
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        mesh.scale.setScalar(1);
        mesh.position.y = mesh.userData.baseY as number;
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
