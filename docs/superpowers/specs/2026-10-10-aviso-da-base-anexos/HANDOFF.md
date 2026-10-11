# Handoff: aviso de conflito e de PR superado em Meus PRs

Desenho de 10/10/2026. Quadros em `Aviso de base em Meus PRs.dc.html`: os 9 estados no
computador (1280 px) e no celular (360 px), nos temas claro e escuro, e depois o toast e a
notificação do sistema. Nenhuma cor nova entra no app: só um token novo, `--accent-ink` no
claro para o selo e o botão cheios (ver "Contraste").

## Decisões

1. **Três camadas, do longe para o perto.** Barra esquerda do card em `--urgent` (precisa de
   você). Selo na linha da chave ("Em conflito" suave, "Superado pela base" cheio). Abaixo do
   topo, o aviso: uma linha para conflito, um bloco para superado.
2. **Superado é o único selo cheio do card**, porque é o estado mais importante. O bloco traz a
   conclusão, a prova (contagem sempre à vista, lista de arquivos num `<details>`) e a saída.
3. **Fechar no GitHub só abre o PR** (`<a target="_blank">`). Nenhuma escrita nova no Farol.
   *Proposta, para decisão do dono:* um "Fechar pelo Farol" passando pelo gate de escrita. Não
   está desenhado; se entrar, ocupa o lugar deste botão e o texto auxiliar sai.
4. **Superado vence conflito.** Se `superado.veredito === "superado"`, o selo "Em conflito" não
   aparece e o bloco diz que o conflito não precisa ser resolvido.
5. **Inconclusivo aparece como conflito**, sem nenhuma frase sobre a base. `pendentes` não é
   mostrado ao usuário.
6. **Ainda não conferido é silêncio.** Sem "conferindo" no card: o primeiro ciclo leva até
   3 min e o sinal apareceria em todo card, inclusive no caso comum.
7. **Falha mantém o último aviso** e acrescenta uma linha apagada com a idade (`at`) e o motivo.
   Só aparece quando a leitura do ciclo atual falhou.
8. **Ordem fixa no card:** aviso da base, nota de merge bloqueado, painel da autoanálise. O aviso
   tem o marcador (losango âmbar); a nota de merge não tem e fica em `--muted`, recuada 16 px
   para alinhar ao texto do aviso. O painel segue atrás da divisória.
9. **Celular:** o aviso sobe para antes das ações (`order`), então selo, título e aviso ficam
   juntos no alto do card. Links e botões com `min-height: 44px`; "Fechar no GitHub" ocupa a
   linha toda.
10. **Merge com conflito:** quando o Merge aparece (autoanálise aprovável), fica desabilitado
    com `title="O PR tem conflito com a branch de destino"` e `aria-describedby` apontando para o
    aviso. Com o aviso agora visível em todo PR em conflito, o motivo deixa de depender do
    tooltip.
11. **Toast reaberto agrupado:** ao reiniciar, um toast só com tudo o que continua valendo, em
    vez de um por PR.

## Marcação

O card é o `.mypr-card` de hoje. Entram a classe de estado no card, o selo na `.pr-ref` e um
bloco `.mypr-base` filho direto do card, antes de `.mypr-merge-nota` e de `.mypr-analysis`.

