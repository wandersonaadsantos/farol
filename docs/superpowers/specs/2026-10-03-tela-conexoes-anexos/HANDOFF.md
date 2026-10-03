# HANDOFF: Repos bloqueados pra merge sai de Conexões e vai para Sistema → Automação

> Nota da implementação (03/10/2026): a seção 4.4 (item "Bloquear Merge neste repo" no menu ⋯
> do card) ficou de fora, porque o card de Meus PRs não tem menu ⋯ (Ocultar é botão solto);
> criar o menu seria layout novo. O exemplo da mensagem de erro usa `minha-org/meu-repo`.

Referência visual: `Farol Repos Bloqueados.dc.html` (telas 1a a 1m). Data: 03/10/2026.
Tudo aqui é local ao app: nada é escrito no GitHub.

## 1. O que sai

- A seção inteira `#sys-connections` (os campos `#setUser`, `#setOwners` e `#setMergeBlocked`).
- O botão da sidebar `#sysbtn-connections`.
- As entradas da busca de configurações que apontam para `sys-row-ghuser`, `sys-row-orgs` e `sys-row-mergeblocked` dentro de Conexões.
- O código que lê e grava `#setMergeBlocked` como texto separado por vírgula.

Os dados `ghUser` e `owners` continuam no config, sem tela. Não apague esses dados na migração.

## 2. Onde entra

Em `#sys-automation`, logo depois do `</div>` que fecha o `.card.set-list` existente, no fim da seção:

```html
<div class="section-head"><h2>Merge em Meus PRs</h2></div>
<div class="card set-list" id="sys-mergeblocked">
  <div class="set-row set-row-block" id="sys-row-mergeblocked">
    <div class="set-txt">
      <label class="set-title mb-title" for="mbAdd">Repos bloqueados pra merge<span class="count ambient" id="mbCount" hidden></span></label>
      <span class="set-desc">Nesses repos o botão Merge de Meus PRs fica desativado, para respeitar a regra de review do time, e o Farol deixa de consultar no GitHub se os PRs deles dão para mergear. Vale para todas as contas e não muda nada no GitHub.</span>
    </div>
    <div class="mb-empty" id="mbEmpty">Nenhum repo bloqueado. O Merge aparece em todos os seus PRs quando a autoanálise diz aprovável e o GitHub deixa mergear.</div>
    <ul class="mb-list" id="mbList" hidden></ul>
    <div class="mb-add">
      <input id="mbAdd" class="mb-input" type="text" spellcheck="false" autocomplete="off" placeholder="owner/repo ou URL do repo" aria-describedby="mbErro">
      <button class="btn sm" id="mbAddBtn" type="button">Bloquear</button>
    </div>
    <span class="mb-erro" id="mbErro" role="alert" hidden></span>
    <div class="mb-sug" id="mbSug" hidden><span>Dos seus PRs abertos:</span></div>
  </div>
</div>
```

`.set-row-block` já existe (`display:block`); aqui o bloco usa o espaçamento de `.mb-*` abaixo.

### 2.1 Estado vazio (padrão do dono)

`#mbCount` com `hidden`, `#mbEmpty` visível, `#mbList` com `hidden`. Se houver PRs seus abertos, `#mbSug` mostra os repos deles (seção 2.4).

### 2.2 Um repo

```html
<label class="set-title mb-title" for="mbAdd">Repos bloqueados pra merge<span class="count ambient" id="mbCount">1 repo</span></label>
...
<div class="mb-empty" id="mbEmpty" hidden>...</div>
<ul class="mb-list" id="mbList">
  <li class="mb-item">
    <span class="mb-txt"><code class="mb-repo">acme/web</code><span class="mb-meta">2 PRs seus abertos</span></span>
    <button class="btn sm danger-ghost mb-x" type="button" data-repo="acme/web" aria-label="Tirar acme/web da lista">Tirar</button>
  </li>
</ul>
```

### 2.3 Vários repos

Mesma linha `li.mb-item`, uma por repo, em ordem alfabética. `#mbCount` mostra `3 repos`.

