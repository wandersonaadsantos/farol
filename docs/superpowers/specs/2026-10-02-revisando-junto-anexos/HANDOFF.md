# Handoff: outra pessoa revisando, limite do plano e a chave nova

Data: 02/10/2026. Quadros de referência: `Farol Outra Pessoa Revisando.dc.html` (ids `e1` a `e12d`, `m*` para celular, `l2` para o claro).

Só tela do Farol. Nada disso é escrito no PR.

## 1. Dados que a tela lê

- `pr.outrosRevisando`: lista de logins (já sem a minha conta e sem ferramentas). Vazia = ninguém.
- `pr.foraDeCena`: `{ quem: [logins], desde, coAssinado }` (registro durável). Usado nos estados 6 e 7.
- `accounts[conta].limitePlanoAte`: epoch ms; `0` = livre. Limite ativo quando `> Date.now()`.
- `config.revisarComOutrosRevisando`: a chave nova (padrão `false`).

## 2. Regra de precedência

1. Selos (`rascunho`, `pedida de novo`) aparecem sempre. Não competem com nada.
2. Linha de pessoas (`.pr-others`) aparece sempre que `outrosRevisando` tem alguém, e no estado 6. Forma longa quando é a única explicação do card; forma curta quando o card tem outra nota.
3. Nota da revisão automática: no máximo uma por card, nesta ordem:
   1. revisão parada (`.pr-parked`);
   2. limite do plano (`.pr-limit`);
   3. coordenação (`.pr-coord`).
4. Fora de cena (chave desligada e alguém revisando): limite e coordenação não aparecem, porque falam de uma revisão automática que não vai acontecer. Só a parada continua.
5. Ordem vertical dentro de `.info`: parada, pessoas, limite ou coordenação.
6. Limite com parada: vale só a parada (ela não relança sozinha; "recomeço sozinho" seria falso).
7. Limite com coordenação: vale só o limite (ele segura todos os aparelhos da conta).
8. Fila: com 2 ou mais cards da mesma conta cuja nota seria o limite, a explicação sobe para um aviso único no topo de Pra mim (`.queue-limit`, um por conta) e esses cards ficam com a forma curta. Com 1 card, só a nota no card.
9. Botão: com `outrosRevisando` não vazio, o rótulo é "Revisar junto" (mesma ação `act-review`). Sem ninguém, "Revisar".
10. Revisão rodando (estado 5): o PR sai de Pra mim e aparece como `.session-card` em Analisando agora, com a linha curta de pessoas e sem botão.

Em código:

```js
const outros = pr.outrosRevisando || [];
const temOutros = outros.length > 0;
const foraDeCena = temOutros && !ctx.config.revisarComOutrosRevisando;
const rotulo = temOutros ? 'Revisar junto' : 'Revisar';
const limiteAte = (ctx.accounts[pr.account] || {}).limitePlanoAte || 0;
const limiteAtivo = limiteAte > Date.now();

const parked = parkedNoteHtml((ctx.parked || {})[pr.key], rotulo);
let notaAuto = '';
if (parked) notaAuto = parked;
else if (!foraDeCena && limiteAtivo) notaAuto = limitNoteHtml(limiteAte, ctx.limiteNoTopo[pr.account] ? 'curta' : 'longa', rotulo);
else if (!foraDeCena) notaAuto = prCoordNoteHtml(pr.key, ctx.sync);

let forma = '';
if (temOutros) {
  if (parked) forma = 'curta-parada';
  else if (foraDeCena) forma = 'fora';
  else forma = notaAuto ? 'junto-curta' : 'junto';
} else if (pr.foraDeCena && !pr.foraDeCena.coAssinado) {
  // estado 6: o Farol segue fora neste commit e a label já sumiu. O motor só mantém
  // foraDeCena quando houve review; se a label caducou sem review, ele limpa o
  // registro (estado 8) e este ramo não entra.
  forma = 'terminou';
}
const pessoas = forma ? othersLineHtml(temOutros ? outros : pr.foraDeCena.quem, forma) : '';
```

