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
  type ControlClientMsg,
  type ControlServerMsg,
  type MatchStatus,
  type PlayerInfo,
  type ServerMsg,
  type Slot,
} from "./shared";
import { botTick, makeBotState, resetBotState, type BotState } from "./bot";

type WSData = { slot: Slot | -1; playerId: number };

// One entry per tournament participant. Bots are players with no socket and a
// bot brain; humans have a socket and no brain. Champion holds slot 0, the
// active challenger holds slot 1, everyone else waits in `queue`.
type Player = {
  id: number;
  name: string;
  ws: ServerWebSocket<WSData> | null;
  bot: BotState | null;
};

// How long the "3..2..1..GO!" overlay runs before the fight unfreezes. Must
// stay >= the client countdown length so nobody moves before "GO!".
const STARTING_MS = 3300;
const ENDED_MS = 5000;

let nextPlayerId = 1;
let champion: Player | null = null;
let challenger: Player | null = null;
const queue: Player[] = [];
let streak = 0; // champion's current win streak

const balls: Ball[] = [makeBall(0), makeBall(1)];
let status: MatchStatus = "waiting";
let winner: Slot | undefined;
let hitstopUntil = 0;
let startingUntil = 0;
let endedAt = 0;
let simTick = 0;
const lastAckSeq: [number, number] = [0, 0];

// Every connected human socket — the broadcast audience (seated, queued, or
// still picking a name). Bots are not in here.
const humans = new Set<ServerWebSocket<WSData>>();

// --- bot seeding ----------------------------------------------------------
let botCount = 0;
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--bots") botCount = 2;
    else if (a.startsWith("--bots=")) botCount = parseInt(a.slice(7), 10) || 0;
    else if (a === "--bot" || a === "-b") botCount += 1;
    else if (a.startsWith("--bot=")) botCount += parseInt(a.slice(6), 10) || 0;
  }
}

function now(): number {
  return Date.now();
}

// --- messaging ------------------------------------------------------------
function info(p: Player | null): PlayerInfo | null {
  return p ? { id: p.id, name: p.name } : null;
}

function rosterMsg(): ControlServerMsg {
  return {
    t: "roster",
    champion: info(champion),
    challenger: info(challenger),
    streak,
    queue: queue.map((p) => ({ id: p.id, name: p.name })),
  };
}

function sendControl(ws: ServerWebSocket<WSData>, msg: ControlServerMsg) {
  ws.send(JSON.stringify(msg));
}

function broadcastRoster() {
  const s = JSON.stringify(rosterMsg());
  for (const ws of humans) ws.send(s);
}

function broadcast(msg: ServerMsg) {
  const buf = encodeServerMsg(msg);
  for (const ws of humans) ws.send(buf);
}

// Push the given slot to a player's socket so the client can predict/act.
function setSlot(p: Player | null, slot: Slot | -1) {
  if (!p || !p.ws) return;
  p.ws.data.slot = slot;
  p.ws.send(encodeServerMsg({ t: "slot", n: slot }));
}

// --- match lifecycle ------------------------------------------------------
function resetMatch() {
  balls[0] = makeBall(0);
  balls[1] = makeBall(1);
  winner = undefined;
  hitstopUntil = 0;
  lastAckSeq[0] = 0;
  lastAckSeq[1] = 0;
  if (champion?.bot) resetBotState(champion.bot);
  if (challenger?.bot) resetBotState(challenger.bot);
}

function beginStarting() {
  resetMatch();
  status = "starting";
  startingUntil = now() + STARTING_MS;
}

// Fill empty seats from the queue, then bring the bout to the right state.
// `interrupted` is set when a seated fighter just vanished mid-fight, forcing
// the current bout to be scrapped. Never disturbs an in-flight bout or the
// post-KO win screen otherwise — that is owned by the tick loop / resolveMatch.
function reconcile(interrupted = false) {
  if (interrupted) {
    resetMatch();
    status = "waiting";
  }
  if (status === "ended") {
    broadcastRoster();
    return;
  }
  if (!champion && queue.length) {
    champion = queue.shift()!;
    streak = 0;
    setSlot(champion, 0);
  }
  if (champion && !challenger && queue.length) {
    challenger = queue.shift()!;
    setSlot(challenger, 1);
  }
  if (champion && challenger) {
    if (status !== "playing" && status !== "starting") beginStarting();
  } else {
    status = "waiting";
  }
  broadcastRoster();
}

// Normal end-of-bout flow (called ENDED_MS after a KO): winner keeps the
// throne, loser drops to the back of the line, next challenger steps up.
function resolveMatch() {
  const oldChamp = champion;
  const oldChall = challenger;
  const winP = winner === 1 ? oldChall : oldChamp;
  const loseP = winner === 1 ? oldChamp : oldChall;

  champion = winP;
  streak = winner === 1 ? 1 : streak + 1;
  challenger = null;
  setSlot(champion, 0);
  if (loseP) {
    setSlot(loseP, -1);
    queue.push(loseP);
  }

  if (champion && queue.length) {
    challenger = queue.shift()!;
    setSlot(challenger, 1);
  }

  if (champion && challenger) beginStarting();
  else status = "waiting";
  broadcastRoster();
}

