import {
  BALL_MAX_X,
  BALL_MAX_Y,
  BALL_MIN_X,
  BALL_MIN_Y,
  PORT,
  TICK_HZ,
  applyDir,
  applySpace,
  decodeServerMsg,
  encodeClientMsg,
  stepBallSolo,
  playerColor,
  type Ball,
  type BallSnap,
  type ClientMsg,
  type ControlServerMsg,
  type DirKey,
  type MatchStatus,
  type PlayerInfo,
  type Slot,
} from "../shared";
import {
  ballMats,
  ballMeshes,
  arrows,
  updateArrow,
  spinBall,
  fx,
  FLASH_DECAY,
  PUNCH_DECAY,
  PUNCH_MAX_SCALE,
  P_COLORS,
  P_CHARGE,
} from "./balls";
import { burstBlood, clearBlood } from "./particles";
import { playHitThud, tickChargeSound, playDeath, tickWallSound } from "./audio";
import { addShake } from "./scene";
function parseServerUrl(): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server" || a === "-s") return argv[++i] ?? "";
    if (a.startsWith("--server=")) return a.slice("--server=".length);
  }
  return process.env.SERVER_URL ?? `ws://localhost:${PORT}`;
}
export const SERVER_URL = parseServerUrl();

export type Roster = {
  champion: PlayerInfo | null;
  challenger: PlayerInfo | null;
  streak: number;
  queue: PlayerInfo[];
};

export type NetState = {
  mySlot: Slot | -1;
  myId: number;
  lastSnap: BallSnap[] | null;
  serverStatus: MatchStatus;
  winner: Slot | undefined;
  connected: boolean;
  endedAt: number;
  lastKey: string;
  roster: Roster | null;
};

export const netState: NetState = {
  mySlot: -1,
  myId: 0,
  lastSnap: null,
  serverStatus: "waiting",
  winner: undefined,
  connected: false,
  endedAt: 0,
  lastKey: "-",
  roster: null,
};

const FIXED_DT = 1 / TICK_HZ;
const TICK_MS = 1000 / TICK_HZ;
const INTERP_DELAY_MS = 30;
const SNAP_KEEP_MS = 500;
const CLOCK_DECAY_PER_SEC = 0.05;

let serverWallOffset = 0;
let offsetInitialized = false;

let localBall: Ball | null = null;
let physAccum = 0;
let displayErrX = 0;
let displayErrY = 0;
const DISPLAY_ERR_DECAY = 20;
const DISPLAY_ERR_MAX = 0.25;
const DISPLAY_ERR_SNAP = 1.0;

type SnapEntry = { t: number; balls: BallSnap[] };
const snapBuf: SnapEntry[] = [];

type PendingInput =
  | { seq: number; kind: "dir"; name: DirKey; shift: boolean }
  | { seq: number; kind: "space" };
const pendingInputs: PendingInput[] = [];
let nextSeq = 1;

let ws: WebSocket | null = null;
let connectStarted = false;
let myName = "PLAYER";

function snapToLocal(s: BallSnap): Ball {
  return {
    x: s.x,
    y: s.y,
    vx: s.vx,
    vy: s.vy,
    hp: s.hp,
    charging: s.charging,
    cx: s.cx,
    cy: s.cy,
  };
}

function applyPending(b: Ball, inp: PendingInput) {
  if (inp.kind === "dir") applyDir(b, inp.name, inp.shift);
  else applySpace(b);
}

function interpOpponent(slot: number, now: number): BallSnap | null {
  if (snapBuf.length === 0) return null;
  const target = now - INTERP_DELAY_MS;
  let a: SnapEntry | null = null;
  let b: SnapEntry | null = null;
  for (let i = snapBuf.length - 1; i >= 0; i--) {
    if (snapBuf[i].t <= target) {
      a = snapBuf[i];
      b = snapBuf[i + 1] ?? null;
      break;
    }
  }
  if (a && b) {
    const span = b.t - a.t;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (target - a.t) / span)) : 0;
    const sa = a.balls[slot];
    const sb = b.balls[slot];
    return {
      x: sa.x + (sb.x - sa.x) * alpha,
      y: sa.y + (sb.y - sa.y) * alpha,
      vx: sa.vx + (sb.vx - sa.vx) * alpha,
      vy: sa.vy + (sb.vy - sa.vy) * alpha,
      hp: sb.hp,
      charging: sb.charging,
      cx: sa.cx + (sb.cx - sa.cx) * alpha,
      cy: sa.cy + (sb.cy - sa.cy) * alpha,
    };
  }
  if (a && !b) {
    const sa = a.balls[slot];
    const dt = (target - a.t) / 1000;
    return {
      x: sa.x + sa.vx * dt,
      y: sa.y + sa.vy * dt,
      vx: sa.vx,
      vy: sa.vy,
      hp: sa.hp,
      charging: sa.charging,
      cx: sa.cx,
      cy: sa.cy,
    };
  }
  const sb = snapBuf[0].balls[slot];
  return { ...sb };
}