```html
<ul class="mb-list" id="mbList">
  <li class="mb-item"><span class="mb-txt"><code class="mb-repo">acme/api</code><span class="mb-meta">1 PR seu aberto</span></span><button class="btn sm danger-ghost mb-x" type="button" data-repo="acme/api" aria-label="Tirar acme/api da lista">Tirar</button></li>
  <li class="mb-item"><span class="mb-txt"><code class="mb-repo">acme/web</code><span class="mb-meta">2 PRs seus abertos</span></span><button class="btn sm danger-ghost mb-x" type="button" data-repo="acme/web" aria-label="Tirar acme/web da lista">Tirar</button></li>
  <li class="mb-item"><span class="mb-txt"><code class="mb-repo">acme/infra</code><span class="mb-meta">nenhum PR seu aberto agora</span></span><button class="btn sm danger-ghost mb-x" type="button" data-repo="acme/infra" aria-label="Tirar acme/infra da lista">Tirar</button></li>
</ul>
```

### 2.4 Atalhos "Dos seus PRs abertos"

Um botão por repo distinto da lista de Meus PRs (todas as contas) que ainda não está bloqueado. Sem nenhum, `#mbSug` fica `hidden`.

```html
<div class="mb-sug" id="mbSug">
  <span>Dos seus PRs abertos:</span>
  <button class="mb-sug-btn" type="button" data-repo="acme/web" aria-label="Bloquear acme/web">+ acme/web</button>
</div>
```

### 2.5 Erro no campo

```html
<input id="mbAdd" class="mb-input" aria-invalid="true" ...>
<span class="mb-erro" id="mbErro" role="alert">Use o formato owner/repo, como acme/web.</span>
```

O erro some (`hidden`, `aria-invalid` removido) assim que o campo muda.

## 3. Como a edição grava

Dado: `config.mergeBlockedRepos`, lista de `owner/repo`. Gravação imediata, pelo mesmo caminho de gravação de config que `#setMergeBlocked` usava, sempre a lista inteira.

Normalização de cada entrada (em `ui/pure.js`, com teste):

```js
function normalizarRepo(v) {
  return String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .split('/').slice(0, 2).join('/');
}
const REPO_OK = /^[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+$/;
```

O `split/slice` aceita a URL de um PR (`.../owner/repo/pull/12`) e fica com `owner/repo`.
Grava em minúsculas porque o card de Meus PRs já compara em minúsculas.

Incluir (Enter no campo, botão Bloquear ou atalho da 2.4):
1. `r = normalizarRepo(valor)`.
2. Se `!REPO_OK.test(r)`: mostra o erro de formato, não grava.
3. Se já está na lista: mostra `${r} já está na lista.`, não grava.
4. Senão grava `[...lista, r].sort()`, limpa o campo, rerenderiza o bloco e Meus PRs, e mostra o toast de inclusão.

Tirar (`.mb-x`): grava a lista sem o repo, rerenderiza e mostra o toast de desbloqueio. Depois de tirar, os PRs desse repo voltam a pedir a mergeabilidade ao GitHub no próximo ciclo; até ela chegar o card mostra o estado que já existe, "Verificando se dá pra mergear…".

Desfazer (botão `.undo` do toast, padrão que já existe): volta a lista anterior e grava de novo.

Contagem por repo (`.mb-meta`): número de PRs da lista de Meus PRs cujo `pr.key.split('#')[0].toLowerCase()` é o repo.

Migração: nenhuma. Quem já tinha a lista em texto continua com o mesmo array.

## 4. Card de Meus PRs

### 4.1 Ordem da decisão

Hoje `repoBlocked` só é lido quando `canMerge` é verdadeiro e nada está rodando. Passa a ser o primeiro teste, porque nesses repos não há mergeabilidade lida e o bloqueio vale com qualquer análise:

```js
const repo = String(pr.key.split('#')[0]);
const repoBlocked = blockedRepos.has(repo.toLowerCase());
let mergeBtns = '';
if (repoBlocked) {
  mergeBtns = btnMerge(true, `Merge bloqueado para ${repo} (lista em Sistema → Automação)`);
} else if (!canMerge && a && a.quality && a.quality.status !== 'eligible') {
  mergeBtns = btnMerge(true, qualityBlockTitle(a.quality));
} else if (canMerge) {
  if (running || queued) mergeBtns = btnMerge(true, 'Aguarde a análise terminar');
  else if (mergeBlockedByPolicy.has(pr.key)) mergeBtns = btnOptions();
  // ...o resto da cadeia sem mudança, só sem o ramo antigo de repoBlocked
}
```

Consequência: num repo bloqueado sem análise, o card mostra o Merge desativado com o motivo, em vez de não mostrar botão.

### 4.2 Título exato do botão

```
Merge bloqueado para acme/web (lista em Sistema → Automação)
```

(Passa por `esc()` dentro de `btnMerge`, como hoje.)

### 4.3 Motivo visível com atalho

Logo depois do `.pr-actions` do card, só quando `repoBlocked`:

```js
const notaBloq = repoBlocked
  ? `<p class="mypr-merge-nota">Merge bloqueado neste repo. <span class="is-goto" data-goto="sys:automation:#sys-row-mergeblocked" role="button" tabindex="0" title="Abrir Sistema → Automação">Ver a lista em Sistema → Automação</span></p>`
  : '';
```

Ao chegar, o alvo `#sys-row-mergeblocked` recebe `.pulse-focus` (o mesmo pulso dos deep-links de alerta). Se o handler de `data-goto` já faz isso, nada a acrescentar.

### 4.4 Menu ⋯ do card

Repo livre: entra um item novo em `.pr-menu`, entre os itens que já existem e o Ocultar:

```html
<button type="button" class="act-merge-block" data-repo="acme/api">Bloquear Merge neste repo</button>
```

Clique: inclui o repo pela mesma função da seção 3, fecha o menu e mostra o toast de bloqueio pelo card.

Repo bloqueado: no lugar do item acima, um atalho. Não há "Desbloquear" no card.

```html
<button type="button" data-goto="sys:automation:#sys-row-mergeblocked">Editar repos bloqueados (Sistema → Automação)</button>
```

## 5. Busca de configurações

Entrada nova no índice usado por "Buscar configuração...", no formato das outras entradas:

```js
{
  id: 'sys-row-mergeblocked',
  section: 'automation',
  title: 'Repos bloqueados pra merge',
  sub: 'Desativa o botão Merge de Meus PRs nos repos da lista',
  terms: ['merge', 'mergear', 'bloqueio', 'bloqueado', 'bloqueados', 'bloquear', 'repo', 'repos', 'repositório', 'repositorios']
}
```

No resultado (`.sys-hit`), o selo `.sys-hit-sec` mostra `Automação`. O clique leva a `sys:automation:#sys-row-mergeblocked`. Na sidebar, Automação recebe `.match` quando a entrada casa.

Teste: os termos `merge`, `bloqueio` e `repo` precisam devolver esta entrada.

## 6. Atalho de Entregas

Antes: `confira as organizações monitoradas em Sistema`

Depois:

```html
confira as organizações de cada conta em <span class="is-goto" data-goto="sys:accounts:#accountsManager" role="button" tabindex="0" title="Abrir Sistema → Contas">Sistema → Contas</span>
```

## 7. CSS novo

Vai no `app.css`, junto das regras de "sistema: linhas de configuração". Só tokens existentes; claro e escuro saem dos tokens, sem regra por tema.

```css
/* ---------- sistema > automação: repos bloqueados pra merge ---------- */
.set-row-block#sys-row-mergeblocked { display: flex; flex-direction: column; gap: 12px; }
.mb-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mb-title .count { font-weight: 700; }
.mb-empty {
  border: 1px dashed var(--border); border-radius: 10px;
  padding: 12px 14px; font-size: 13px; color: var(--muted); text-wrap: pretty;
}
/* o gap de 1px sobre o fundo --border-soft desenha as divisórias: linha removida
   não deixa borda órfã */
.mb-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 1px;
  background: var(--border-soft); border: 1px solid var(--border-soft);
  border-radius: 10px; overflow: hidden;
}
.mb-item { display: flex; align-items: center; gap: 12px; padding: 7px 7px 7px 12px; background: var(--surface); }
.mb-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mb-repo { background: none; padding: 0; font-size: 12.5px; font-weight: 650; color: var(--text); overflow-wrap: anywhere; }
/* --muted e não --faint: no claro o --faint fica abaixo de 4,5:1 sobre --surface */
.mb-meta { font-size: 12px; color: var(--muted); }
.mb-x { flex: none; }
.mb-add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mb-input {
  flex: 1 1 220px; max-width: 340px; min-width: 0;
  padding: 6px 10px; background: var(--surface-2); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px; font: inherit; font-size: 12.5px;
}
.mb-input::placeholder { color: var(--faint); }
.mb-input:focus { outline: none; border-color: var(--accent); }
.mb-input[aria-invalid="true"] { border-color: var(--danger); }
.mb-erro { margin-top: -6px; font-size: 12px; color: var(--danger); }
.mb-sug { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
.mb-sug-btn {
  display: inline-flex; align-items: center; gap: 4px;
  font: inherit; font-size: 11.5px; color: var(--muted);
  background: var(--surface-2); border: 1px solid var(--border-soft); border-radius: 7px;
  padding: 2px 8px; cursor: pointer;
}
.mb-sug-btn:hover { color: var(--text); border-color: var(--border); }

/* ---------- meus PRs: motivo do Merge bloqueado ---------- */
.mypr-merge-nota { margin: 8px 0 0; font-size: 12px; line-height: 1.45; color: var(--muted); text-wrap: pretty; }

/* ---------- celular ---------- */
@media (max-width: 620px) {
  .mb-input { max-width: none; }
  .mb-input, .mb-add .btn, .mb-x, .mb-sug-btn { min-height: 44px; }
  .mb-x { min-width: 64px; justify-content: center; }
  .mypr-merge-nota .is-goto { display: inline-flex; align-items: center; min-height: 44px; }
  .mypr-card .pr-actions .btn { min-height: 44px; }
  .pr-menu > button, .pr-menu > a { min-height: 44px; }
}
```

