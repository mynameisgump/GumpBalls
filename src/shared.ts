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

export const TICK_HZ = 60;
export const SNAP_HZ = 60;
export const MAX_HP = 100;
export const DMG_THRESHOLD = 3;
export const DMG_K = 2.5;
export const PORT = 7777;

export type Slot = 0 | 1;

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
      balls: BallSnap[];
      status: "waiting" | "playing" | "ended";
      winner?: Slot;
    }
  | { t: "end"; winner: Slot }
  | { t: "hit"; attacker: Slot; victim: Slot; dmg: number };

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
  | { t: "dir"; name: DirKey; shift: boolean }
  | { t: "space" };

export const MSG = {
  SLOT: 1,
  SNAP: 2,
  END: 3,
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

const STATUS_CODE = { waiting: 0, playing: 1, ended: 2 } as const;
const STATUS_NAME = ["waiting", "playing", "ended"] as const;

const BALL_BYTES = 4 * 7 + 1;
const SNAP_BYTES = 1 + 4 + 1 + 1 + 2 * BALL_BYTES;

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
      v.setUint32(o, m.tick >>> 0, true);
      o += 4;
      v.setUint8(o, STATUS_CODE[m.status]);
      o += 1;
      v.setUint8(o, m.winner === undefined ? 255 : m.winner);
      o += 1;
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
    case "end": {
      const buf = new ArrayBuffer(2);
      const v = new DataView(buf);
      v.setUint8(0, MSG.END);
      v.setUint8(1, m.winner);
      return buf;
    }
    case "hit": {
      const buf = new ArrayBuffer(1 + 1 + 1 + 4);
      const v = new DataView(buf);
      v.setUint8(0, MSG.HIT);
      v.setUint8(1, m.attacker);
      v.setUint8(2, m.victim);
      v.setFloat32(3, m.dmg, true);
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
      const tick = v.getUint32(o, true);
      o += 4;
      const sc = v.getUint8(o);
      o += 1;
      if (sc > 2) return null;
      const status = STATUS_NAME[sc];
      const w = v.getUint8(o);
      o += 1;
      const winner = w === 255 ? undefined : (w as Slot);
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
      return { t: "snap", tick, balls, status, winner };
    }
    case MSG.END: {
      const winner = v.getUint8(1) as Slot;
      return { t: "end", winner };
    }
    case MSG.HIT: {
      const attacker = v.getUint8(1) as Slot;
      const victim = v.getUint8(2) as Slot;
      const dmg = v.getFloat32(3, true);
      return { t: "hit", attacker, victim, dmg };
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
      const buf = new ArrayBuffer(3);
      const v = new DataView(buf);
      v.setUint8(0, MSG.DIR);
      v.setUint8(1, DIR_INDEX[m.name]);
      v.setUint8(2, m.shift ? 1 : 0);
      return buf;
    }
    case "space": {
      const buf = new ArrayBuffer(1);
      new DataView(buf).setUint8(0, MSG.SPACE);
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
      if (data.byteLength < 3) return null;
      const idx = v.getUint8(1);
      const name = DIR_LIST[idx];
      if (!name) return null;
      const shift = v.getUint8(2) !== 0;
      return { t: "dir", name, shift };
    }
    case MSG.SPACE:
      return { t: "space" };
  }
  return null;
}
