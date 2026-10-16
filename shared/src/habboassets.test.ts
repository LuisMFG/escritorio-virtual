import { describe, expect, it } from 'vitest';
import { avatarImageUrl, furniImageUrl, habboApiHeaders } from './habboassets.js';

describe('habboassets', () => {
  it('monta a URL do avatar com figure codificada', () => {
    expect(avatarImageUrl('hd-180-1.ch-210-66', { direction: 3, size: 'l' })).toBe(
      'https://www.habboassets.com/imaging/avatar.png?figure=hd-180-1.ch-210-66&direction=3&size=l',
    );
  });

  it('omite parâmetros padrão do móvel', () => {
    expect(furniImageUrl('chair_norja', { direction: 2, size: 64 })).toBe(
      'https://www.habboassets.com/imaging/furniture/chair_norja.png?direction=2',
    );
    expect(furniImageUrl('rare_dragonlamp*4')).toBe(
      'https://www.habboassets.com/imaging/furniture/rare_dragonlamp*4.png',
    );
  });

  it('usa o hotel Brasil e só envia o token quando existe', () => {
    expect(habboApiHeaders()).toEqual({ Accept: 'application/json', 'X-Hotel-ID': '2' });
    expect(habboApiHeaders('abc').Authorization).toBe('Bearer abc');
  });
});
