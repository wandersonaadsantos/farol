import { $ } from './infra.js';
import { testInterventionVoice } from './interventions.js';

function renderInterventionSettings(config) {
  $('#setVoiceEnabled').checked = config.voiceEnabled === true;
  $('#setVoiceVolume').value = String(config.voiceVolume ?? 50);
  $('#setVoiceQuietEnabled').checked = config.voiceQuietEnabled === true;
  $('#interventionVoiceOptions').hidden = config.voiceEnabled !== true;
  $('#interventionQuietTimes').hidden = config.voiceQuietEnabled !== true;
  $('#setVoiceQuietStart').value = config.voiceQuietStart || '22:00';
  $('#setVoiceQuietEnd').value = config.voiceQuietEnd || '08:00';
  $('#setInterventionReminder').value = String(config.interventionReminderMinutes || 0);
  for (const option of $('#setVoiceEvents').querySelectorAll('option')) {
    option.selected = (config.voiceEvents || []).includes(option.value);
  }
  $('#testInterventionVoice').onclick = testInterventionVoice;
}
export { renderInterventionSettings };
