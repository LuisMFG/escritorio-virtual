import { describe, expect, it } from 'vitest';
import { emoteSchema, findMentions, mentions, parseEmoteCommand, statusSchema } from './social.js';

describe('parseEmoteCommand', () => {
  it('reconhece comandos sem diferenciar maiúsculas e acentos', () => {
    expect(parseEmoteCommand('/acenar')).toBe('wave');
    expect(parseEmoteCommand('  /Coração ')).toBe('heart');
    expect(parseEmoteCommand('/CAFÉ')).toBe('coffee');
    expect(parseEmoteCommand('/Reverência')).toBe('bow');
    // Dançar virou a escolha de dança (Fase 55): não é mais um emote.
    expect(parseEmoteCommand('/dançar')).toBeNull();
  });

  it('ignora texto comum e comandos desconhecidos', () => {
    expect(parseEmoteCommand('acenar')).toBeNull();
    expect(parseEmoteCommand('/acenar para todos')).toBeNull();
    expect(parseEmoteCommand('/voar')).toBeNull();
    expect(parseEmoteCommand('/')).toBeNull();
  });
});

describe('schemas', () => {
  it('status só aceita os três valores', () => {
    expect(statusSchema.safeParse({ status: 'busy' }).success).toBe(true);
    expect(statusSchema.safeParse({ status: 'invisivel' }).success).toBe(false);
  });

  it('emote só aceita os conhecidos', () => {
    expect(emoteSchema.safeParse({ emote: 'clap' }).success).toBe(true);
    expect(emoteSchema.safeParse({ emote: 'dance' }).success).toBe(false);
    expect(emoteSchema.safeParse({ emote: 'explodir' }).success).toBe(false);
  });
});

describe('menções', () => {
  const names = ['Ana', 'Ana Paula', 'Beto', 'João'];

  it('acha menções e prefere o nome mais longo', () => {
    expect(findMentions('oi @ana paula, tudo bem? cadê @Beto', names)).toEqual([
      { start: 3, end: 13, name: 'Ana Paula' },
      { start: 30, end: 35, name: 'Beto' },
    ]);
    expect(findMentions('@Ana!', names)).toEqual([{ start: 0, end: 4, name: 'Ana' }]);
  });

  it('ignora acentos e não confunde e-mails ou prefixos', () => {
    expect(findMentions('valeu @joao', names)[0]?.name).toBe('João');
    expect(findMentions('ana@beto.com', names)).toEqual([]);
    expect(findMentions('@Betoven chegou', names)).toEqual([]);
  });

  it('mentions diz se a pessoa foi citada', () => {
    expect(mentions('@Ana Paula vem cá', 'Ana Paula', names)).toBe(true);
    expect(mentions('@Ana Paula vem cá', 'Ana', names)).toBe(false);
    expect(mentions('@ana vem cá', 'Ana', names)).toBe(true);
  });
});
