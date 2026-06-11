export const ROOM_W = 16;
export const ROOM_H = 10;
export const WALL_T = 0.5;
export const BALL_R = 0.5;

export const GRAVITY = -10;
export const HORIZ_FRICTION = 3.5;
export const CHARGE_STEP = 3.5;
export const SHIFT_MULT = 2.5;
export const BURST_SCALE = 0.55;

export const FLOOR_Y = -ROOM_H / 2 + WALL_T / 2;
export const CEIL_Y = ROOM_H / 2 - WALL_T / 2;
export const LEFT_X = -ROOM_W / 2 + WALL_T / 2;
export const RIGHT_X = ROOM_W / 2 - WALL_T / 2;
export const BALL_MIN_Y = FLOOR_Y + WALL_T / 2 + BALL_R;
export const BALL_MAX_Y = CEIL_Y - WALL_T / 2 - BALL_R;
export const BALL_MIN_X = LEFT_X + WALL_T / 2 + BALL_R;
export const BALL_MAX_X = RIGHT_X - WALL_T / 2 - BALL_R;

export const TICK_HZ = 128;
export const SNAP_HZ = 128;
export const MAX_HP = 100;
export const DMG_THRESHOLD = 3;
export const DMG_K = 2.5;
export const PORT = 7777;

export type Slot = 0 | 1;

export type MatchStatus = "waiting" | "playing" | "ended" | "starting";

// Tournament control plane. These ride the same socket as JSON text frames
// (the binary codec below stays reserved for the hot snap/input path), so
// names — which are variable-length — never touch the fixed-width encoder.
export type PlayerInfo = { id: number; name: string };
export type ControlServerMsg =
  | { t: "ident"; id: number }
  | {
      t: "roster";
      champion: PlayerInfo | null;
      challenger: PlayerInfo | null;
      streak: number;
      queue: PlayerInfo[];
    };
export type ControlClientMsg = { t: "join"; name: string };

export type BallSnap = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  charging: boolean;
  cx: number;
  cy: number;
};

export type ServerMsg =
  | { t: "slot"; n: Slot | -1 }
  | {
      t: "snap";
      tick: number;
      ack: [number, number];
      balls: BallSnap[];
      status: MatchStatus;
      winner?: Slot;
    }
  | { t: "hit"; attacker: Slot; victim: Slot; dmg: number; closing: number };

export type DirKey =
  | "left"
  | "right"
  | "up"
  | "down"
  | "a"
  | "d"
  | "w"
  | "s"
  | "q"
  | "e"
  | "z"
  | "c";

export type ClientMsg =
  | { t: "hello" }
  | { t: "dir"; seq: number; name: DirKey; shift: boolean }
  | { t: "space"; seq: number };

export type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  charging: boolean;
  cx: number;
  cy: number;
};

export type HitEvent = {
  attacker: Slot;
  victim: Slot;
  dmg: number;
  closing: number;
};

// Deterministic per-name color: FNV-1a hash -> hue, fixed saturation/lightness
// so every name maps to a distinct, vivid, readable color (same name -> same
// color on every client). Used to tint a player's ball and name tag.
export function nameHue(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 360;
}

export function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255) & 0xff;
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

// Base color and brighter "charging" tint for a given username.
export function playerColor(name: string): { base: number; charge: number } {
  const hue = nameHue(name);
  return {
    base: hslToHex(hue, 0.7, 0.55),
    charge: hslToHex(hue, 0.9, 0.72),
  };
}

