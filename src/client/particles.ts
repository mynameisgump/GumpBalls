import {
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  InstancedMesh,
  Matrix4,
} from "three";
import { BALL_MIN_Y, BALL_R } from "../shared";
import { scene } from "./scene";

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
