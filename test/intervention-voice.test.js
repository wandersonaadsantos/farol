import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInterventionVoice } from '../ui/telas/intervention-voice.js';

const event = { kind: 'decision', speech: 'Farol. Uma revisão precisa da sua decisão.' };
const config = { voiceEnabled: true, voiceEvents: ['decision'], voiceVolume: 30 };
function synthesizer() {
  const spoken = [], statuses = [];
  let cancelled = 0;
  const api = { SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { getVoices: () => [{ name: 'Remota', localService: false, lang: 'pt-BR' },
      { name: 'Local', localService: true, lang: 'pt-BR' }], speak: u => spoken.push(u), cancel: () => cancelled++ } };
  return { api, spoken, statuses, cancelled: () => cancelled, voice: createInterventionVoice(api, s => statuses.push(s)) };
}

test('voz é opt-in, seleciona sintetizador local e aplica o volume', () => {
  const f = synthesizer();
  assert.equal(f.voice.speak(event, {}), 'silent');
  assert.equal(f.spoken.length, 0);
  assert.equal(f.voice.speak(event, config), 'speaking');
  assert.equal(f.spoken[0].voice.name, 'Local'); assert.equal(f.spoken[0].volume, 0.3);
  assert.equal(f.spoken[0].text, event.speech);
  f.spoken[0].onend(); assert.equal(f.statuses.at(-1), 'ready');
});

test('rajada não acumula fala e desligar cancela a reprodução', () => {
  const f = synthesizer(); f.voice.speak(event, config);
  assert.equal(f.voice.speak(event, config), 'busy'); assert.equal(f.spoken.length, 1);
  f.voice.configure({ voiceEnabled: false });
  assert.equal(f.cancelled(), 1);
  assert.equal(f.voice.speak(event, config), 'speaking');
});

test('sem API, sem voz local ou falha do sistema deixam um estado observável', () => {
  const statuses = [];
  assert.equal(createInterventionVoice({}, s => statuses.push(s)).speak(event, config), 'unavailable');
  const f = synthesizer(); f.api.speechSynthesis.getVoices = () => [{ localService: false }];
  assert.equal(f.voice.speak(event, config), 'unavailable');
  f.api.speechSynthesis.getVoices = () => [{ localService: true, lang: 'pt-BR' }];
  f.api.speechSynthesis.speak = () => { throw new Error('indisponível'); };
  assert.equal(f.voice.speak(event, config), 'failed');
  assert.ok(statuses.includes('unavailable'));
});

test('erro assíncrono libera nova tentativa e silêncio não inicia síntese', () => {
  const f = synthesizer(); f.voice.speak(event, config); f.spoken[0].onerror();
  assert.equal(f.statuses.at(-1), 'failed');
  assert.equal(f.voice.speak(event, config), 'speaking'); f.spoken[1].onend();
  const quiet = { ...config, voiceQuietEnabled: true, voiceQuietStart: '00:00', voiceQuietEnd: '23:59' };
  assert.equal(f.voice.speak(event, quiet, new Date(2026, 9, 23, 12)), 'silent');
  assert.equal(f.spoken.length, 2);
});

test('falha ao cancelar o sintetizador não interrompe mudança de configuração', () => {
  const f = synthesizer(); f.voice.speak(event, config);
  f.api.speechSynthesis.cancel = () => { throw new Error('serviço encerrado'); };
  assert.doesNotThrow(() => f.voice.configure({ voiceEnabled: false }));
  assert.equal(f.statuses.at(-1), 'failed');
  assert.equal(f.voice.speak(event, config), 'speaking');
  f.spoken.at(-1).onend();
});