`ctx.limiteNoTopo[conta]` é `true` quando 2 ou mais cards dessa conta, na fila atual, cairiam em `limitNoteHtml` (sem parada e sem fora de cena). Calcule antes de renderizar os cards.

## 3. Textos exatos

Nomes: 1 pessoa `@a`; 2 `@a e @b`; 3 ou mais `@a, @b e @c`. Verbo no singular com 1 ("está"), plural com 2 ou mais ("estão"). Cada `@login` é link pro perfil.

Linha de pessoas (`.pr-others`), por forma:

- `fora` (estados 2, 3, 9a, 9b, 9d): "**@ana-dev está revisando este PR.** Não reviso sozinho para não duplicar; o botão Revisar junto começa a sua revisão."
- `curta-parada` (9c): "**@ana-dev está revisando este PR.** Tentar de novo agora é revisar junto."
- `junto` (4): "**@ana-dev está revisando este PR.** Vou revisar junto mesmo assim, como pede Sistema > Automação." ("Sistema > Automação" leva a `#sys-row-revisarjunto` via `data-goto`.)
- `junto-curta` (9e, 12c): "**@ana-dev está revisando este PR.** Vou revisar junto mesmo assim."
- sessão (5): "**@ana-dev também está revisando este PR.**"
- `terminou` (6): "**@ana-dev revisou este PR.** Fiquei de fora neste commit; a decisão é sua."
- co-assinado (7, em Revisões recentes): "**@ana-dev pegou o PR e aprovou.** Aprovei em seu nome junto com ela, como pede “Aprovar junto com quem pegou o PR”."

  Com mais de uma pessoa em `quem`: "**@a e @b pegaram o PR e aprovaram.** Aprovei em seu nome junto com eles, como pede “Aprovar junto com quem pegou o PR”." Se não houver como saber o gênero, troque "com ela/eles" por "com quem pegou".

O trecho em negrito usa `.po-lead` (cor `--text`); o resto herda `--muted`.

Revisão parada (texto existente, só o rótulo do botão vira parâmetro):
"Revisão automática parada {quando}: {frase}. Ela não relança sozinha; o botão {rotulo} tenta de novo."

Limite do plano (`.pr-limit`):

- longa (12a, 12c, 12d): "Revisão automática esperando o limite do plano do Claude: recomeço sozinho {hora}. O botão {rotulo} tenta agora, mas pode bater no mesmo limite."
- curta (cards sob o aviso do topo): "Esperando o limite do plano, até {horaCurta}."

Aviso no topo de Pra mim (`.queue-limit`):

- várias contas: "Revisão automática da conta **{rótulo da conta}** esperando o limite do plano do Claude: recomeço sozinho {hora}. Vale para {n} PRs desta fila. O botão Revisar de cada um tenta agora, mas pode bater no mesmo limite."
- uma conta só: "Revisão automática esperando o limite do plano do Claude: recomeço sozinho {hora}. Vale para {n} PRs desta fila. O botão Revisar de cada um tenta agora, mas pode bater no mesmo limite."

`{hora}`: mesmo dia "às 21:00"; dia seguinte "amanhã às 21:00"; depois disso "em 04/10 às 21:00". `{horaCurta}`: "21:00", "amanhã 21:00", "04/10 21:00". Sempre num `<span title="{fmtStamp}">`.

Coordenação (textos existentes, sem mudança):

- `.pr-coord`: "Em análise no {aparelho}. A revisão automática espera por aqui."
- `.pr-coord.warn`: "Coordenação entre dispositivos indisponível agora. A revisão automática espera a conexão voltar."
- `.pr-coord.warn`: "Teto de rodadas automáticas de hoje atingido entre seus aparelhos. Volta amanhã; o Revisar vale agora."