function tick(dt: number) {
  if (status === "playing") {
    if (champion?.bot) botTick(balls[0]!, balls[1]!, champion.bot, dt);
    if (challenger?.bot) botTick(balls[1]!, balls[0]!, challenger.bot, dt);
  }
  const hit = physicsStep(balls, dt);
  if (hit) {
    broadcast({ t: "hit", ...hit });
    if (hit.dmg > 0) hitstopUntil = now() + Math.min(20 + hit.dmg * 4, 120);
  }
  if (status === "playing") {
    const dead0 = balls[0].hp <= 0;
    const dead1 = balls[1].hp <= 0;
    if (dead0 || dead1) {
      status = "ended";
      winner = dead0 && dead1 ? 0 : dead0 ? 1 : 0;
      endedAt = now();
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

const dt = 1 / TICK_HZ;
let snapAccum = 0;
const snapInterval = 1 / SNAP_HZ;

setInterval(() => {
  if (status === "starting" && now() >= startingUntil) {
    status = "playing";
    hitstopUntil = 0;
  }
  if (status === "ended" && now() - endedAt > ENDED_MS) {
    resolveMatch();
  }
  if ((status === "playing" || status === "ended") && now() >= hitstopUntil) {
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

// --- connection handling --------------------------------------------------
function sanitizeName(raw: string): string {
  const n = raw.replace(/\s+/g, " ").trim().slice(0, 16);
  return n.length > 0 ? n : "PLAYER";
}

function handleJoin(ws: ServerWebSocket<WSData>, rawName: string) {
  if (ws.data.playerId !== 0) return; // already joined
  const p: Player = {
    id: nextPlayerId++,
    name: sanitizeName(rawName),
    ws,
    bot: null,
  };
  ws.data.playerId = p.id;
  queue.push(p);
  sendControl(ws, { t: "ident", id: p.id });
  console.log(`join: ${p.name} (#${p.id})`);
  reconcile();
}

function detach(ws: ServerWebSocket<WSData>) {
  humans.delete(ws);
  const id = ws.data.playerId;
  if (id === 0) return; // never joined the tournament

  let interrupted = false;
  if (champion?.ws === ws) {
    // King left: promote the standing challenger so the bout makes sense.
    champion = challenger;
    challenger = null;
    streak = 0;
    setSlot(champion, 0);
    interrupted = status === "playing" || status === "starting";
  } else if (challenger?.ws === ws) {
    challenger = null;
    interrupted = status === "playing" || status === "starting";
  } else {
    const i = queue.findIndex((p) => p.ws === ws);
    if (i >= 0) queue.splice(i, 1);
  }
  console.log(`close: #${id}`);
  reconcile(interrupted);
}

const hostname = "0.0.0.0";

const server = Bun.serve<WSData>({
  hostname,
  port: PORT,
  fetch(req, srv) {
    if (srv.upgrade(req, { data: { slot: -1, playerId: 0 } })) return;
    return new Response("gump balls server", { status: 200 });
  },
  websocket: {
    open(ws) {
      ws.data.slot = -1;
      ws.data.playerId = 0;
      humans.add(ws);
      ws.send(encodeServerMsg({ t: "slot", n: -1 }));
      sendControl(ws, rosterMsg());
    },
    message(ws, raw) {
      if (typeof raw === "string") {
        let msg: ControlClientMsg | null = null;
        try {
          msg = JSON.parse(raw) as ControlClientMsg;
        } catch {
          return;
        }
        if (msg && msg.t === "join") handleJoin(ws, msg.name);
        return;
      }
      const u8 = raw as Uint8Array;
      const ab = u8.buffer.slice(
        u8.byteOffset,
        u8.byteOffset + u8.byteLength,
      ) as ArrayBuffer;
      const msg = decodeClientMsg(ab);
      if (!msg) return;
      const rawSlot = ws.data.slot;
      if (rawSlot < 0) return;
      if (status !== "playing") return;
      const slot = rawSlot as Slot;
      const b = balls[slot]!;
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
      detach(ws);
    },
  },
});

// Seed bot players into the queue so the arena is never dead.
for (let i = 0; i < botCount; i++) {
  queue.push({
    id: nextPlayerId++,
    name: `CPU ${i + 1}`,
    ws: null,
    bot: makeBotState(),
  });
}
reconcile();

console.log(`listening on ws://${hostname}:${server.port}`);
if (botCount > 0) console.log(`bots: ${botCount}`);
