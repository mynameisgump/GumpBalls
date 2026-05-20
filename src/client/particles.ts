import {
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  InstancedMesh,
  Matrix4,
} from "three";
import {
  BALL_MIN_Y,
  BALL_R,
  CEIL_Y,
  LEFT_X,
  RIGHT_X,
  WALL_T,
} from "../shared";
import { scene } from "./scene";

const PARTICLE_RADIUS = 0.09;
const PARTICLE_COUNT = 140;

const FLOOR_Y = BALL_MIN_Y - BALL_R + PARTICLE_RADIUS;
const CEIL_INNER = CEIL_Y - WALL_T / 2 - PARTICLE_RADIUS;
const LEFT_INNER = LEFT_X + WALL_T / 2 + PARTICLE_RADIUS;
const RIGHT_INNER = RIGHT_X - WALL_T / 2 - PARTICLE_RADIUS;
// Floor depth = 2 (z extent), centered at z = 0
const FLOOR_HALF_Z = 1;
const FLOOR_Z_MIN = -FLOOR_HALF_Z + PARTICLE_RADIUS;
const FLOOR_Z_MAX = FLOOR_HALF_Z - PARTICLE_RADIUS;
// Back wall inner face at z = -FLOOR_HALF_Z (back wall center at -1 - WALL_T/2)
const BACK_Z = -FLOOR_HALF_Z + PARTICLE_RADIUS;
// Kill threshold for particles that fall off the edge
const KILL_Y = FLOOR_Y - 40;

const particleGeo = new SphereGeometry(PARTICLE_RADIUS, 6, 4);
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

export function burstBlood(x: number, y: number) {
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

export function clearBlood() {
  for (const p of particles) p.life = 0;
  for (let i = 0; i < PARTICLE_COUNT; i++) bloodMesh.setMatrixAt(i, zeroMat);
  bloodMesh.instanceMatrix.needsUpdate = true;
  bloodMesh.visible = false;
}

export function updateParticles(dt: number) {
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

    // Side walls
    if (p.x < LEFT_INNER) {
      p.x = LEFT_INNER;
      p.vx = -p.vx * 0.5;
    } else if (p.x > RIGHT_INNER) {
      p.x = RIGHT_INNER;
      p.vx = -p.vx * 0.5;
    }

    // Ceiling
    if (p.y > CEIL_INNER) {
      p.y = CEIL_INNER;
      p.vy = -p.vy * 0.3;
    }

    // Back wall
    if (p.z < BACK_Z) {
      p.z = BACK_Z;
      p.vz = -p.vz * 0.5;
    }

    // Floor — only catches particle if z is over the floor pad. Otherwise
    // it falls past the front ledge (no front wall) into the void.
    if (
      p.y < FLOOR_Y &&
      p.z >= FLOOR_Z_MIN &&
      p.z <= FLOOR_Z_MAX
    ) {
      p.y = FLOOR_Y;
      p.vy *= -0.3;
      p.vx *= 0.6;
      p.vz *= 0.6;
    }

    // Kill particles that fall way below scene
    if (p.y < KILL_Y) p.life = 0;

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