Panorama (`.pw-others`): 1 pessoa "@ana-dev revisando"; 2 ou mais "@ana-dev e mais {n} revisando", com `title="@ana-dev e @bruno-lima estão revisando"`.

Revisões recentes (7): selo `co-assinado` ao lado do veredito.

Sistema > Automação, linha nova (logo depois de "Aprovar junto com quem pegou o PR", antes de "Esperar o CI antes de revisar" e "Esperar o CI para aprovar"):

- título: "Revisar sozinho mesmo com outra pessoa revisando"
- descrição: "Quando outra pessoa tem a label de revisando num PR pedido a você, a revisão automática roda mesmo assim e o card só informa quem está lá. Desligada, o Farol não revisa sozinho naquele commit e o botão Revisar junto continua valendo. Ligada, a co-assinatura de “Aprovar junto com quem pegou o PR” não acontece: sua aprovação vem da sua revisão."
- nota em "Aprovar junto com quem pegou o PR", só com a chave nova ligada: "Sem efeito agora: com “Revisar sozinho mesmo com outra pessoa revisando” ligada, o Farol não sai de cena e não há quem co-assinar."

"Aprovar junto" guarda o valor salvo e continua clicável; só o switch fica a 50%.

## 4. Marcação

### Helpers

```js
const perfil = (login) => `https://github.com/${encodeURIComponent(login)}`;

function faceLink(login) {
  const ini = esc(String(login).slice(0, 1).toUpperCase());
  return `<a class="po-face" href="${perfil(login)}" target="_blank" rel="noreferrer" title="@${esc(login)}" aria-label="Perfil de @${esc(login)}">${ini}<img src="${perfil(login)}.png?size=40" alt="" loading="lazy"></a>`;
}
function facesHtml(logins) {
  const vis = logins.slice(0, 3).map(faceLink).join('');
  const resto = logins.length > 3 ? `<span class="po-mais">+${logins.length - 3}</span>` : '';
  return `<span class="po-faces">${vis}${resto}</span>`;
}
function whoTxt(logins) {
  const l = logins.map((x) => `@${x}`);
  return l.length === 1 ? l[0] : `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`;
}
function whoHtml(logins) {
  const l = logins.map((x) => `<a class="po-who" href="${perfil(x)}" target="_blank" rel="noreferrer">@${esc(x)}</a>`);
  if (l.length === 1) return l[0];
  return `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`;
}
```

### Linha de pessoas (card de Pra mim, sessão, Revisões recentes)

```js
const CAUDA = {
  fora: 'Não reviso sozinho para não duplicar; o botão Revisar junto começa a sua revisão.',
  'curta-parada': 'Tentar de novo agora é revisar junto.',
  junto: 'Vou revisar junto mesmo assim, como pede <a class="is-goto" data-goto="sys-row-revisarjunto" href="#sys-row-revisarjunto">Sistema &gt; Automação</a>.',
  'junto-curta': 'Vou revisar junto mesmo assim.',
  sessao: '',
  terminou: 'Fiquei de fora neste commit; a decisão é sua.',
};

export function othersLineHtml(logins, forma) {
  if (!logins || !logins.length) return '';
  const n = logins.length;
  const verbo =
    forma === 'terminou' ? (n === 1 ? 'revisou' : 'revisaram') + ' este PR.'
    : forma === 'sessao' ? (n === 1 ? 'também está' : 'também estão') + ' revisando este PR.'
    : (n === 1 ? 'está' : 'estão') + ' revisando este PR.';
  const cauda = CAUDA[forma] ? ` ${CAUDA[forma]}` : '';
  return `<div class="pr-others">${facesHtml(logins)}<span class="po-txt"><span class="po-lead">${whoHtml(logins)} ${verbo}</span>${cauda}</span></div>`;
}
```

### Card de Pra mim (estados 1 a 4, 6, 8, 9, 12)

Mudanças em `queueCardHtml`: rótulo do botão, a linha de pessoas e a nota única.

```js
const acaoRevisar = `<button class="btn primary sm act-review" data-url="${esc(pr.url)}">${rotulo}</button>`;
// ...
<div class="info">
  <div class="pr-ref">${m.dot}<a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>${m.chip}${seloRascunho}${seloRepedida}</div>
  <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
  <div class="pr-sub">${personMention(pr.author, 'xs')} · atualizado ${fmtRel(pr.updatedAt)}${papel}</div>
  ${parked}${pessoas}${parked ? '' : notaAuto}
