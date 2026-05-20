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
  type ServerMsg,
  type Slot,
} from "./shared";
import { botTick, makeBotState, resetBotState, type BotState } from "./bot";

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

const botStates = new Map<Slot, BotState>();
for (const s of botSlots) botStates.set(s, makeBotState());

function slotFilled(s: Slot): boolean {
  return sockets[s] !== null || botSlots.has(s);
}
function bothFilled(): boolean {
  return slotFilled(0) && slotFilled(1);
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
  for (const [, st] of botStates) resetBotState(st);
  status = bothFilled() ? "playing" : "waiting";
}

function tick(dt: number) {
  if (status === "playing") {
    for (const s of botSlots) {
      botTick(balls[s]!, balls[1 - s]!, botStates.get(s)!, dt);
    }
  }
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
