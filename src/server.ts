#!/usr/bin/env bun
import type { ServerWebSocket } from "bun";
import {
  BALL_MAX_X,
  BALL_MAX_Y,
  BALL_MIN_X,
  BALL_MIN_Y,
  BALL_R,
  BURST_SCALE,
  CHARGE_STEP,
  DMG_K,
  DMG_THRESHOLD,
  GRAVITY,
  HORIZ_FRICTION,
  MAX_HP,
  PORT,
  SHIFT_MULT,
  SNAP_HZ,
  TICK_HZ,
  type BallSnap,
  type ClientMsg,
  type DirKey,
  type ServerMsg,
  type Slot,
} from "./shared";

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  charging: boolean;
  cx: number;
  cy: number;
};

type WSData = { slot: Slot | -1 };

function makeBall(slot: Slot): Ball {
  return {
    x: slot === 0 ? -4 : 4,
    y: BALL_MIN_Y,
    vx: 0,
    vy: 0,
    hp: MAX_HP,
    charging: false,
    cx: 0,
    cy: 0,
  };
}

const balls: Ball[] = [makeBall(0), makeBall(1)];
const sockets: (ServerWebSocket<WSData> | null)[] = [null, null];
const spectators = new Set<ServerWebSocket<WSData>>();
let status: "waiting" | "playing" | "ended" = "waiting";
let winner: Slot | undefined;
let tick = 0;
let hitstopUntil = 0;

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
  const s = JSON.stringify(msg);
  for (const ws of sockets) ws?.send(s);
  for (const ws of spectators) ws.send(s);
}

function send(ws: ServerWebSocket<WSData>, msg: ServerMsg) {
  ws.send(JSON.stringify(msg));
}

function resetMatch() {
  balls[0] = makeBall(0);
  balls[1] = makeBall(1);
  winner = undefined;
  tick = 0;
  hitstopUntil = 0;
  status = sockets[0] && sockets[1] ? "playing" : "waiting";
}

function applyDir(b: Ball, name: DirKey, shift: boolean) {
  const step = CHARGE_STEP * (shift ? SHIFT_MULT : 1);
  const diag = step / Math.SQRT2;
  let dx = 0;
  let dy = 0;
  switch (name) {
    case "left":
    case "a":
      dx = -step;
      break;
    case "right":
    case "d":
      dx = step;
      break;
    case "up":
    case "w":
      dy = step;
      break;
    case "down":
    case "s":
      dy = -step;
      break;
    case "q":
      dx = -diag;
      dy = diag;
      break;
    case "e":
      dx = diag;
      dy = diag;
      break;
    case "z":
      dx = -diag;
      dy = -diag;
      break;
    case "c":
      dx = diag;
      dy = -diag;
      break;
  }
  if (dx === 0 && dy === 0) return;
  if (b.charging) {
    b.cx += dx;
    b.cy += dy;
  } else {
    b.vx += dx * BURST_SCALE;
    b.vy += dy * BURST_SCALE;
  }
}

function applySpace(b: Ball) {
  if (b.charging) {
    b.vx = b.cx;
    b.vy = b.cy;
    b.cx = 0;
    b.cy = 0;
    b.charging = false;
  } else {
    b.charging = true;
    b.cx = 0;
    b.cy = 0;
    b.vx = 0;
    b.vy = 0;
  }
}

function physicsStep(dt: number) {
  for (const b of balls) {
    if (b.charging) continue;
    if (b.hp <= 0) continue;
    b.vy += GRAVITY * dt;
    const fx = HORIZ_FRICTION * dt;
    if (b.vx > fx) b.vx -= fx;
    else if (b.vx < -fx) b.vx += fx;
    else b.vx = 0;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x < BALL_MIN_X) {
      b.x = BALL_MIN_X;
      b.vx = -b.vx * 0.3;
    } else if (b.x > BALL_MAX_X) {
      b.x = BALL_MAX_X;
      b.vx = -b.vx * 0.3;
    }
    if (b.y < BALL_MIN_Y) {
      b.y = BALL_MIN_Y;
      b.vy = -b.vy * 0.3;
    } else if (b.y > BALL_MAX_Y) {
      b.y = BALL_MAX_Y;
      b.vy = -b.vy * 0.3;
    }
  }

  const [a, c] = balls;
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = BALL_R * 2;
  if (a.hp > 0 && c.hp > 0 && dist > 0 && dist < minDist) {
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;
    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    c.x += nx * overlap * 0.5;
    c.y += ny * overlap * 0.5;

    const speedA = Math.hypot(a.vx, a.vy);
    const speedC = Math.hypot(c.vx, c.vy);
    const rvx = c.vx - a.vx;
    const rvy = c.vy - a.vy;
    const closing = -(rvx * nx + rvy * ny);
    if (closing > 0) {
      const restitution = 0.9;
      const j = closing * (1 + restitution);
      a.vx -= j * nx;
      a.vy -= j * ny;
      c.vx += j * nx;
      c.vy += j * ny;

      if (closing > DMG_THRESHOLD) {
        let attacker: Slot | undefined;
        let victim: Slot | undefined;
        let dmg = 0;
        if (speedA > speedC) {
          dmg = (speedA - DMG_THRESHOLD) * DMG_K;
          c.hp = Math.max(0, c.hp - dmg);
          attacker = 0;
          victim = 1;
        } else if (speedC > speedA) {
          dmg = (speedC - DMG_THRESHOLD) * DMG_K;
          a.hp = Math.max(0, a.hp - dmg);
          attacker = 1;
          victim = 0;
        }
        if (attacker !== undefined && victim !== undefined && dmg > 0) {
          broadcast({ t: "hit", attacker, victim, dmg });
          hitstopUntil = Date.now() + Math.min(20 + dmg * 4, 120);
        }
      }
    }
  }

  if (status === "playing") {
    const dead0 = balls[0].hp <= 0;
    const dead1 = balls[1].hp <= 0;
    if (dead0 || dead1) {
      status = "ended";
      winner = dead0 && dead1 ? 0 : dead0 ? 1 : 0;
      broadcast({ t: "end", winner: winner! });
      setTimeout(() => {
        if (status !== "ended") return;
        if (sockets[0] && sockets[1]) {
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
  if ((status === "playing" || status === "ended") && Date.now() >= hitstopUntil) physicsStep(dt);
  snapAccum += dt;
  if (snapAccum >= snapInterval) {
    snapAccum = 0;
    tick++;
    broadcast({ t: "snap", tick, balls: snapshot(), status, winner });
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
      if (!sockets[0]) {
        sockets[0] = ws;
        assigned = 0;
      } else if (!sockets[1]) {
        sockets[1] = ws;
        assigned = 1;
      } else {
        spectators.add(ws);
      }
      ws.data.slot = assigned;
      send(ws, { t: "slot", n: assigned });
      console.log(`open: slot=${assigned}`);
      if (sockets[0] && sockets[1] && status !== "playing") {
        resetMatch();
        status = "playing";
      }
    },
    message(ws, raw) {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        return;
      }
      const slot = ws.data.slot;
      if (slot < 0) return;
      const b = balls[slot];
      if (status === "waiting") return;
      if (status === "ended" && slot !== winner) return;
      if (b.hp <= 0) return;
      if (msg.t === "dir") applyDir(b, msg.name, msg.shift);
      else if (msg.t === "space") applySpace(b);
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
