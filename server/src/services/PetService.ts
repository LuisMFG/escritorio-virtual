import { isPetSpecies, type PetInfo } from '@office/shared';
import { eq } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import type { Db } from '../db/client.js';
import { pets } from '../db/schema.js';

/** Pet de cada pessoa. `changed` avisa as salas abertas (pet novo, editado ou solto). */
export class PetService {
  readonly events = new EventEmitter<{ changed: [userId: string, pet: PetInfo | null] }>();

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events.setMaxListeners(100);
  }

  get(userId: string): PetInfo | null {
    const row = this.db.select().from(pets).where(eq(pets.userId, userId)).get();
    if (!row) return null;
    const species = isPetSpecies(row.species) ? row.species : 'dog';
    return { name: row.name, species, color: row.color, tint: row.tint };
  }

  /** Adota ou edita (um pet por pessoa). */
  save(userId: string, pet: PetInfo): PetInfo {
    this.db
      .insert(pets)
      .values({ userId, ...pet, createdAt: this.now() })
      .onConflictDoUpdate({ target: pets.userId, set: { ...pet } })
      .run();
    this.events.emit('changed', userId, pet);
    return pet;
  }

  remove(userId: string): void {
    this.db.delete(pets).where(eq(pets.userId, userId)).run();
    this.events.emit('changed', userId, null);
  }
}
