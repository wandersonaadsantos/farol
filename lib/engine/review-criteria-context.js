import jira from './jira.js';
import { criteriaPrompt } from './review-criteria.js';
import { relatedCriteriaParents } from './review-criteria-history.js';

async function criteriaContext(cardResult, engine, pr) {
  const sources = await jira.fontesDeProduto(cardResult);
  const current = sources.cardAtual ? { ...cardResult, card: sources.cardAtual } : cardResult;
  const card = current.ok && current.site?.baseUrl && current.card?.key
    ? `${current.site.baseUrl}/browse/${encodeURIComponent(current.card.key)}` : '';
  const related = engine && pr ? relatedCriteriaParents(engine, pr, card) : [];
  return { sources, card, related, prompt: jira.cardBlock(current) + criteriaPrompt(sources, related) };
}

export { criteriaContext };
