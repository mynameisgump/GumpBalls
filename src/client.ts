#!/usr/bin/env bun
import {
  createCliRenderer,
  FrameBufferRenderable,
  RGBA,
  TextRenderable,
  type KeyEvent,
} from "@opentui/core";
import { ThreeCliRenderer, TextureUtils } from "@opentui/three";
import {
  Scene,
  PerspectiveCamera,
  Mesh,
  SphereGeometry,
  BoxGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  InstancedMesh,
  Matrix4,
  AmbientLight,
  DirectionalLight,
  Vector3,
  ArrowHelper,
  RepeatWrapping,
} from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  positionLocal,
  normalLocal,
  uniform,
  time,
  mx_noise_float,
} from "three/tsl";
import {
  BALL_MIN_Y,
  BALL_R,
  CEIL_Y,
  FLOOR_Y,
  LEFT_X,
  MAX_HP,
  PORT,
  RIGHT_X,
  ROOM_H,
  ROOM_W,
  WALL_T,
  type BallSnap,
  type ClientMsg,
  type DirKey,
  type ServerMsg,
  type Slot,
} from "./shared";

function parseServerUrl(): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server" || a === "-s") return argv[++i] ?? "";
    if (a.startsWith("--server=")) return a.slice("--server=".length);
  }
  return process.env.SERVER_URL ?? `ws://localhost:${PORT}`;
}
const SERVER_URL = parseServerUrl();

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 60,
  useKittyKeyboard: { events: true, disambiguate: true, alternateKeys: true },
});
renderer.start();

let W = renderer.terminalWidth;
let H = renderer.terminalHeight;

const fb = new FrameBufferRenderable(renderer, {
  id: "fb",
  width: W,
  height: H,
  zIndex: 1,
});
renderer.root.add(fb);

const engine = new ThreeCliRenderer(renderer, {
  width: W,
  height: H,
  backgroundColor: RGBA.fromValues(0, 0, 0, 0),
});
await engine.init();

const scene = new Scene();
const camera = new PerspectiveCamera(45, engine.aspectRatio, 0.1, 100);
camera.position.set(0, 0, 18);
camera.lookAt(0, 0, 0);
engine.setActiveCamera(camera);
scene.add(camera);

scene.add(new AmbientLight(0xffffff, 0.4));
const sun = new DirectionalLight(0xffffff, 1.0);
sun.position.set(5, 8, 10);
scene.add(sun);

const WALL_TEX = new URL("../public/wall/", import.meta.url).pathname;
const [diffTex, normalTex, roughTex, metalTex] = await Promise.all([
  TextureUtils.fromFile(`${WALL_TEX}metal_grate_rusty_diff_1k.jpg`),
  TextureUtils.fromFile(`${WALL_TEX}metal_grate_rusty_nor_gl_1k.jpg`),
  TextureUtils.fromFile(`${WALL_TEX}metal_grate_rusty_rough_1k.jpg`),
  TextureUtils.fromFile(`${WALL_TEX}metal_grate_rusty_metal_1k.jpg`),
]);
for (const tex of [diffTex, normalTex, roughTex, metalTex]) {
  if (!tex) continue;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(1.5, 1.5);
  tex.needsUpdate = true;
}
const wallMat = new MeshStandardMaterial({
  map: diffTex ?? undefined,
  normalMap: normalTex ?? undefined,
  roughnessMap: roughTex ?? undefined,
  metalnessMap: metalTex ?? undefined,
  metalness: 0.8,
  roughness: 0.5,
});
const floor = new Mesh(new BoxGeometry(ROOM_W, WALL_T, 2), wallMat);
floor.position.y = FLOOR_Y;
const ceil = new Mesh(new BoxGeometry(ROOM_W, WALL_T, 2), wallMat);
ceil.position.y = CEIL_Y;
const leftWall = new Mesh(new BoxGeometry(WALL_T, ROOM_H, 2), wallMat);
leftWall.position.x = LEFT_X;
const rightWall = new Mesh(new BoxGeometry(WALL_T, ROOM_H, 2), wallMat);
rightWall.position.x = RIGHT_X;
const backWall = new Mesh(new BoxGeometry(ROOM_W, ROOM_H, WALL_T), wallMat);
backWall.position.z = -1 - WALL_T / 2;
scene.add(floor, ceil, leftWall, rightWall, backWall);

const P_COLORS = [0xff5533, 0x33ff66];
const P_CHARGE = [0x33aaff, 0xffcc33];

const BALL_TEX = new URL("../public/ball/", import.meta.url).pathname;
const ballDiff = await TextureUtils.fromFile(
  `${BALL_TEX}Skin_05_basecolor.jpg`,
);

const noiseFreq = uniform(6.0);
const noiseSpeed = uniform(1.5);
const noiseIntensity = uniform(0.06);