export function makeBall(slot: Slot): Ball {
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

export function applyDir(b: Ball, name: DirKey, shift: boolean) {
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

export function applySpace(b: Ball) {
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

export function stepBallSolo(b: Ball, dt: number): void {
  if (b.charging) return;
  if (b.hp <= 0) return;
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

export function physicsStep(balls: Ball[], dt: number): HitEvent | null {
  for (const b of balls) stepBallSolo(b, dt);

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

      let attacker: Slot = speedA >= speedC ? 0 : 1;
      let victim: Slot = attacker === 0 ? 1 : 0;
      let dmg = 0;
      if (closing > DMG_THRESHOLD) {
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
      }
      return { attacker, victim, dmg, closing };
    }
  }
  return null;
}

export const MSG = {
  SLOT: 1,
  SNAP: 2,
  HIT: 4,
  HELLO: 0x10,
  DIR: 0x11,
  SPACE: 0x12,
} as const;

export const DIR_LIST: DirKey[] = [
  "left",
  "right",
  "up",
  "down",
  "a",
  "d",
  "w",
  "s",
  "q",
  "e",
  "z",
  "c",
];
export const DIR_INDEX: Record<DirKey, number> = DIR_LIST.reduce(
  (acc, d, i) => {
    acc[d] = i;
    return acc;
  },
  {} as Record<DirKey, number>,
);

const STATUS_CODE = { waiting: 0, playing: 1, ended: 2, starting: 3 } as const;
const STATUS_NAME = ["waiting", "playing", "ended", "starting"] as const;

const BALL_BYTES = 4 * 7 + 1;
const SNAP_HEADER_BYTES = 1 + 1 + 1 + 4 + 4 + 4;
const SNAP_BYTES = SNAP_HEADER_BYTES + 2 * BALL_BYTES;

export function encodeServerMsg(m: ServerMsg): ArrayBuffer {
  switch (m.t) {
    case "slot": {
      const buf = new ArrayBuffer(2);
      const v = new DataView(buf);
      v.setUint8(0, MSG.SLOT);
      v.setInt8(1, m.n);
      return buf;
    }
    case "snap": {
      const buf = new ArrayBuffer(SNAP_BYTES);
      const v = new DataView(buf);
      let o = 0;
      v.setUint8(o, MSG.SNAP);
      o += 1;
      v.setUint8(o, STATUS_CODE[m.status]);
      o += 1;
      v.setUint8(o, m.winner === undefined ? 255 : m.winner);
      o += 1;
      v.setUint32(o, m.tick >>> 0, true);
      o += 4;
      v.setUint32(o, m.ack[0] >>> 0, true);
      o += 4;
      v.setUint32(o, m.ack[1] >>> 0, true);
      o += 4;
      for (const b of m.balls) {
        v.setFloat32(o, b.x, true);
        o += 4;
        v.setFloat32(o, b.y, true);
        o += 4;
        v.setFloat32(o, b.vx, true);
        o += 4;
        v.setFloat32(o, b.vy, true);
        o += 4;
        v.setFloat32(o, b.hp, true);
        o += 4;
        v.setUint8(o, b.charging ? 1 : 0);
        o += 1;
        v.setFloat32(o, b.cx, true);
        o += 4;
        v.setFloat32(o, b.cy, true);
        o += 4;
      }
      return buf;
    }
    case "hit": {
      const buf = new ArrayBuffer(1 + 1 + 1 + 4 + 4);
      const v = new DataView(buf);
      v.setUint8(0, MSG.HIT);
      v.setUint8(1, m.attacker);
      v.setUint8(2, m.victim);
      v.setFloat32(3, m.dmg, true);
      v.setFloat32(7, m.closing, true);
      return buf;
    }
  }
}

export function decodeServerMsg(data: ArrayBuffer): ServerMsg | null {
  if (data.byteLength < 1) return null;
  const v = new DataView(data);
  const t = v.getUint8(0);
  switch (t) {
    case MSG.SLOT: {
      const n = v.getInt8(1);
      if (n !== -1 && n !== 0 && n !== 1) return null;
      return { t: "slot", n: n as Slot | -1 };
    }
    case MSG.SNAP: {
      let o = 1;
      const sc = v.getUint8(o);
      o += 1;
      if (sc > 3) return null;
      const status = STATUS_NAME[sc];
      const w = v.getUint8(o);
      o += 1;
      const winner = w === 255 ? undefined : (w as Slot);
      const tick = v.getUint32(o, true);
      o += 4;
      const ack0 = v.getUint32(o, true);
      o += 4;
      const ack1 = v.getUint32(o, true);
      o += 4;
      const balls: BallSnap[] = [];
      for (let i = 0; i < 2; i++) {
        const x = v.getFloat32(o, true);
        o += 4;
        const y = v.getFloat32(o, true);
        o += 4;
        const vx = v.getFloat32(o, true);
        o += 4;
        const vy = v.getFloat32(o, true);
        o += 4;
        const hp = v.getFloat32(o, true);
        o += 4;
        const charging = v.getUint8(o) !== 0;
        o += 1;
        const cx = v.getFloat32(o, true);
        o += 4;
        const cy = v.getFloat32(o, true);
        o += 4;
        balls.push({ x, y, vx, vy, hp, charging, cx, cy });
      }
      return { t: "snap", tick, ack: [ack0, ack1], balls, status, winner };
    }
    case MSG.HIT: {
      if (data.byteLength < 7) return null;
      const attacker = v.getUint8(1) as Slot;
      const victim = v.getUint8(2) as Slot;
      const dmg = v.getFloat32(3, true);
      const closing = data.byteLength >= 11 ? v.getFloat32(7, true) : dmg;
      return { t: "hit", attacker, victim, dmg, closing };
    }
  }
  return null;
}

export function encodeClientMsg(m: ClientMsg): ArrayBuffer {
  switch (m.t) {
    case "hello": {
      const buf = new ArrayBuffer(1);
      new DataView(buf).setUint8(0, MSG.HELLO);
      return buf;
    }
    case "dir": {
      const buf = new ArrayBuffer(7);
      const v = new DataView(buf);
      v.setUint8(0, MSG.DIR);
      v.setUint8(1, DIR_INDEX[m.name]);
      v.setUint8(2, m.shift ? 1 : 0);
      v.setUint32(3, m.seq >>> 0, true);
      return buf;
    }
    case "space": {
      const buf = new ArrayBuffer(5);
      const v = new DataView(buf);
      v.setUint8(0, MSG.SPACE);
      v.setUint32(1, m.seq >>> 0, true);
      return buf;
    }
  }
}

export function decodeClientMsg(data: ArrayBuffer): ClientMsg | null {
  if (data.byteLength < 1) return null;
  const v = new DataView(data);
  const t = v.getUint8(0);
  switch (t) {
    case MSG.HELLO:
      return { t: "hello" };
    case MSG.DIR: {
      if (data.byteLength < 7) return null;
      const idx = v.getUint8(1);
      const name = DIR_LIST[idx];
      if (!name) return null;
      const shift = v.getUint8(2) !== 0;
      const seq = v.getUint32(3, true);
      return { t: "dir", seq, name, shift };
    }
    case MSG.SPACE: {
      if (data.byteLength < 5) return null;
      const seq = v.getUint32(1, true);
      return { t: "space", seq };
    }
  }
  return null;
}
