import { describe, expect, it } from 'vitest';
import { formatTvTime, parseYouTubeLink, tvPosition, tvSkipNeeded, type TvPlayback } from './tv.js';

describe('TV', () => {
  it('lê os jeitos comuns de link do YouTube', () => {
    const id = 'dQw4w9WgXcQ';
    for (const link of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=42s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
      id,
    ])
      expect(parseYouTubeLink(link), link).toEqual({ videoId: id, listId: null });
    expect(parseYouTubeLink(`https://www.youtube.com/watch?v=${id}&list=PL1234567890ab`)).toEqual({
      videoId: id,
      listId: 'PL1234567890ab',
    });
    expect(parseYouTubeLink('https://www.youtube.com/playlist?list=PL1234567890ab')).toEqual({
      videoId: null,
      listId: 'PL1234567890ab',
    });
    for (const bad of [
      'oi',
      'https://vimeo.com/123',
      'https://youtube.com/watch?v=curto',
      '',
      'youtube.com/watch?v=%E0%A4%A',
    ])
      expect(parseYouTubeLink(bad).videoId, bad).toBeNull();
  });

  it('posição pelo relógio do servidor, parada quando pausado e no máximo a duração', () => {
    const item = {
      id: 'i',
      videoId: 'dQw4w9WgXcQ',
      title: '',
      author: '',
      addedBy: 'u',
      addedByName: 'Ana',
      duration: 100,
    };
    const p: TvPlayback = { item, startedAt: 10_000, pausedAt: null };
    expect(tvPosition(p, 40_000)).toBe(30);
    expect(tvPosition(p, 500_000)).toBe(100);
    expect(tvPosition(p, 5_000)).toBe(0);
    expect(tvPosition({ ...p, pausedAt: 12.5 }, 99_000)).toBe(12.5);
  });

  it('pular precisa de mais da metade de quem assiste', () => {
    expect([1, 2, 3, 4, 5].map(tvSkipNeeded)).toEqual([1, 2, 2, 3, 3]);
    expect(tvSkipNeeded(0)).toBe(1);
  });

  it('formata o tempo', () => {
    expect(formatTvTime(0)).toBe('0:00');
    expect(formatTvTime(247.9)).toBe('4:07');
    expect(formatTvTime(3909)).toBe('1:05:09');
  });
});