function makeBallMat(color: number) {
  const mat = new MeshStandardNodeMaterial({
    map: ballDiff ?? undefined,
    metalness: 0.2,
    roughness: 0.5,
  });
  mat.color.setHex(color);
  mat.emissive.setHex(0xffffff);
  mat.emissiveIntensity = 0;
  const n = mx_noise_float(
    positionLocal.mul(noiseFreq).add(time.mul(noiseSpeed)),
  );
  mat.positionNode = positionLocal.add(normalLocal.mul(n).mul(noiseIntensity));
  return mat;
}

const ballMats = P_COLORS.map((c) => makeBallMat(c));
const ballMeshes = ballMats.map((m) => {
  const mesh = new Mesh(new SphereGeometry(BALL_R, 32, 24), m);
  mesh.position.set(0, BALL_MIN_Y, 0);
  scene.add(mesh);
  return mesh;
});

const PARTICLE_COUNT = 140;
const particleGeo = new SphereGeometry(0.09, 6, 4);
const particleMat = new MeshBasicMaterial({ color: 0xaa0011 });
const bloodMesh = new InstancedMesh(particleGeo, particleMat, PARTICLE_COUNT);
bloodMesh.frustumCulled = false;
bloodMesh.visible = false;
scene.add(bloodMesh);

type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
};
const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  life: 0,
}));
const tmpMat = new Matrix4();
const zeroMat = new Matrix4().makeScale(0, 0, 0);

function burstBlood(x: number, y: number) {
  for (const p of particles) {
    p.x = x;
    p.y = y;
    p.z = 0;
    const speed = 2 + Math.random() * 7;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    p.vx = Math.cos(theta) * Math.sin(phi) * speed;
    p.vy = Math.sin(theta) * Math.sin(phi) * speed + 3;
    p.vz = Math.cos(phi) * speed * 0.4;
    p.life = 1.4 + Math.random() * 1.2;
  }
  bloodMesh.visible = true;
  bloodMesh.count = PARTICLE_COUNT;
}

function clearBlood() {
  for (const p of particles) p.life = 0;
  for (let i = 0; i < PARTICLE_COUNT; i++) bloodMesh.setMatrixAt(i, zeroMat);
  bloodMesh.instanceMatrix.needsUpdate = true;
  bloodMesh.visible = false;
}

function updateParticles(dt: number) {
  if (!bloodMesh.visible) return;
  let anyAlive = false;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = particles[i];
    if (p.life <= 0) {
      bloodMesh.setMatrixAt(i, zeroMat);
      continue;
    }
    p.life -= dt;
    p.vy += -14 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    const floor = BALL_MIN_Y - BALL_R;
    if (p.y < floor) {
      p.y = floor;
      p.vy *= -0.3;
      p.vx *= 0.6;
      p.vz *= 0.6;
    }
    if (p.life > 0) {
      tmpMat.makeTranslation(p.x, p.y, p.z);
      bloodMesh.setMatrixAt(i, tmpMat);
      anyAlive = true;
    } else {
      bloodMesh.setMatrixAt(i, zeroMat);
    }
  }
  bloodMesh.instanceMatrix.needsUpdate = true;
  if (!anyAlive) bloodMesh.visible = false;
}

const arrows = [0, 1].map((i) => {
  const a = new ArrowHelper(
    new Vector3(1, 0, 0),
    new Vector3(),
    0.001,
    P_CHARGE[i],
    0.4,
    0.25,
  );
  a.visible = false;
  scene.add(a);
  return a;
});

const hud = new TextRenderable(renderer, {
  id: "hud",
  content: "",
  zIndex: 10,
  position: "absolute",
  left: 1,
  top: 0,
  fg: RGBA.fromValues(1, 1, 1, 1),
});
renderer.root.add(hud);

const banner = new TextRenderable(renderer, {
  id: "banner",
  content: "",
  zIndex: 11,
  position: "absolute",
  left: 1,
  top: 2,
  fg: RGBA.fromValues(1, 1, 1, 1),
});
renderer.root.add(banner);

let mySlot: Slot | -1 = -1;
let lastSnap: BallSnap[] | null = null;
let serverStatus: "waiting" | "playing" | "ended" = "waiting";
let winner: Slot | undefined;
let connected = false;
let lastKey = "-";
let endedAt = 0;
const RESET_MS = 5000;

function hpBar(hp: number, width = 20) {
  const filled = Math.round((hp / MAX_HP) * width);
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
}

function setBanner() {
  if (!connected) {
    banner.content = `connecting to ${SERVER_URL}...`;
    return;
  }
  if (mySlot === -1) {
    banner.content = "spectator (match full)";
    return;
  }
  if (serverStatus === "waiting") {
    banner.content = `you are P${mySlot + 1}. waiting for opponent...`;
  } else if (serverStatus === "playing") {
    banner.content = `you are P${mySlot + 1}. fight!`;
  } else if (serverStatus === "ended") {
    const youWon = winner === mySlot;
    const remain = Math.max(0, RESET_MS - (Date.now() - endedAt));
    const secs = Math.ceil(remain / 1000);
    banner.content = `P${(winner ?? 0) + 1} wins! ${youWon ? "you win :)" : "you lose :("}  next match in ${secs}s`;
  }
}

