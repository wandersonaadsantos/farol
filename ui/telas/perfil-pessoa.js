/* Farol · UI: editar o perfil de review de uma pessoa (papel e domínios), que
   molda o tom e a postura da revisão automática. Não é dona de nenhuma aba: o
   picker (`papelPicker`, ui/pure/pessoas.js) aparece tanto na aba Time
   (telas/time.js) quanto nos cards do Radar (telas/radar.js), e por isso o
   listener não pertence a nenhum dos dois — pertence ao ASSUNTO "perfil de
   review", que é este módulo. Delegado no document pra funcionar nos dois
   lugares (e no 1º PR de quem ainda não está no time) com um listener só. */

import { estado } from './estado.js';
import { api } from './infra.js';

/* marcar o perfil de review de uma pessoa (papel e domínios): molda o tom e a
   postura da revisão automática. Global (delegado no documento) pra funcionar na
   aba Time E nos cards do PR (fila, Precisa de você), inclusive pra marcar o 1º
   PR de quem ainda não está no time. */
function initPerfilPessoa() {
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.classList) return;
    const isPapel = t.classList.contains('papel-level');
    const isDom = t.classList.contains('dom-level');
    if (!isPapel && !isDom) return;
    const login = String(t.dataset.login || '').toLowerCase();
    if (!login) return;
    const people = { ...((estado().config && estado().config.people) || {}) };
    const person = { ...(people[login] || {}) };
    if (isPapel) {
      if (t.value) person.papel = t.value; else delete person.papel;
    } else {
      const dom = { ...(person.dominios || {}) };
      if (t.value) dom[t.dataset.domain] = t.value; else delete dom[t.dataset.domain];
      if (Object.keys(dom).length) person.dominios = dom; else delete person.dominios;
    }
    if (person.papel || person.dominios) people[login] = person; else delete people[login];
    if (estado().config) estado().config.people = people;   // otimista, pra o select não piscar
    api('/api/settings', { people });
  });
}

export { initPerfilPessoa };
