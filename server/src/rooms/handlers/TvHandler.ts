import type { Client } from '@colyseus/core';
import type { UserRow } from '../../db/schema.js';
import type { TvScreens, Furni } from '@office/shared';
import { TV_ERRORS, TvMessage } from '@office/shared';
import { services } from '../../services/index.js';
import type { KeyedRateLimiter } from '../../util/rateLimiter.js';
import type { MapSchema } from '@colyseus/schema';

export type OfficeClient = Client<{ auth: UserRow }>;

export interface TvHost {
  isTv(furniId: string): boolean;
  tvViewer(client: Client, furniId: string): boolean;
  tvLimiter: KeyedRateLimiter;
  getFurni(): MapSchema<Furni>;
}

export class TvHandler {
  constructor(private readonly host: TvHost) {}

  handleOpen(client: OfficeClient, furniId: string): void {
    if (!client.auth || !this.host.isTv(furniId)) return;
    services().tv.open(furniId, client.sessionId, {
      userId: client.auth.id,
      name: client.auth.name,
    });
  }

  handleClose(client: Client, furniId: string): void {
    services().tv.close(furniId, client.sessionId);
  }

  handleAdd(client: OfficeClient, furniId: string, videoIds: string[]): void {
    if (!client.auth || !this.host.isTv(furniId) || !this.host.tvLimiter.tryTake(client.sessionId)) {
      return;
    }
    void services()
      .tv.add(furniId, { userId: client.auth.id, name: client.auth.name }, videoIds)
      .then((err) => {
        if (err) client.send(TvMessage.Error, { message: TV_ERRORS[err] });
      });
  }

  handleRemove(client: OfficeClient, furniId: string, id: string): void {
    if (!client.auth || !this.host.tvLimiter.tryTake(client.sessionId)) return;
    services().tv.remove(furniId, client.auth.id, id, client.auth.role === 'admin');
  }

  handleControl(
    client: Client,
    furniId: string,
    action: 'play' | 'pause' | 'seek',
    position: number,
  ): void {
    if (!this.host.tvViewer(client, furniId)) return;
    services().tv.control(furniId, action, position);
  }

  handleSkip(client: OfficeClient, furniId: string): void {
    if (!client.auth || !this.host.tvViewer(client, furniId)) return;
    services().tv.skip(furniId, client.auth.id, client.auth.role === 'admin');
  }

  handleDuration(client: Client, furniId: string, itemId: string, duration: number): void {
    if (this.host.tvViewer(client, furniId)) {
      services().tv.duration(furniId, itemId, duration);
    }
  }

  handleEnded(client: Client, furniId: string, itemId: string): void {
    if (this.host.tvViewer(client, furniId)) {
      services().tv.ended(furniId, itemId);
    }
  }

  getScreens(): TvScreens {
    const screens: TvScreens = {};
    for (const id of this.host.getFurni().keys()) {
      const v = this.host.isTv(id) ? services().tv.screen(id) : null;
      if (v) screens[id] = v;
    }
    return screens;
  }
}
