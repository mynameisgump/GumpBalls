#!/usr/bin/env bun
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

const PEER_TIMEOUT_MS = 5000;

type Peer = {
  addr: string;
  port: number;
  slot: Slot | -1;
  lastSeen: number;
  lastAckSeq: number;
};

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
const peers = new Map<string, Peer>();
const slotPeer: (Peer | null)[] = [null, null];
let status: "waiting" | "playing" | "ended" = "waiting";
let winner: Slot | undefined;
let hitstopUntil = 0;
let simTick = 0;

const botStates = new Map<Slot, BotState>();
for (const s of botSlots) botStates.set(s, makeBotState());

function peerKey(addr: string, port: number): string {
  return `${addr}:${port}`;
}

function slotFilled(s: Slot): boolean {
  return slotPeer[s] !== null || botSlots.has(s);
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

function resetMatch() {
  balls[0] = makeBall(0);
  balls[1] = makeBall(1);
  winner = undefined;
  hitstopUntil = 0;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sock: any = null;

function send(p: Peer, msg: ServerMsg) {
  if (!sock) return;
  sock.send(new Uint8Array(encodeServerMsg(msg)), p.port, p.addr);
}

function broadcast(msg: ServerMsg) {
  if (!sock || peers.size === 0) return;
  const buf = new Uint8Array(encodeServerMsg(msg));
  for (const p of peers.values()) {
    sock.send(buf, p.port, p.addr);
  }
}

function reapStalePeers(now: number) {
  let freed = false;
  for (const [key, p] of peers) {
    if (now - p.lastSeen > PEER_TIMEOUT_MS) {
      peers.delete(key);
      if (p.slot >= 0) {
        slotPeer[p.slot] = null;
        freed = true;
        console.log(`reap: slot=${p.slot} ${p.addr}:${p.port}`);
      } else {
        console.log(`reap: spectator ${p.addr}:${p.port}`);
      }
    }
  }
  if (freed) {
    status = "waiting";
    resetMatch();
  }
}

function assignSlot(p: Peer) {
  if (p.slot >= 0) return;
  if (!slotPeer[0] && !botSlots.has(0)) {
    p.slot = 0;
    slotPeer[0] = p;
  } else if (!slotPeer[1] && !botSlots.has(1)) {
    p.slot = 1;
    slotPeer[1] = p;
  } else {
    p.slot = -1;
  }
  send(p, { t: "slot", n: p.slot });
  console.log(`hello: slot=${p.slot} ${p.addr}:${p.port}`);
  if (bothFilled() && status !== "playing") {
    resetMatch();
    status = "playing";
  }
}

const dt = 1 / TICK_HZ;
let snapAccum = 0;
const snapInterval = 1 / SNAP_HZ;

setInterval(() => {
  const now = Date.now();
  reapStalePeers(now);
  if ((status === "playing" || status === "ended") && now >= hitstopUntil) {
    tick(dt);
    simTick++;
  }
  snapAccum += dt;
  if (snapAccum >= snapInterval) {
    snapAccum = 0;
    const ack0 = slotPeer[0]?.lastAckSeq ?? 0;
    const ack1 = slotPeer[1]?.lastAckSeq ?? 0;
    broadcast({
      t: "snap",
      tick: simTick,
      ack: [ack0, ack1],
      balls: snapshot(),
      status,
      winner,
    });
  }
}, 1000 / TICK_HZ);

const hostname = "0.0.0.0";

sock = await Bun.udpSocket({
  port: PORT,
  hostname,
  socket: {
    data(_s: unknown, buf: Buffer, port: number, addr: string) {
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
      const msg = decodeClientMsg(ab);
      if (!msg) return;
      const key = peerKey(addr, port);
      let p = peers.get(key);
      const now = Date.now();
      if (!p) {
        p = { addr, port, slot: -1, lastSeen: now, lastAckSeq: 0 };
        peers.set(key, p);
      }
      p.lastSeen = now;

      if (msg.t === "hello") {
        assignSlot(p);
        return;
      }
      if (msg.t === "inputs") {
        if (p.slot < 0) return;
        if (status === "waiting") return;
        if (status === "ended" && p.slot !== winner) return;
        const slot = p.slot as Slot;
        const b = balls[slot]!;
        if (b.hp <= 0) return;
        const sorted = msg.items.slice().sort((a, c) => a.seq - c.seq);
        for (const it of sorted) {
          if (it.seq <= p.lastAckSeq) continue;
          if (it.kind === "dir") applyDir(b, it.name, it.shift);
          else applySpace(b);
          p.lastAckSeq = it.seq;
        }
      }
    },
  },
});

console.log(`listening on udp://${hostname}:${sock.port}`);
if (botSlots.size > 0) {
  console.log(`bots: ${[...botSlots].map((s) => `P${s + 1}`).join(", ")}`);
}
if (bothFilled()) {
  resetMatch();
  status = "playing";
}