export function canAct(): boolean {
  return (
    netState.mySlot >= 0 &&
    localBall !== null &&
    netState.serverStatus === "playing" &&
    localBall.hp > 0
  );
}

function triggerExplosion() {
  if (!netState.lastSnap || netState.winner === undefined) return;
  const loser: Slot = netState.winner === 0 ? 1 : 0;
  const lp = netState.lastSnap[loser];
  burstBlood(lp.x, lp.y);
  playDeath();
  addShake(1);
  ballMeshes[loser].visible = false;
  arrows[loser].visible = false;
}

function resetFxLocal() {
  for (const f of fx) {
    f.flash = 0;
    f.punch = 0;
  }
  for (const m of ballMeshes) m.scale.setScalar(1);
}

export function connect(name: string) {
  myName = name;
  if (connectStarted) return;
  connectStarted = true;
  doConnect();
}

function sendJoin() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ t: "join", name: myName }));
  }
}

function doConnect() {
  ws = new WebSocket(SERVER_URL);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    netState.connected = true;
    sendJoin();
  };
  ws.onclose = () => {
    netState.connected = false;
    setTimeout(doConnect, 1000);
  };
  ws.onerror = () => {
    // close handler will retry
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      handleControl(ev.data);
      return;
    }
    if (!(ev.data instanceof ArrayBuffer)) return;
    const msg = decodeServerMsg(ev.data);
    if (!msg) return;
    if (msg.t === "slot") {
      netState.mySlot = msg.n;
    } else if (msg.t === "snap") {
      const prev = netState.serverStatus;
      netState.lastSnap = msg.balls;
      netState.serverStatus = msg.status;
      netState.winner = msg.winner;
      const wall = performance.now();
      const serverMs = msg.tick * TICK_MS;
      const sample = serverMs - wall;
      if (!offsetInitialized || prev !== netState.serverStatus) {
        serverWallOffset = sample;
        offsetInitialized = true;
      } else if (sample > serverWallOffset) {
        serverWallOffset = sample;
      } else {
        serverWallOffset += (sample - serverWallOffset) * CLOCK_DECAY_PER_SEC;
      }
      if (prev !== netState.serverStatus) snapBuf.length = 0;
      snapBuf.push({ t: serverMs, balls: msg.balls });
      const cutoff = serverMs - SNAP_KEEP_MS;
      while (snapBuf.length > 2 && snapBuf[0].t < cutoff) snapBuf.shift();
      if (prev !== "ended" && netState.serverStatus === "ended") {
        netState.endedAt = Date.now();
        triggerExplosion();
      }
      if (prev === "ended" && netState.serverStatus !== "ended") {
        netState.endedAt = 0;
        ballMeshes[0].visible = true;
        ballMeshes[1].visible = true;
        clearBlood();
        resetFxLocal();
      }
      if (netState.mySlot >= 0) {
        const slot = netState.mySlot as Slot;
        const mySnap = msg.balls[slot]!;
        const ack = msg.ack[slot] ?? 0;
        while (pendingInputs.length > 0 && pendingInputs[0].seq <= ack) {
          pendingInputs.shift();
        }
        if (!localBall || prev !== netState.serverStatus) {
          localBall = snapToLocal(mySnap);
          physAccum = 0;
          displayErrX = 0;
          displayErrY = 0;
        } else {
          const renderX = localBall.x + displayErrX;
          const renderY = localBall.y + displayErrY;
          localBall.x = mySnap.x;
          localBall.y = mySnap.y;
          localBall.vx = mySnap.vx;
          localBall.vy = mySnap.vy;
          localBall.hp = mySnap.hp;
          localBall.charging = mySnap.charging;
          localBall.cx = mySnap.cx;
          localBall.cy = mySnap.cy;
          for (const inp of pendingInputs) applyPending(localBall, inp);
          physAccum = 0;
          let ex = renderX - localBall.x;
          let ey = renderY - localBall.y;
          const mag = Math.hypot(ex, ey);
          if (mag > DISPLAY_ERR_SNAP) {
            ex = 0;
            ey = 0;
          } else if (mag > DISPLAY_ERR_MAX) {
            const s = DISPLAY_ERR_MAX / mag;
            ex *= s;
            ey *= s;
          }
          displayErrX = ex;
          displayErrY = ey;
        }
      }
    } else if (msg.t === "hit") {
      playHitThud(msg.closing);
      if (msg.dmg > 0) {
        fx[msg.victim].flash = 1;
        fx[msg.attacker].punch = Math.max(
          fx[msg.attacker].punch,
          Math.min(1, msg.dmg / 12),
        );
        addShake(Math.min(0.6, 0.12 + msg.dmg * 0.03));
      }
    }
  };
}

