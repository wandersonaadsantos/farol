// Áudio no CLIENTE, inclusive quando o engine é headless. Só usa vozes locais.
import { voiceAllowed, quietNow } from '../pure/interventions.js';

const VOICE_DEADLINE_MS = 15000;

function createInterventionVoice(api = globalThis, onStatus = () => {}) {
  let busy = false;
  let active = null;
  let lastConfig = {};
  let deadline = null;
  function status(code) { onStatus(code); return code; }
  function cancel() {
    clearTimeout(deadline);
    const utterance = active;
    active = null; busy = false;
    if (!utterance) return;
    utterance.onend = null; utterance.onerror = null;
    try { api.speechSynthesis?.cancel(); }
    catch { status('failed'); }
  }
  function configure(config) {
    lastConfig = config || {};
    if (lastConfig.voiceEnabled !== true || quietNow(lastConfig)) cancel();
  }
  function speak(event, config = lastConfig, date = new Date()) {
    configure(config);
    if (!voiceAllowed(config, event, date)) return status('silent');
    if (!api.speechSynthesis || !api.SpeechSynthesisUtterance) return status('unavailable');
    if (busy) return status('busy'); // rajadas não viram uma fila interminável de falas
    try {
      const voices = api.speechSynthesis.getVoices().filter(v => v.localService === true);
      const voice = voices.find(v => /^pt(-|_)/i.test(v.lang)) || voices[0];
      if (!voice) return status('unavailable');
      const utterance = new api.SpeechSynthesisUtterance(event.speech);
      utterance.voice = voice; utterance.lang = voice.lang;
      const volume = Number(config.voiceVolume);
      utterance.volume = Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) / 100 : 0.5;
      utterance.onend = () => { clearTimeout(deadline); busy = false; active = null; status('ready'); };
      utterance.onerror = () => { clearTimeout(deadline); busy = false; active = null; status('failed'); };
      active = utterance; busy = true;
      deadline = setTimeout(() => { cancel(); status('failed'); }, VOICE_DEADLINE_MS);
      deadline.unref?.();
      api.speechSynthesis.speak(utterance);
      return status('speaking');
    } catch { clearTimeout(deadline); busy = false; active = null; return status('failed'); }
  }
  return { speak, configure, cancel };
}
export { createInterventionVoice };