</div>
```

(`notaAuto` já é `parked` quando existe parada; o `${parked ? '' : notaAuto}` só evita imprimir duas vezes.)

Estado 1 e estado 8: sem `pessoas` e sem `notaAuto` novos. Card idêntico ao de hoje.

Resultado do estado 2:

```html
<div class="info">
  <div class="pr-ref">…acme/app#412</div>
  <div class="pr-title">Troca o cálculo de frete para a tabela nova da transportadora</div>
  <div class="pr-sub">…rafael-m · atualizado há 25 min</div>
  <div class="pr-others">
    <span class="po-faces"><a class="po-face" href="https://github.com/ana-dev" …>A<img …></a></span>
    <span class="po-txt"><span class="po-lead"><a class="po-who" href="https://github.com/ana-dev" …>@ana-dev</a> está revisando este PR.</span> Não reviso sozinho para não duplicar; o botão Revisar junto começa a sua revisão.</span>
  </div>
</div>
<div class="pr-actions"><button class="btn primary sm act-review" …>Revisar junto</button>…</div>
```

### Nota de limite (12a, 12c, 12d)

```js
export function limitNoteHtml(ate, forma, rotulo) {
  if (!ate || ate <= Date.now()) return '';
  const t = `<span title="${esc(fmtStamp(ate))}">${esc(forma === 'curta' ? fmtHoraCurta(ate) : fmtHoraAs(ate))}</span>`;
  if (forma === 'curta') return `<div class="pr-limit">Esperando o limite do plano, até ${t}.</div>`;
  return `<div class="pr-limit">Revisão automática esperando o limite do plano do Claude: recomeço sozinho ${t}. O botão ${esc(rotulo)} tenta agora, mas pode bater no mesmo limite.</div>`;
}
```

`fmtHoraAs` devolve "às 21:00" / "amanhã às 21:00" / "em 04/10 às 21:00"; `fmtHoraCurta` devolve "21:00" / "amanhã 21:00" / "04/10 21:00".

### Aviso no topo de Pra mim (12b)

Entre o `.section-head` de Pra mim e o `.cards`. Um por conta com `limiteNoTopo`; rola com a fila (não é sticky).

```js
export function queueLimitHtml(conta, ate, n, variasContas) {
  const t = `<span title="${esc(fmtStamp(ate))}">${esc(fmtHoraAs(ate))}</span>`;
  const daConta = variasContas ? ` da conta <b>${esc(conta.label)}</b>` : '';
  return `<div class="queue-limit" role="status" style="--ac:${conta.color}">
    <span class="acct-dot" aria-hidden="true"></span>
    <span>Revisão automática${daConta} esperando o limite do plano do Claude: recomeço sozinho ${t}. Vale para ${n} PRs desta fila. O botão Revisar de cada um tenta agora, mas pode bater no mesmo limite.</span>
  </div>`;
}
```

Com uma conta só, sem o `.acct-dot`.

### Sessão em execução (5)

Em `ui/pure/sessao.js`, depois de `.sess-progress` e antes de `.activity-feed`:

```js
${othersLineHtml(pr.outrosRevisando, 'sessao')}
```

Sem botão.

### Revisões recentes (7)

Em `.rr-head`, depois de `.rr-verdict`:

```html
<span class="rr-verdict">co-assinado</span>
```

Em `.rr-main`, depois de `.rr-person`: a linha de pessoas com o texto do estado 7 (montada à parte, mesmas classes):

```html
<div class="pr-others">
  <span class="po-faces"><a class="po-face" …>A<img …></a></span>
  <span class="po-txt"><span class="po-lead"><a class="po-who" …>@ana-dev</a> pegou o PR e aprovou.</span> Aprovei em seu nome junto com ela, como pede “Aprovar junto com quem pegou o PR”.</span>