function handleControl(raw: string) {
  let msg: ControlServerMsg;
  try {
    msg = JSON.parse(raw) as ControlServerMsg;
  } catch {
    return;
  }
  if (msg.t === "ident") {
    netState.myId = msg.id;
  } else if (msg.t === "roster") {
    netState.roster = {
      champion: msg.champion,
      challenger: msg.challenger,
      streak: msg.streak,
      queue: msg.queue,
    };
  }
}

function sendMsg(m: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(encodeClientMsg(m));
}

export function sendDir(name: DirKey, shift: boolean) {
  const seq = nextSeq++;
  if (canAct()) applyDir(localBall!, name, shift);
  pendingInputs.push({ seq, kind: "dir", name, shift });
  sendMsg({ t: "dir", seq, name, shift });
}

export function sendSpace() {
  const seq = nextSeq++;
  if (canAct()) applySpace(localBall!);
  pendingInputs.push({ seq, kind: "space" });
  sendMsg({ t: "space", seq });
}

export function updateServerScene(dt: number) {
  if (!netState.lastSnap) return;

  if (
    localBall &&
    netState.serverStatus === "playing" &&
    localBall.hp > 0
  ) {
    physAccum += dt;
    while (physAccum >= FIXED_DT) {
      stepBallSolo(localBall, FIXED_DT);
      physAccum -= FIXED_DT;
    }
  }

  if (displayErrX !== 0 || displayErrY !== 0) {
    const decay = Math.exp(-dt * DISPLAY_ERR_DECAY);
    displayErrX *= decay;
    displayErrY *= decay;
    if (Math.abs(displayErrX) < 1e-4) displayErrX = 0;
    if (Math.abs(displayErrY) < 1e-4) displayErrY = 0;
  }

  const serverNow = performance.now() + serverWallOffset;
  for (let i = 0; i < 2; i++) {
    const useLocal = i === netState.mySlot && localBall !== null;
    const interp = useLocal ? null : interpOpponent(i, serverNow);
    const snap = interp ?? netState.lastSnap[i];
    let sx = useLocal ? localBall!.x + displayErrX : snap.x;
    let sy = useLocal ? localBall!.y + displayErrY : snap.y;
    if (sx < BALL_MIN_X) sx = BALL_MIN_X;
    else if (sx > BALL_MAX_X) sx = BALL_MAX_X;
    if (sy < BALL_MIN_Y) sy = BALL_MIN_Y;
    else if (sy > BALL_MAX_Y) sy = BALL_MAX_Y;
    const sCharging = useLocal ? localBall!.charging : snap.charging;
    const sCx = useLocal ? localBall!.cx : snap.cx;
    const sCy = useLocal ? localBall!.cy : snap.cy;

    const mesh = ballMeshes[i];
    mesh.position.set(sx, sy, 0);
    const f = fx[i];
    if (f.flash > 0) f.flash = Math.max(0, f.flash - dt / FLASH_DECAY);
    if (f.punch > 0) f.punch = Math.max(0, f.punch - dt / PUNCH_DECAY);
    // Ball color is derived from the fighter's username (slot 0 = champion,
    // slot 1 = challenger); fall back to the default slot colors if unknown.
    const fighter = i === 0 ? netState.roster?.champion : netState.roster?.challenger;
    const col = fighter ? playerColor(fighter.name) : null;
    const base = sCharging
      ? (col ? col.charge : P_CHARGE[i])
      : (col ? col.base : P_COLORS[i]);
    const mat = ballMats[i];
    mat.color.setHex(base);
    mat.emissiveIntensity = f.flash * 3;
    mesh.scale.setScalar(1 + f.punch * PUNCH_MAX_SCALE);

    updateArrow(i, mesh.position, sCx, sCy, sCharging && mesh.visible);
    tickChargeSound(`net:${i}`, sCharging, sCx, sCy);

    // Wall SFX from physics values (raw, unclamped): predicted self for zero
    // latency, raw snapshot for the opponent.
    const wb = useLocal ? localBall! : netState.lastSnap[i];
    if (mesh.visible) tickWallSound(`net:${i}`, wb.x, wb.y, wb.vx, wb.vy);
    spinBall(i, wb.vx, wb.vy, dt);
  }
}