```html
<!-- em conflito (e inconclusivo) -->
<article class="card mypr-card base-alerta">
  <div class="mypr-top">
    <span class="avatar">…</span>
    <div class="info">
      <div class="pr-ref">
        <span class="acct-dot"></span>
        <a href="https://github.com/acme-exemplo/web/pull/12" target="_blank" rel="noopener">acme-exemplo/web#12</a>
        <span class="verdict base-conflito">Em conflito</span>
        <span class="acct-chip">Acme</span>
      </div>
      <div class="pr-title">Filtro por data na lista de pedidos</div>
      <div class="pr-branches"><code>feat/filtro-data</code><span class="arrow">→</span><code>develop</code></div>
      <div class="pr-sub">por você · @ana-exemplo · atualizado há 5 h</div>
    </div>
    <div class="pr-actions">…</div>
  </div>
  <div class="mypr-base" id="base-acme-exemplo-web-12">
    <span class="mb-marca" aria-hidden="true"></span>
    <div class="mb-corpo">
      <b>Em conflito com <code>develop</code>.</b> Atualize a branch antes do merge.
      <a class="mb-link" href="https://github.com/acme-exemplo/web/pull/12" target="_blank" rel="noopener">Abrir no GitHub ↗</a>
      <!-- só com parte na base -->
      <div class="mb-extra">1 dos 4 arquivos que ele muda já está igual em <code>main</code>.</div>
      <!-- só com leitura falhada -->
      <div class="mb-extra">Visto há 20 min. A leitura de agora falhou: @ana-exemplo está sem token.</div>
    </div>
  </div>
  <p class="mypr-merge-nota">…</p>
  <div class="mypr-analysis">…</div>
</article>

<!-- superado -->
<article class="card mypr-card base-alerta">
  <div class="mypr-top">… <span class="verdict base-superado">Superado pela base</span> …</div>
  <div class="mypr-superado">
    <div class="ms-titulo">Nada para entregar: tudo o que este PR muda já está em <code>staging</code>.</div>
    <div class="ms-prova">Conferido no código: dos 7 arquivos que ele muda, 5 estão idênticos em <code>staging</code>
      e 2 têm todas as linhas dele, mais mudanças da própria base.
      O conflito com <code>staging</code> não precisa ser resolvido.</div>
    <details class="ms-arquivos">
      <summary>Ver os 7 arquivos</summary>
      <div class="ms-grupos">
        <div><b>Idênticos na base (5)</b><ul><li>src/relatorios/vendas.ts</li>…</ul></div>
        <div><b>Mesmas linhas, base tem mais (2)</b><ul><li>package.json</li><li>package-lock.json</li></ul></div>
      </div>
    </details>
    <div class="ms-saida">
      <a class="btn sm primary ms-fechar" href="https://github.com/acme-exemplo/app/pull/57" target="_blank" rel="noopener">Fechar no GitHub ↗</a>
      <span>Dá para fechar sem merge. O link abre o PR; quem fecha é você, lá.</span>
    </div>
  </div>
</article>
```

A lista de arquivos depende de o engine devolver os caminhos por grupo (hoje o snapshot traz
só as contagens). Sem os caminhos, o `<details>` não é renderizado; a contagem basta.

Branch é texto (`<code>`), PR é link. Oculto: a classe `.oculto` de hoje no card, sem mudança no
aviso; o botão vira Mostrar.

## CSS

Só tokens existentes (`--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--faint`,
`--accent`, `--accent-soft`, `--accent-text`, `--info`, `--urgent`). Colar no fim de `ui/app.css`.