</div>
```

### Panorama (10)

No fim de `.pw-head`, pedido a mim ou não:

```js
export function pwOthersHtml(logins) {
  if (!logins || !logins.length) return '';
  const lista = whoTxt(logins); // "@a e @b", texto puro
  const resto = logins.length > 1 ? ` e mais ${logins.length - 1}` : '';
  const title = logins.length > 1 ? ` title="${esc(lista)} estão revisando"` : '';
  return `<span class="pw-others"${title}>${facesHtml(logins)}<span><a class="po-who" href="${perfil(logins[0])}" target="_blank" rel="noreferrer">@${esc(logins[0])}</a>${resto} revisando</span></span>`;
}
```

### Sistema > Automação (11)

Logo depois da linha de "Aprovar junto com quem pegou o PR":

```html
<label class="set-row" id="sys-row-revisarjunto" for="setRevisarJunto">
  <span class="set-txt">
    <span class="set-title">Revisar sozinho mesmo com outra pessoa revisando</span>
    <span class="set-desc">Quando outra pessoa tem a label de revisando num PR pedido a você, a revisão automática roda mesmo assim e o card só informa quem está lá. Desligada, o Farol não revisa sozinho naquele commit e o botão Revisar junto continua valendo. Ligada, a co-assinatura de “Aprovar junto com quem pegou o PR” não acontece: sua aprovação vem da sua revisão.</span>
  </span>
  <span class="set-ctl"><input type="checkbox" id="setRevisarJunto"><span class="switch" aria-hidden="true"></span></span>
</label>
```

Na linha de "Aprovar junto com quem pegou o PR", dentro de `.set-txt`, depois de `.set-desc`:

```html
<span class="set-nota" id="notaAprovarJuntoSemEfeito" hidden>Sem efeito agora: com “Revisar sozinho mesmo com outra pessoa revisando” ligada, o Farol não sai de cena e não há quem co-assinar.</span>
```

Ao mudar `#setRevisarJunto`: `nota.hidden = !checked` e `linhaAprovarJunto.classList.toggle('sem-efeito', checked)`. Não altere o valor salvo de "Aprovar junto".

## 5. CSS novo

Só tokens de `app.css`. Um token novo: `--accent-text`.

