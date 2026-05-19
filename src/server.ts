#!/usr/bin/env bun
import type { ServerWebSocket } from "bun";
import {
  PORT,
  SNAP_HZ,
  TICK_HZ,
  applyDir,
  applySpace,
  decodeClientMsg,
  encodeServerMsg,
  makeBall,
  physicsStep,
  type Ball,
  type BallSnap,
  type DirKey,
  type ServerMsg,
  type Slot,
} from "./shared";

type WSData = { slot: Slot | -1 };

const botSlots = new Set<Slot>();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--bots") {
      botSlots.add(0);
      botSlots.add(1);
    } else if (a === "--bot" || a === "-b") {
      const n = parseInt(argv[++i] ?? "", 10);
      if (n === 0 || n === 1) botSlots.add(n as Slot);
    } else if (a.startsWith("--bot=")) {
      const n = parseInt(a.slice("--bot=".length), 10);
      if (n === 0 || n === 1) botSlots.add(n as Slot);
    }
  }
}

const balls: Ball[] = [makeBall(0), makeBall(1)];
const sockets: (ServerWebSocket<WSData> | null)[] = [null, null];
const spectators = new Set<ServerWebSocket<WSData>>();
let status: "waiting" | "playing" | "ended" = "waiting";
let winner: Slot | undefined;
let hitstopUntil = 0;
let simTick = 0;
const lastAckSeq: [number, number] = [0, 0];

type BotState = {
  mode: "wander" | "charge";
  t: number;
  chargeDur: number;
  inputCd: number;
};
const botStates = new Map<Slot, BotState>();
for (const s of botSlots) {
  botStates.set(s, { mode: "wander", t: 0, chargeDur: 0, inputCd: 0 });
}

function slotFilled(s: Slot): boolean {
  return sockets[s] !== null || botSlots.has(s);
}
function bothFilled(): boolean {
  return slotFilled(0) && slotFilled(1);
}

function aimDir(dx: number, dy: number): DirKey {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const diag = ax > 0.4 * ay && ay > 0.4 * ax;
  if (diag) {
    if (dx >= 0 && dy >= 0) return "e";
    if (dx < 0 && dy >= 0) return "q";
    if (dx >= 0 && dy < 0) return "c";
    return "z";
  }
  if (ax > ay) return dx > 0 ? "d" : "a";
  return dy > 0 ? "w" : "s";
}

function botTick(slot: Slot, dt: number) {
  if (status !== "playing") return;
  const me = balls[slot]!;
  const opp = balls[1 - slot]!;
  if (me.hp <= 0) return;
  const st = botStates.get(slot)!;
  st.t += dt;
  st.inputCd -= dt;
  const dx = opp.x - me.x;
  const dy = opp.y - me.y;

  if (st.mode === "wander") {
    if (st.t > 0.5 + Math.random() * 0.8) {
      applySpace(me);
      st.mode = "charge";
      st.t = 0;
      st.chargeDur = 0.5 + Math.random() * 0.8;
      st.inputCd = 0.05;
      return;
    }
    if (st.inputCd <= 0) {
      const r = Math.random();
      if (r < 0.35) applyDir(me, "w", Math.random() < 0.5);
      else if (r < 0.5) {
        const diag: DirKey = dx > 0 ? "e" : "q";
        applyDir(me, diag, Math.random() < 0.5);
      } else if (Math.abs(dx) > 0.6) {
        applyDir(me, dx > 0 ? "d" : "a", false);
      }
      st.inputCd = 0.12 + Math.random() * 0.18;
    }
  } else {
    if (st.inputCd <= 0) {
      let dir: DirKey;
      if (Math.random() < 0.2) {
        const choices: DirKey[] = ["q", "w", "e", "a", "d", "z", "c"];
        dir = choices[Math.floor(Math.random() * choices.length)]!;
      } else {
        const jx = (Math.random() - 0.5) * 3;
        const jy = (Math.random() - 0.5) * 3 + 2.5;
        dir = aimDir(dx + jx, dy + jy);
      }
      applyDir(me, dir, Math.random() < 0.75);
      st.inputCd = 0.1 + Math.random() * 0.1;
    }
    if (st.t >= st.chargeDur) {
      applySpace(me);
      st.mode = "wander";
      st.t = 0;
      st.inputCd = 0.2;
    }
  }
}

function snapshot(): BallSnap[] {
  return balls.map((b) => ({
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    hp: b.hp,
    charging: b.charging,
    cx: b.cx,
    cy: b.cy,
  }));
}

