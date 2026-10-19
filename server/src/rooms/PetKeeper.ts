import { Pet, type PathGrid, type PetCommand, type PetInfo, type TilePoint } from '@office/shared';
import type { MapSchema } from '@colyseus/schema';
import { MovementSystem } from './MovementSystem.js';

/** Onde o dono está e para onde vai. */
export interface OwnerPosition {
  tile: TilePoint;
  dest: TilePoint;
  walking: boolean;
}

export interface PetHost {
  pets: MapSchema<Pet>;
  /** Grade para pets: piso livre, sem portas; o tile final não pode ter gente parada. */
  grid(petId: string): PathGrid & { heightAt(x: number, y: number): number };
  owner(sessionId: string): OwnerPosition | null;
  now(): number;
  random(): number;
}

/** Até onde o pet se afasta antes de correr atrás do dono. */
const FOLLOW_DISTANCE = 2;
/** Sentado/deitado: levanta se o dono for para longe ou depois deste tempo. */
const STAY_MS = 30_000;
const STAY_DISTANCE = 4;
const THINK_MS = 500;

interface Brain {
  mode: 'follow' | 'sit' | 'lie';
  until: number;
  nextWander: number;
  lastGoal: string;
}

const dist = (a: TilePoint, b: TilePoint) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Pets da sala: seguem o dono, passeiam perto dele quando ele para e obedecem
 * `/senta`, `/deita` e `/vem`. O movimento é o mesmo dos avatares (servidor autoritativo).
 */
export class PetKeeper {
  private readonly movement: MovementSystem;
  private readonly brains = new Map<string, Brain>();
  private thinkClock = 0;

  constructor(private readonly host: PetHost) {
    this.movement = new MovementSystem((id) => host.grid(id));
  }

  /** Pet aparece (ou muda) junto do dono; `null` tira da sala. */
  set(userId: string, info: PetInfo | null, ownerSession: string, ownerName: string): void {
    const existing = this.host.pets.get(userId);
    if (!info) return this.remove(userId);
    if (existing) {
      Object.assign(existing, {
        name: info.name,
        species: info.species,
        color: info.color,
        tint: info.tint,
      });
      return;
    }
    const owner = this.host.owner(ownerSession);
    if (!owner) return;
    const at = this.freeTileNear(userId, owner.tile) ?? owner.tile;
    const pet = Object.assign(new Pet(), {
      ownerSession,
      ownerName,
      name: info.name,
      species: info.species,
      color: info.color,
      tint: info.tint,
      x: at.x,
      y: at.y,
      nextX: at.x,
      nextY: at.y,
      z: this.host.grid(userId).heightAt(at.x, at.y),
      dir: 4,
      action: 'idle',
    });
    this.host.pets.set(userId, pet);
    this.brains.set(userId, {
      mode: 'follow',
      until: 0,
      nextWander: this.host.now() + 3000,
      lastGoal: '',
    });
  }

  remove(userId: string): void {
    this.host.pets.delete(userId);
    this.movement.remove(userId);
    this.brains.delete(userId);
  }

  /** O dono saiu: o pet passa para outra aba da mesma pessoa na sala, ou sai junto. */
  ownerLeft(sessionId: string, otherSession: (userId: string) => string | null): void {
    for (const [userId, pet] of this.host.pets.entries()) {
      if (pet.ownerSession !== sessionId) continue;
      const next = otherSession(userId);
      if (next) pet.ownerSession = next;
      else this.remove(userId);
    }
  }

  ownerRenamed(userId: string, name: string): void {
    const pet = this.host.pets.get(userId);
    if (pet) pet.ownerName = name;
  }

  command(userId: string, cmd: PetCommand): boolean {
    const pet = this.host.pets.get(userId);
    const brain = this.brains.get(userId);
    if (!pet || !brain) return false;
    const now = this.host.now();
    if (cmd === 'come') {
      brain.mode = 'follow';
      brain.lastGoal = '';
      brain.nextWander = now + 8000;
      if (pet.action === 'sit' || pet.action === 'lie') pet.action = 'idle';
      this.goToOwner(userId, pet, brain, true);
      return true;
    }
    brain.mode = cmd;
    brain.until = now + STAY_MS;
    // Termina o passo em andamento e para ali; a pose entra quando ele estiver parado.
    if (pet.nextX !== pet.x || pet.nextY !== pet.y) {
      this.movement.request(userId, pet, { x: pet.nextX, y: pet.nextY });
    } else {
      this.movement.remove(userId);
      pet.action = cmd;
    }
    return true;
  }

  tick(dtMs: number): void {
    this.movement.tick(dtMs, this.host.pets.entries());
    this.thinkClock += dtMs;
    if (this.thinkClock < THINK_MS) return;
    this.thinkClock = 0;
    for (const [userId, pet] of this.host.pets.entries()) this.think(userId, pet);
  }

  private think(userId: string, pet: Pet): void {
    const brain = this.brains.get(userId);
    const owner = this.host.owner(pet.ownerSession);
    if (!brain || !owner) return;
    const now = this.host.now();
    const stepping = pet.nextX !== pet.x || pet.nextY !== pet.y;
    const here = this.movement.destinationOf(userId, pet);

    if (brain.mode !== 'follow') {
      if (now > brain.until || dist(here, owner.dest) > STAY_DISTANCE) {
        brain.mode = 'follow';
        brain.lastGoal = '';
        if (!stepping) pet.action = 'idle';
      } else {
        if (!stepping) pet.action = brain.mode;
        return;
      }
    }

    if (dist(here, owner.dest) > FOLLOW_DISTANCE) {
      this.goToOwner(userId, pet, brain, false);
      brain.nextWander = now + 3000 + this.host.random() * 4000;
      return;
    }
    // Dono parado: de vez em quando dá uma volta por perto.
    if (!stepping && !owner.walking && now >= brain.nextWander) {
      brain.nextWander = now + 4000 + this.host.random() * 5000;
      const r = FOLLOW_DISTANCE;
      for (let tries = 0; tries < 8; tries++) {
        const t = {
          x: owner.tile.x + Math.round((this.host.random() * 2 - 1) * r),
          y: owner.tile.y + Math.round((this.host.random() * 2 - 1) * r),
        };
        if ((t.x === pet.x && t.y === pet.y) || (t.x === owner.tile.x && t.y === owner.tile.y)) {
          continue;
        }
        if (!this.host.grid(userId).isWalkable(t.x, t.y, true)) continue;
        const res = this.movement.request(userId, pet, t);
        if (res.ok) break;
      }
    }
  }

  /** Anda até um tile livre ao lado de onde o dono vai parar. */
  private goToOwner(userId: string, pet: Pet, brain: Brain, force: boolean): void {
    const owner = this.host.owner(pet.ownerSession);
    if (!owner) return;
    const goal = this.freeTileNear(userId, owner.dest, pet);
    if (!goal) return;
    const key = `${goal.x},${goal.y}`;
    if (!force && key === brain.lastGoal) return;
    brain.lastGoal = key;
    this.movement.request(userId, pet, goal);
  }

  /** Tile livre encostado em `center` (o mais perto de `from`, se dado). */
  private freeTileNear(userId: string, center: TilePoint, from?: TilePoint): TilePoint | null {
    const grid = this.host.grid(userId);
    const ring: TilePoint[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = { x: center.x + dx, y: center.y + dy };
        if (grid.isWalkable(t.x, t.y, true)) ring.push(t);
      }
    }
    if (from) ring.sort((a, b) => dist(a, from) - dist(b, from));
    return ring[0] ?? null;
  }
}