```css
/* ---------- meus PRs: aviso da base (Claude Design, 10/10/2026) ---------- */
/* âmbar cheio no claro: #e08700 com texto branco dá 2,6:1. Com #201302 dá 7:1. Só o selo
   superado e o botão Fechar usam; o .btn.primary do resto do app não muda. */
:root { --accent-fill-ink: var(--accent-ink); }
:root[data-theme="light"] { --accent-fill-ink: #201302; }

.mypr-card.base-alerta { border-left-color: var(--urgent); }

.verdict.base-conflito { color: var(--accent-text); background: var(--accent-soft); }
.verdict.base-superado { color: var(--accent-fill-ink); background: var(--accent); }

.mypr-base {
  margin-top: 10px; display: flex; gap: 9px; align-items: baseline;
  font-size: 12.5px; line-height: 1.45; color: var(--text);
}
.mypr-base .mb-marca {
  width: 7px; height: 7px; flex: none; background: var(--accent);
  transform: rotate(45deg); position: relative; top: -1px;
}
.mypr-base .mb-corpo { min-width: 0; text-wrap: pretty; overflow-wrap: anywhere; }
.mypr-base b { font-weight: 650; }
.mypr-base code { font-size: 11.5px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 5px; padding: 0 5px; font-weight: 500; }
.mypr-base .mb-link { color: var(--info); font-weight: 600; }
.mypr-base .mb-extra { margin-top: 2px; font-size: 12px; color: var(--muted); }
.mypr-base .mb-extra code { background: none; border: 0; padding: 0; font-size: 11px; }
/* nota de merge logo depois do aviso: alinha com o texto, não com o marcador */
.mypr-base + .mypr-merge-nota { margin-top: 6px; padding-left: 16px; }

.mypr-superado {
  margin-top: 12px; padding: 12px 14px; border-radius: 10px;
  background: var(--surface-2); border: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 8px;
}
.mypr-superado code { background: var(--surface); border: 1px solid var(--border); border-radius: 5px; padding: 0 5px; }
.ms-titulo { font-size: 13.5px; font-weight: 650; line-height: 1.4; text-wrap: pretty; }
.ms-titulo code { font-size: 12px; font-weight: 500; }
.ms-prova { font-size: 12.5px; line-height: 1.5; text-wrap: pretty; }
.ms-prova code { background: none; border: 0; padding: 0; font-size: 11.5px; }
.ms-arquivos { font-size: 12.5px; }
.ms-arquivos summary {
  width: fit-content; cursor: pointer; font-weight: 600; color: var(--text);
  text-decoration: underline dotted var(--faint); text-underline-offset: 3px;
}
.ms-grupos { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 24px; margin-top: 8px; }
.ms-grupos b { font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
.ms-grupos ul { list-style: none; margin: 4px 0 0; padding: 0; font-family: "Cascadia Code", Consolas, "SF Mono", Menlo, monospace; font-size: 11.5px; overflow-wrap: anywhere; }
.ms-saida { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding-top: 8px; border-top: 1px solid var(--border); }
.ms-saida > span { font-size: 12px; color: var(--muted); text-wrap: pretty; }
.ms-fechar { color: var(--accent-fill-ink); text-decoration: none; }

.toast.base { border-left: 3px solid var(--accent); }
.toast.base .t-titulo { font-weight: 650; }
.toast.base .t-pr { color: var(--text); font-weight: 600; text-decoration: underline dotted var(--faint); text-underline-offset: 2px; }
.toast.base .t-acao { color: var(--accent-text); font-weight: 650; background: none; border: 0; padding: 0; cursor: pointer; }

@media (max-width: 720px) {
  /* o aviso sobe para antes das ações: selo, título e aviso juntos no alto do card */
  .mypr-card .mypr-top { display: contents; }
  .mypr-card { display: flex; flex-wrap: wrap; column-gap: 14px; }
  .mypr-card .info { flex: 1 1 0; }
  .mypr-card .mypr-base, .mypr-card .mypr-superado, .mypr-card .mypr-merge-nota { order: 2; flex: 1 1 100%; }
  .mypr-card .pr-actions { order: 3; flex: 1 1 100%; margin-top: 12px; }
  .mypr-card .mypr-analysis { order: 4; flex: 1 1 100%; }
  .mypr-base .mb-link, .ms-arquivos summary { display: inline-flex; align-items: center; min-height: 44px; }
  .ms-fechar { flex: 1 1 100%; justify-content: center; min-height: 44px; }
  .toast.base .t-acao, .toast.base .t-fechar { min-height: 44px; min-width: 44px; }
}
```

Se o `display: contents` na `.mypr-top` mexer em outros layouts do card, a alternativa é
renderizar o aviso no DOM entre `.info` e `.pr-actions` só no celular.

## Contraste (AA)

- Selo "Em conflito": `--accent-text` sobre `--accent-soft`. Claro #9a5900, escuro #ffb454.
- Selo superado e botão Fechar: `--accent-fill-ink` sobre `--accent`. Claro #201302 sobre
  #e08700 (7:1), escuro #201302 sobre #ffb454.
- Linha extra e texto auxiliar: `--muted` sobre `--surface` e `--surface-2`, acima de 4,5:1 nos
  dois temas. `--faint` só em sublinhado, nunca em texto.
- "Ver os 7 arquivos" usa `--text` com sublinhado pontilhado: `--info` sobre `--surface-2` no
  claro fica em 4,4:1.
- Foco: o `:focus-visible` global do app (contorno `--accent`).

## Texto de cada estado

`{base}` = `baseDosMeusPRs[pr].base`. `{pr}` = chave completa (`acme-exemplo/app#57`).

**01 sem aviso** (`conflito: false` e veredito diferente de `superado`): nada.

**02 em conflito** (`conflito: true`, veredito `nao`)
- Selo: `Em conflito`
- Linha: **`Em conflito com {base}.`** `Atualize a branch antes do merge.` `Abrir no GitHub ↗`