function broadcast(msg: ServerMsg) {
  const buf = encodeServerMsg(msg);
  for (const ws of sockets) ws?.send(buf);
  for (const ws of spectators) ws.send(buf);
}

function send(ws: ServerWebSocket<WSData>, msg: ServerMsg) {
  ws.send(encodeServerMsg(msg));
}

function resetMatch() {
  balls[0] = makeBall(0);
  balls[1] = makeBall(1);
  winner = undefined;
  hitstopUntil = 0;
  lastAckSeq[0] = 0;
  lastAckSeq[1] = 0;
  for (const [, st] of botStates) {
    st.mode = "wander";
    st.t = 0;
    st.chargeDur = 0;
    st.inputCd = 0;
  }
  status = bothFilled() ? "playing" : "waiting";
}

function tick(dt: number) {
  for (const s of botSlots) botTick(s, dt);
  const hit = physicsStep(balls, dt);
  if (hit) {
    broadcast({ t: "hit", ...hit });
    hitstopUntil = Date.now() + Math.min(20 + hit.dmg * 4, 120);
  }
  if (status === "playing") {
    const dead0 = balls[0].hp <= 0;
    const dead1 = balls[1].hp <= 0;
    if (dead0 || dead1) {
      status = "ended";
      winner = dead0 && dead1 ? 0 : dead0 ? 1 : 0;
      setTimeout(() => {
        if (status !== "ended") return;
        if (bothFilled()) {
          resetMatch();
          status = "playing";
          console.log("auto-reset: new match");
        } else {
          status = "waiting";
        }
      }, 5000);
    }
  }
}

const dt = 1 / TICK_HZ;
let snapAccum = 0;
const snapInterval = 1 / SNAP_HZ;

setInterval(() => {
  if ((status === "playing" || status === "ended") && Date.now() >= hitstopUntil) {
    tick(dt);
    simTick++;
  }
  snapAccum += dt;
  if (snapAccum >= snapInterval) {
    snapAccum = 0;
    broadcast({
      t: "snap",
      tick: simTick,
      ack: [lastAckSeq[0], lastAckSeq[1]],
      balls: snapshot(),
      status,
      winner,
    });
  }
}, 1000 / TICK_HZ);

const hostname = "0.0.0.0";

const server = Bun.serve<WSData>({
  hostname,
  port: PORT,
  fetch(req, srv) {
    if (srv.upgrade(req, { data: { slot: -1 } })) return;
    return new Response("term_phys_ball server", { status: 200 });
  },
  websocket: {
    open(ws) {
      let assigned: Slot | -1 = -1;
      if (!sockets[0] && !botSlots.has(0)) {
        sockets[0] = ws;
        assigned = 0;
      } else if (!sockets[1] && !botSlots.has(1)) {
        sockets[1] = ws;
        assigned = 1;
      } else {
        spectators.add(ws);
      }
      ws.data.slot = assigned;
      send(ws, { t: "slot", n: assigned });
      console.log(`open: slot=${assigned}`);
      if (bothFilled() && status !== "playing") {
        resetMatch();
        status = "playing";
      }
    },
    message(ws, raw) {
      if (typeof raw === "string") return;
      const u8 = raw as Uint8Array;
      const ab = u8.buffer.slice(
        u8.byteOffset,
        u8.byteOffset + u8.byteLength,
      ) as ArrayBuffer;
      const msg = decodeClientMsg(ab);
      if (!msg) return;
      const rawSlot = ws.data.slot;
      if (rawSlot < 0) return;
      const slot = rawSlot as Slot;
      const b = balls[slot]!;
      if (status === "waiting") return;
      if (status === "ended" && slot !== winner) return;
      if (b.hp <= 0) return;
      if (msg.t === "dir") {
        applyDir(b, msg.name, msg.shift);
        if (msg.seq > lastAckSeq[slot]) lastAckSeq[slot] = msg.seq;
      } else if (msg.t === "space") {
        applySpace(b);
        if (msg.seq > lastAckSeq[slot]) lastAckSeq[slot] = msg.seq;
      }
    },
    close(ws) {
      const slot = ws.data.slot;
      if (slot >= 0) {
        sockets[slot] = null;
        console.log(`close: slot=${slot}`);
        status = "waiting";
        resetMatch();
      } else {
        spectators.delete(ws);
      }
    },
  },
});

console.log(`listening on ws://${hostname}:${server.port}`);
if (botSlots.size > 0) {
  console.log(`bots: ${[...botSlots].map((s) => `P${s + 1}`).join(", ")}`);
}
if (bothFilled()) {
  resetMatch();
  status = "playing";
}
