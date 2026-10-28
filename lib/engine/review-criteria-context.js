import jira from './jira.js';
import { criteriaPrompt } from './review-criteria.js';

async function criteriaContext(cardResult) {
  const sources = await jira.fontesDeProduto(cardResult);
  const current = sources.cardAtual ? { ...cardResult, card: sources.cardAtual } : cardResult;
  return { sources, prompt: jira.cardBlock(current) + criteriaPrompt(sources) };
}

export { criteriaContext };