```css
/* âmbar para TEXTO pequeno. No escuro é o próprio --accent; no claro o #e08700 dava
   2,6:1 sobre --surface. #9a5900 dá 5,5:1. Só .pr-limit, .queue-limit e .set-nota usam;
   .pr-coord.warn continua com --accent. */
:root { --accent-text: var(--accent); }
:root[data-theme="light"] { --accent-text: #9a5900; }

/* ---------- outra pessoa revisando: linha de pessoas ---------- */
.pr-others { margin-top: 6px; display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.4; color: var(--muted); text-wrap: pretty; overflow-wrap: anywhere; }
.po-faces { display: inline-flex; flex: none; margin-top: -2px; }
.po-face {
  position: relative; width: 22px; height: 22px; border-radius: 50%; overflow: hidden;
  border: 2px solid var(--surface); background: var(--surface-2); color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 700; text-decoration: none;
}
.po-face + .po-face, .po-face + .po-mais { margin-left: -6px; }
.po-face img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.po-face:hover, .po-face:focus-visible { border-color: var(--accent); text-decoration: none; }
.po-mais { height: 22px; min-width: 22px; padding: 0 5px; border-radius: 99px; border: 2px solid var(--surface); background: var(--surface-2); color: var(--muted); font-size: 9.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.po-lead { color: var(--text); }
.po-who { color: var(--text); font-weight: 600; }
.po-who:hover, .po-who:focus-visible { color: var(--accent); text-decoration: underline; }
.pr-others .is-goto { color: inherit; }
/* a borda da foto acompanha o fundo da linha no hover */
.prow:hover .po-face, .rrow:hover .po-face, .prow:hover .po-mais, .rrow:hover .po-mais { border-color: var(--surface-2); }
.session-card .pr-others { margin: 4px 0 2px; }

/* ---------- limite do plano ---------- */
.pr-limit { margin-top: var(--sp-1); font-size: 11.5px; line-height: 1.35; color: var(--accent-text); overflow-wrap: anywhere; }
.pr-limit span[title], .queue-limit span[title] { text-decoration: underline dotted; }
.queue-limit {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 14px; margin: 0 0 10px; border-radius: var(--radius);
  background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  font-size: 13px; line-height: 1.45; color: var(--text); text-wrap: pretty;
}
.queue-limit .acct-dot { margin-top: 6px; }
.queue-limit + .queue-limit { margin-top: -4px; }

/* ---------- Panorama ---------- */
.pw-others { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.pw-others .po-faces { margin-top: 0; }
.pw-others .po-face { width: 18px; height: 18px; font-size: 8px; }
.pw-others .po-face + .po-face { margin-left: -5px; }

/* ---------- Sistema > Automação ---------- */
.set-nota { display: block; margin-top: 6px; font-size: 12px; line-height: 1.4; color: var(--accent-text); font-weight: 400; text-wrap: pretty; }
.set-row.sem-efeito .switch { opacity: .5; }

/* ---------- celular ---------- */
@media (max-width: 620px) {
  /* alvos de toque de 44px nos quadros M2, M3, M9c e M12b */
  .pr-card .pr-actions .btn { min-height: 44px; }
  .pr-card .act-review { flex: 1; justify-content: center; }
  .pr-card .pr-actions .btn.icon { width: 44px; justify-content: center; }
  .queue-limit { padding: 10px 12px; }
}
@media (max-width: 420px) {
  .pw-others { white-space: normal; }
}
```

## 6. Por estado

- 1: card de hoje.
- 2: `pessoas` forma `fora`, botão "Revisar junto". Sem nota de limite ou coordenação.
- 3: igual ao 2 com a lista; até 3 fotos, depois `+N`.
- 4: `pessoas` forma `junto`, botão "Revisar junto".
- 5: PR em Analisando agora; `.session-card` com `othersLineHtml(…, 'sessao')`, sem botão.
- 6: `pessoas` forma `terminou` (logins de `foraDeCena.quem`), botão "Revisar".
- 7: só em Revisões recentes: selo `co-assinado` e a linha do estado 7.
- 8: card de hoje; `foraDeCena` caducado não deixa resíduo.
- 9a, 9b: selo + `pessoas` forma `fora`.
- 9c: `.pr-parked` (com `rotulo`) + `pessoas` forma `curta-parada`.
- 9d: chave desligada: `pessoas` forma `fora`; coordenação omitida.
- 9e: chave ligada: `pessoas` forma `junto-curta` + `.pr-coord`.
- 10: `.pw-others` no `.pw-head`.
- 11: linha `#sys-row-revisarjunto`; com ela ligada, `.set-nota` e `.sem-efeito` em "Aprovar junto".
- 12a: `.pr-limit` longa, botão "Revisar".
- 12b: `.queue-limit` no topo + `.pr-limit` curta nos cards da espera; cards fora de cena ou parados não contam.
- 12c: chave ligada: `pessoas` forma `junto-curta` + `.pr-limit` longa com "Revisar junto".
- 12d: parada + limite: só a parada. Coordenação + limite: só o limite.