`.is-goto`, `.count.ambient`, `.btn.sm`, `.btn.danger-ghost`, `.pr-menu`, `.toast`, `.pulse-focus` e `.sys-hit` já existem e são reaproveitadas como estão.

## 8. Textos exatos

Bloco em Sistema → Automação:

| onde | texto |
|---|---|
| título da seção | Merge em Meus PRs |
| título da linha | Repos bloqueados pra merge |
| contagem | `1 repo` / `N repos` |
| descrição | Nesses repos o botão Merge de Meus PRs fica desativado, para respeitar a regra de review do time, e o Farol deixa de consultar no GitHub se os PRs deles dão para mergear. Vale para todas as contas e não muda nada no GitHub. |
| lista vazia | Nenhum repo bloqueado. O Merge aparece em todos os seus PRs quando a autoanálise diz aprovável e o GitHub deixa mergear. |
| meta por repo | `nenhum PR seu aberto agora` / `1 PR seu aberto` / `N PRs seus abertos` |
| botão por repo | Tirar |
| aria-label do Tirar | Tirar owner/repo da lista |
| placeholder do campo | owner/repo ou URL do repo |
| botão do campo | Bloquear |
| erro de formato | Use o formato owner/repo, como acme/web. |
| erro de repetido | owner/repo já está na lista. |
| rótulo dos atalhos | Dos seus PRs abertos: |
| atalho | + owner/repo |
| aria-label do atalho | Bloquear owner/repo |

Toasts (todos com o botão `Desfazer`):

| quando | texto |
|---|---|
| incluiu, com PRs seus no repo | owner/repo bloqueado. O Merge some de 1 PR seu. / owner/repo bloqueado. O Merge some de N PRs seus. |
| incluiu, sem PRs seus no repo | owner/repo bloqueado. |
| tirou | owner/repo desbloqueado. O Merge volta a valer nos seus PRs desse repo. |
| bloqueou pelo card | Merge bloqueado em owner/repo. Vale para o seu PR aberto nesse repo. / Merge bloqueado em owner/repo. Vale para os N PRs seus abertos nesse repo. |

Card de Meus PRs:

| onde | texto |
|---|---|
| title do Merge desativado | Merge bloqueado para owner/repo (lista em Sistema → Automação) |
| linha de motivo | Merge bloqueado neste repo. |
| atalho da linha | Ver a lista em Sistema → Automação |
| title do atalho | Abrir Sistema → Automação |
| menu ⋯, repo livre | Bloquear Merge neste repo |
| menu ⋯, repo bloqueado | Editar repos bloqueados (Sistema → Automação) |

Busca:

| onde | texto |
|---|---|
| título do resultado | Repos bloqueados pra merge |
| subtítulo | Desativa o botão Merge de Meus PRs nos repos da lista |
| selo | Automação |

Entregas:

| onde | texto |
|---|---|
| atalho | confira as organizações de cada conta em Sistema → Contas |
| title | Abrir Sistema → Contas |

## 9. Checagem

- Lista vazia, 1 e vários repos, claro e escuro, em 1000px e em 390px.
- Incluir por `owner/repo`, por URL do repo e por URL de PR; repetido e formato inválido mostram o erro e não gravam.
- Tirar e Desfazer regravam `config.mergeBlockedRepos` e atualizam Meus PRs sem recarregar.
- Card de repo bloqueado com análise aprovável, reprovada, vencida, rodando e sem análise: sempre Merge desativado com o título da 4.2 e a linha da 4.3.
- O atalho da linha e o do menu abrem Sistema → Automação com o pulso em `#sys-row-mergeblocked`, por clique, Enter e Espaço.
- Busca por `merge`, `bloqueio` e `repo` acha a entrada.
- Nenhum texto novo com travessão.