**03 em conflito, parte já está na base** (`conflito: true`, veredito `nao`, `iguais + contidos > 0`)
- Selo e linha: como 02.
- Extra, singular: `1 dos 4 arquivos que ele muda já está igual em {base}.`
- Extra, plural: `3 dos 7 arquivos que ele muda já estão iguais em {base}.`
  (contagem = `iguais + contidos`, de `total`)

**04 superado pela base** (veredito `superado`, com ou sem conflito)
- Selo: `Superado pela base`
- Título: `Nada para entregar: tudo o que este PR muda já está em {base}.`
- Prova: `Conferido no código: dos {total} arquivos que ele muda, {iguais} estão idênticos em {base} e {contidos} têm todas as linhas dele, mais mudanças da própria base.`
  - Só idênticos: `Conferido no código: os {total} arquivos que ele muda estão idênticos em {base}.`
  - Só contidos: `Conferido no código: os {total} arquivos que ele muda têm todas as linhas dele em {base}, mais mudanças da própria base.`
  - Singular: `1 está idêntico`, `1 tem todas as linhas dele`.
- Se `conflito: true`, no fim da prova: `O conflito com {base} não precisa ser resolvido.`
- Lista: `Ver os {total} arquivos`; grupos `Idênticos na base ({iguais})` e `Mesmas linhas, base tem mais ({contidos})`.
- Saída: botão `Fechar no GitHub ↗`; ao lado `Dá para fechar sem merge. O link abre o PR; quem fecha é você, lá.`

**05 não deu para conferir** (`conflito: true`, veredito `inconclusivo`): igual a 02, sem extra.

**06 ainda não conferido** (sem entrada no snapshot): nada.

**07 conta sem token ou busca falhou** (ciclo falhou, existe aviso anterior): o último aviso,
mais o extra:
- Sem token: `Visto há {idade}. A leitura de agora falhou: @{conta} está sem token.`
- Busca falhou: `Visto há {idade}. A leitura de agora falhou no GitHub.`
- `{idade}` a partir de `at`: `1 min`, `20 min`, `2 h`, `1 dia`.
Sem aviso anterior, nada (como 06).

**08 PR oculto:** o aviso do estado vale igual, dentro do card `.oculto`. Botão `Mostrar`.

**09 com outras notas:** cada uma com o seu texto, na ordem aviso, nota de merge, painel. Merge
desabilitado com `title`: `O PR tem conflito com a branch de destino`.

## Toast (dentro do app)

Uma vez por PR e commit. Não some sozinho enquanto o ponteiro ou o foco estiver nele. A chave
do PR é link para o GitHub; "Ver em Meus PRs" abre a aba e rola até o card.

- Superado. Título `PR superado pela base`. Corpo `{pr}: tudo o que ele muda já está em {base}. Não sobrou nada para entregar, dá para fechar sem merge.` Ação `Ver em Meus PRs`.
- Conflito. Título `PR em conflito`. Corpo `{pr}: em conflito com {base}. Atualize a branch antes do merge.` Ação `Ver em Meus PRs`.
- Ao reabrir, mais de um. Título `{n} PRs seus precisam de você por causa da base`. Uma linha por PR, chave curta (`app#57`):
  - `{repo}#{n} superado pela base, dá para fechar`
  - `{repo}#{n} em conflito com {base}`
  Ação `Ver em Meus PRs`. Com um só, usa o toast individual.
- Botão de fechar: `×`, `aria-label="Fechar aviso"`. Toast em `role="status"`.
- Celular: largura toda, alvos de 44 px. É o único aviso lá.

## Notificação do sistema (Windows e macOS)

O sistema já mostra "Farol" no cabeçalho, então o título não repete o nome.

- Superado. Título `PR superado pela base`. Corpo `{pr}: tudo o que ele muda já está em {base}. Não sobrou nada para entregar, dá para fechar sem merge.`
- Conflito. Título `PR em conflito`. Corpo `{pr}: em conflito com {base}. Atualize a branch antes do merge.`
- Ao reabrir, mais de um. Título `{n} PRs precisam de você por causa da base`. Corpo com as chaves curtas separadas por ponto e vírgula: `app#57 superado pela base; web#12 em conflito com develop.`
- Clique: abre o app no card do PR; no agrupado, em Meus PRs.

Se o Electron mostrar outro nome no cabeçalho (build de desenvolvimento), voltar ao prefixo
`Farol · ` no título.

