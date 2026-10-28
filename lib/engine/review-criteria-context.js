import jira from './jira.js';
import { criteriaPrompt } from './review-criteria.js';
import { relatedCriteriaParents } from './review-criteria-history.js';

async function criteriaContext(cardResult, engine, pr) {
  const sources = await jira.fontesDeProduto(cardResult);
  const current = sources.cardAtual ? { ...cardResult, card: sources.cardAtual } : cardResult;
  const card = current.ok && current.site?.baseUrl && current.card?.key
    ? `${current.site.baseUrl}/browse/${encodeURIComponent(current.card.key)}` : '';
  const history = engine && pr ? relatedCriteriaParents(engine, pr, card) : { parents: [], complete: null };
  return { sources, card, related: history.parents, relatedComplete: history.complete,
    prompt: jira.cardBlock(current) + criteriaPrompt(sources, history.parents, history.complete) };
}

export { criteriaContext };
