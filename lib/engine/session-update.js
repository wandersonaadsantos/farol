// Mantém a atualização aguardando também durante a preparação assíncrona,
// antes de existir processo ou entrada em activeReviews/running.
import { UPDATE_INSTALLING_ERROR } from '../constants.js';

function runUpdateProtectedSession(engine, execute) {
  if (engine.updateInstalling) return Promise.reject(new Error(UPDATE_INSTALLING_ERROR));
  engine.pendingUpdateSessions = (engine.pendingUpdateSessions || 0) + 1;
  let result;
  try { result = execute(); }
  catch (err) {
    engine.pendingUpdateSessions--;
    return Promise.reject(err);
  }
  return Promise.resolve(result).finally(() => { engine.pendingUpdateSessions--; });
}

export { runUpdateProtectedSession };