const fx = [
  { flash: 0, punch: 0 },
  { flash: 0, punch: 0 },
];
const FLASH_DECAY = 0.07;
const PUNCH_DECAY = 0.09;
const PUNCH_MAX_SCALE = 0.55;

function resetFx() {
  for (const f of fx) {
    f.flash = 0;
    f.punch = 0;
  }
  for (const m of ballMeshes) m.scale.setScalar(1);
}

function triggerExplosion() {
  if (!lastSnap || winner === undefined) return;
  const loser: Slot = winner === 0 ? 1 : 0;
  const lp = lastSnap[loser];
  burstBlood(lp.x, lp.y);
  ballMeshes[loser].visible = false;
  arrows[loser].visible = false;
}

let ws: WebSocket | null = null;
function connect() {
  ws = new WebSocket(SERVER_URL);
  ws.onopen = () => {
    connected = true;
    setBanner();
  };
  ws.onclose = () => {
    connected = false;
    setBanner();
    setTimeout(connect, 1000);
  };
  ws.onerror = () => {
    // close handler will retry
  };
  ws.onmessage = (ev) => {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.t === "slot") {
      mySlot = msg.n;
      setBanner();
    } else if (msg.t === "snap") {
      const prev = serverStatus;
      lastSnap = msg.balls;
      serverStatus = msg.status;
      winner = msg.winner;
      if (prev !== "ended" && serverStatus === "ended") {
        endedAt = Date.now();
        triggerExplosion();
      }
      if (prev === "ended" && serverStatus !== "ended") {
        endedAt = 0;
        ballMeshes[0].visible = true;
        ballMeshes[1].visible = true;
        clearBlood();
        resetFx();
      }
      setBanner();
    } else if (msg.t === "hit") {
      fx[msg.victim].flash = 1;
      fx[msg.attacker].punch = Math.max(
        fx[msg.attacker].punch,
        Math.min(1, msg.dmg / 12),
      );
    } else if (msg.t === "end") {
      if (serverStatus !== "ended") {
        winner = msg.winner;
        serverStatus = "ended";
        endedAt = Date.now();
        triggerExplosion();
      }
      setBanner();
    }
  };
}
connect();

function sendMsg(m: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

const DIR_NAMES: Record<string, DirKey> = {
  left: "left",
  right: "right",
  up: "up",
  down: "down",
  a: "a",
  d: "d",
  w: "w",
  s: "s",
  q: "q",
  e: "e",
  z: "z",
  c: "c",
};

renderer.keyInput.on("keypress", (k: KeyEvent) => {
  if (k.eventType === "repeat") return;
  lastKey = `${k.name ?? "?"}${k.shift ? "+S" : ""}${k.ctrl ? "+C" : ""}`;

  if (k.ctrl && (k.name === "c" || k.name === "q")) {
    renderer.destroy();
    process.exit(0);
  }

  if (k.name === "space") {
    sendMsg({ t: "space" });
    return;
  }

  const name = k.name ? DIR_NAMES[k.name] : undefined;
  if (name) sendMsg({ t: "dir", name, shift: !!k.shift });
});

renderer.on("resize", (w: number, h: number) => {
  W = w;
  H = h;
  fb.frameBuffer.resize(w, h);
  engine.setSize(w, h);
  camera.aspect = engine.aspectRatio;
  camera.updateProjectionMatrix();
});

function updateScene(dt: number) {
  if (!lastSnap) return;
  for (let i = 0; i < 2; i++) {
    const s = lastSnap[i];
    const mesh = ballMeshes[i];
    mesh.position.set(s.x, s.y, 0);
    const f = fx[i];
    if (f.flash > 0) f.flash = Math.max(0, f.flash - dt / FLASH_DECAY);
    if (f.punch > 0) f.punch = Math.max(0, f.punch - dt / PUNCH_DECAY);
    const base = s.charging ? P_CHARGE[i] : P_COLORS[i];
    const mat = ballMats[i];
    mat.color.setHex(base);
    mat.emissiveIntensity = f.flash * 3;
    mesh.scale.setScalar(1 + f.punch * PUNCH_MAX_SCALE);

    const a = arrows[i];
    const len = Math.hypot(s.cx, s.cy);
    if (s.charging && len > 1e-3 && mesh.visible) {
      a.visible = true;
      a.position.copy(mesh.position);
      a.setDirection(new Vector3(s.cx, s.cy, 0).normalize());
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

  const p1 = lastSnap[0];
  const p2 = lastSnap[1];
  const tag = mySlot >= 0 ? `P${mySlot + 1}` : "spectator";
  hud.content =
    `${tag}  ` +
    `P1 ${hpBar(p1.hp)} ${p1.hp.toFixed(0).padStart(3)}  ` +
    `P2 ${hpBar(p2.hp)} ${p2.hp.toFixed(0).padStart(3)}  ` +
    `last:${lastKey}`;
}

renderer.setFrameCallback(async (deltaMs: number) => {
  const dt = deltaMs / 1000;
  updateScene(dt);
  updateParticles(dt);
  if (serverStatus === "ended") setBanner();
  await engine.drawScene(scene, fb.frameBuffer, deltaMs);
});
