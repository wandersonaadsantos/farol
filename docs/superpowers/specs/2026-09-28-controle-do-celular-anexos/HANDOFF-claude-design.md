# Handoff: controlar o celular pelo computador (Farol 2.65)

Quadros: `Farol Controle do Celular.dc.html` (1a a 1n). A tela em si está em `TelaFarol.dc.html`, com um cenário por quadro.
Tudo abaixo usa só os tokens que já existem em `app.css`. Nenhuma cor, fonte ou ícone novo.

## 1. Decisões

- **Onde mora:** sub-aba nova do Radar, **Aparelhos**, entre "Pra mim" e "Meus PRs". A contagem da sub-aba é a soma de "Pedem você" de todos os executores (âmbar se maior que zero; sem contagem se não houver executor).
- **"Pra mim"** continua com "Sua fila". Abaixo dela, **Seus aparelhos**: uma linha por executor, com "Abrir o aparelho". Some quando não há executor.
- **Seções atuais do conjunto:**
  - "Precisa de você em todos os aparelhos" vira o grupo **Pedem você** de cada aparelho.
  - "Em outros aparelhos" vira o grupo **Revisando agora** de cada aparelho.
  - "Esperando colocação no conjunto" fica em "Pra mim" (o item ainda não é de nenhum aparelho).
  - "Revisões de todos os aparelhos" vira o grupo **Revisados e ignorados** de cada aparelho; o consolidado segue no Panorama.
- **Um, dois ou três executores:** com dois ou mais, uma faixa de aparelhos (`.apar-troca`) no topo troca a página inteira. Com um, a faixa não aparece.
- **Agrupamento:** grupos fixos, nesta ordem. Filtro por grupo em chips com contagem. Ocultos ficam fora, com "Mostrar ocultos (n)" no fim.
- **Retorno dos comandos:** na linha do PR (ou ao lado do campo, em Contas) e no histórico **Comandos enviados**, no fim da página.
- **Sistema > Aparelhos** continua sendo onde se renomeia, aposenta e designa admin. Pausar e teto aparecem nos dois lugares, com o mesmo comando.

## 2. Estrutura da página (marcação)

```html
<!-- Radar > sub-abas -->
<div class="subtabs" role="tablist" aria-label="Radar">
  <button role="tab" aria-selected="false" class="subtab">Pra mim <span class="count">2</span></button>
  <button role="tab" aria-selected="true"  class="subtab active">Aparelhos <span class="count">2</span></button>
  <button role="tab" aria-selected="false" class="subtab">Meus PRs <span class="count ambient">4</span></button>
  <button role="tab" aria-selected="false" class="subtab">Panorama <span class="count ambient">23</span></button>
</div>

<!-- só com 2 ou mais executores -->
<div class="apar-troca" role="tablist" aria-label="Aparelhos">
  <button role="tab" aria-selected="true" class="apar-troca-item active">
    <span class="apar-dot vivo"></span>
    <span><b>Celular da Ana</b><small>Android · 2 pedem você</small></span>
  </button>
  <button role="tab" aria-selected="false" class="apar-troca-item">…Notebook velho…</button>
</div>

<!-- painel do aparelho -->
<section class="card apar-painel" aria-label="Painel do aparelho">
  <div class="apar-topo">
    <div>
      <div class="apar-nome"><h2>Celular da Ana</h2><span class="pill ok">vivo</span></div>
      <div class="apar-linha">Android · Farol 2.64.2 · visto há 6 s</div>
    </div>
    <div class="row-actions">
      <label class="apar-teto">Ao mesmo tempo <select>…1 a 4…</select></label>
      <button class="btn">Pausar</button>
    </div>
  </div>
  <div class="apar-fatos">
    <div class="apar-fato"><span class="rot">Agora</span><b>Revisando 1 de 2</b><small>teto de 2 ao mesmo tempo</small></div>
    <div class="apar-fato"><span class="rot">IA</span><b class="ok">Pronta</b><small>Claude Code instalado e logado</small></div>
    <div class="apar-fato"><span class="rot">Comandos do admin</span><b class="ok">Aceita</b><small>ligado no celular em 12/09</small></div>
    <div class="apar-fato"><span class="rot">Versão</span><b>Farol 2.64.2</b><small>em dia</small></div>
  </div>
  <div class="apar-extra">
    <div><span class="rot">Contas do GitHub nele</span>
      <div><a class="person-mention" href="https://github.com/ana-exemplo">@ana-exemplo</a> <span class="sync-chip ok">token válido</span></div>
      <div><a class="person-mention" href="https://github.com/ana-pessoal">@ana-pessoal</a> <span class="sync-chip bad">token expirado</span></div>
    </div>
    <div><span class="rot">Falhas recentes</span>
      <div><span class="sync-chip bad">limite do plano</span> hoje 19:02 em <a class="pr-ref-mention" href="…/app-mobile/pull/74">app-mobile#74</a></div>
    </div>
  </div>
</section>

<!-- aviso (sem comandos / sem sinal) -->
<div class="apar-aviso warn" role="status">
  <b>Este celular não aceita comandos do admin</b>
  <p>Tudo continua visível aqui, mas as ações ficam desligadas até você ligar isso no próprio celular:</p>
  <p><code>Sistema &gt; Aparelhos &gt; Aceitar políticas e comandos do admin</code> Só precisa fazer uma vez.</p>
</div>

<!-- fila -->
<section aria-label="Fila do celular">
  <div class="section-head"><h2>Fila do Celular da Ana <span class="count ambient">12</span></h2>
    <span class="section-sub">publicada às 22:23 · atualiza a cada 10 s</span></div>
  <div class="fila-filtros" role="toolbar" aria-label="Filtrar por estado">
    <button class="fila-filtro active" aria-pressed="true">Tudo <span>12</span></button>
    <button class="fila-filtro" aria-pressed="false">Pedem você <span class="urg">2</span></button>
    …
  </div>
  <div class="fila-grupo">
    <div class="fila-grupo-head"><h3>Pedem você</h3><span class="sync-chip warn">2</span><span class="section-sub">O aparelho revisou e espera sua decisão.</span></div>
    <div class="cards">
      <article class="card fila-item" data-estado="decidir">
        <a class="avatar" href="https://github.com/bruno-exemplo" aria-label="Perfil de @bruno-exemplo"><img src="…" alt=""></a>
        <div class="info">
          <div class="pr-ref"><a class="pr-ref-mention" href="https://github.com/acme-exemplo/loja-api/pull/418">acme-exemplo/loja-api#418</a><span class="acct-chip">ana-exemplo</span></div>
          <div class="pr-title">fix(pagamento): tratar estorno parcial duplicado</div>
          <div class="pr-sub"><a class="person-mention" href="…"><span class="avatar xs"><img …></span><span class="pm-login">@bruno-exemplo</span></a> · pedido há 3 h</div>
          <div class="fila-estado"><span class="sync-chip warn">decidir</span><span>revisado: aprovar, 3 motivos</span></div>
          <!-- opcional: .fila-ao-vivo (ol), .fila-decisao, .cmd-retorno -->
        </div>
        <div class="pr-actions">
          <button class="btn sm primary" aria-label="Decidir: loja-api#418">Decidir</button>
          <button class="btn sm">Ver review completo</button>
        </div>
      </article>
    </div>
  </div>
  <button class="mypr-hidden-toggle">Mostrar ocultos (1)</button>
</section>

<!-- retorno de comando dentro do item -->
<div class="cmd-retorno" role="status">
  <span class="sync-chip info"><i class="cmd-dot"></i>enviado</span>
  <span>Revisar agora, enviado às 22:23. O celular aplica no próximo ciclo, em até 10 s.</span>
</div>

<!-- contas -->
<section aria-label="Contas do celular">
  <div class="card conta-remota">
    <div class="conta-remota-head"><a class="person-mention" href="…">@ana-exemplo</a><span class="sync-chip mute">trabalho</span></div>
    <div class="conta-campo">
      <div><div>Revisar sozinho</div></div>
      <div class="seg" role="radiogroup" aria-label="Revisar sozinho">
        <button role="radio" aria-checked="true" class="active">Sim</button><button role="radio" aria-checked="false">Não</button>
      </div>
    </div>
    <div class="conta-campo">
      <div><div>Aprovável sem ressalvas</div><div class="conta-aviso">o aparelho posta a aprovação sozinho no GitHub</div></div>
      <select aria-label="Aprovável sem ressalvas">…</select>
      <span class="sync-chip info" role="status">enviado</span>
    </div>
  </div>
</section>

<!-- histórico -->
<section aria-label="Comandos enviados">
  <div class="card cmd-lista">
    <div class="cmd-linha"><span class="cmd-hora">22:15</span><span><b>Revisar agora</b> <a href="…">loja-api#409</a></span>
      <span><span class="sync-chip bad">recusado</span> outra pessoa pegou este PR, e lá o Farol saiu de cena</span></div>
  </div>
</section>

<!-- confirmação -->
<div class="modal-fundo">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-auto">
    <h2 id="dlg-auto">Deixar o Celular da Ana aprovar sozinho?</h2>
    <p>…</p><ul>…</ul>
    <div class="row-actions"><button class="btn" autofocus>Manter esperando você</button><button class="btn primary">Ligar a aprovação automática</button></div>
  </div>
</div>
```

Estados de carregar, falhar, vazio e versão antiga trocam só o miolo da `<section aria-label="Fila do celular">` por `.fila-carregando` (com `aria-busy="true"`), `.fila-falhou` (`role="alert"`), `.fila-vazia` ou `.fila-antiga`. Os três primeiros nunca compartilham texto nem cor.

## 3. CSS (acrescentar ao app.css)

```css
/* ---------- Radar > Aparelhos ---------- */
.subtabs { display: flex; gap: 2px; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); width: fit-content; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.subtab { flex: none; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 9px; padding: 7px 14px; background: transparent; color: var(--muted); font-weight: 550; font-size: 13.5px; cursor: pointer; }
.subtab:hover { color: var(--text); }
.subtab.active { background: var(--surface-2); color: var(--text); font-weight: 650; }

.apar-troca { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--sp-2); margin-top: var(--sp-4); }
.apar-troca-item { display: flex; gap: 10px; align-items: center; text-align: left; min-height: 44px; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); cursor: pointer; }
.apar-troca-item.active { border-color: var(--accent); background: var(--surface-2); }
.apar-troca-item small { display: block; color: var(--muted); font-size: 12px; }
.apar-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--ok); }
.apar-dot.pausado, .apar-dot.antigo { background: var(--accent); }
.apar-dot.sem-sinal { background: var(--danger); }

.apar-painel { margin-top: var(--sp-4); padding: 16px 18px; }
.apar-topo { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
.apar-nome { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.apar-nome h2 { margin: 0; font-size: 18px; font-weight: 650; }
.apar-linha { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.apar-teto { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; }
.apar-fatos { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1px; margin-top: 16px; background: var(--border); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.apar-fato { background: var(--surface); padding: 10px 12px; display: flex; flex-direction: column; }
.apar-fato small { font-size: 12px; color: var(--muted); }
.apar-fato b.ok { color: var(--ok); } .apar-fato b.bad { color: var(--danger); } .apar-fato b.warn { color: var(--accent); }
.rot { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.apar-extra { display: flex; flex-wrap: wrap; gap: 14px 28px; margin-top: var(--sp-3); font-size: 13px; }

.apar-aviso { margin-top: 12px; padding: 12px 16px; border-radius: var(--radius); font-size: 13.5px; }
.apar-aviso b { font-weight: 650; }
.apar-aviso p { margin: 0; color: var(--text); }
.apar-aviso.warn { background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
.apar-aviso.warn b { color: var(--accent); }
.apar-aviso.bad { background: var(--danger-soft); border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); }
.apar-aviso.bad b { color: var(--danger); }

.fila-filtros { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.fila-filtro { display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px; border-radius: 99px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.fila-filtro.active { border-color: var(--accent); background: var(--surface-2); color: var(--text); }
.fila-filtro span { font-size: 10.5px; font-weight: 700; border-radius: 99px; padding: 0 7px; background: var(--border); color: var(--muted); }
.fila-filtro span.urg { background: var(--accent-soft); color: var(--accent); }
.fila-grupo { margin-top: var(--sp-4); }
.fila-grupo-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.fila-grupo-head h3 { margin: 0; font-size: 13.5px; font-weight: 650; }

/* barra esquerda = estado, pelas cores por significado */
.fila-item { display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: flex-start; border-left: 3px solid var(--ambient); padding: 12px 14px; }
.fila-item .info { flex: 1 1 300px; min-width: 0; }
.fila-item .pr-actions { flex-wrap: wrap; }
.fila-item[data-estado="decidir"], .fila-item[data-estado="sem-automatica"] { border-left-color: var(--urgent); }
.fila-item[data-estado="revisando"], .fila-item[data-estado="retry"] { border-left-color: var(--working); }
.fila-item[data-estado="estacionado"] { border-left-color: var(--blocked); }
.fila-item[data-estado="visto"] { border-left-color: var(--settled); }
.fila-item[data-estado="ignorado"], .fila-item[data-estado="oculto"] { opacity: .72; }
.fila-estado { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px; font-size: 12.5px; color: var(--muted); }
.fila-sem-acao { color: var(--muted); font-size: 12px; max-width: 220px; }
.fila-ao-vivo { margin: 8px 0 0; padding: 8px 10px 8px 30px; background: var(--surface-2); border-radius: 8px; font-family: "Cascadia Code", Consolas, monospace; font-size: 11.5px; color: var(--muted); }
.fila-decisao { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); }

.cmd-retorno { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; font-size: 12.5px; }
.cmd-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.sync-chip.info .cmd-dot { animation: pulse 1.6s infinite; }
.cmd-lista { padding: 2px 16px; }
.cmd-linha { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; padding: 10px 0; font-size: 12.5px; }
.cmd-linha + .cmd-linha { border-top: 1px solid var(--border-soft); }
.cmd-hora { width: 40px; flex: none; color: var(--muted); font-variant-numeric: tabular-nums; }

.conta-remota-head { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.conta-campo { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; padding: 8px 0; border-top: 1px solid var(--border-soft); }
.conta-campo > div:first-child { flex: 1 1 200px; min-width: 0; font-size: 13.5px; }
.conta-aviso { font-size: 12px; color: var(--accent); }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 9px; overflow: hidden; }
.seg button { border: 0; padding: 5px 16px; background: var(--surface); color: var(--muted); font-weight: 600; cursor: pointer; }
.seg button.active { background: var(--accent); color: var(--accent-ink); }

.modal-fundo { position: fixed; inset: 0; background: rgba(5, 8, 14, .62); display: flex; justify-content: center; align-items: flex-start; padding: 16vh 16px 16px; z-index: 50; }
.modal { width: 100%; max-width: 520px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 20px 22px; }
.modal h2 { margin: 0 0 8px; font-size: 17px; }
.modal ul { color: var(--muted); font-size: 13px; padding-left: 18px; }
.modal .row-actions { justify-content: flex-end; flex-wrap: wrap; }

.fila-carregando > div { height: 84px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); animation: pulse 1.4s ease-in-out infinite; }
.fila-falhou { background: var(--danger-soft); border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); border-radius: var(--radius); padding: 16px 18px; }
.fila-falhou b { color: var(--danger); }
.fila-antiga { background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); border-radius: var(--radius); padding: 16px 18px; }
.fila-antiga b { color: var(--accent); }

/* desligado por motivo: o title e o aviso dizem o porquê */
.btn:disabled[title], select:disabled, .seg button:disabled { cursor: not-allowed; }

@media (max-width: 720px) {
  .fila-item .pr-actions { flex-basis: 100%; }
  .btn, .fila-filtro, .subtab, .seg button, select, .apar-troca-item { min-height: 44px; }
}
```

Contraste: todos os textos sobre `--*-soft` usam a cor cheia do mesmo token, como `.sync-chip` e `.count` já fazem. Nada de texto em `--faint`.

## 4. Textos exatos

### Sub-abas
`Pra mim` · `Aparelhos` · `Meus PRs` · `Panorama`

### Pra mim > Seus aparelhos
- Título: `Seus aparelhos` · lateral: `atualiza a cada 10 s`
- Descrição: `O que cada executor está fazendo e o que espera por você. Decidir, mexer na fila e configurar ficam na página de cada um.`
- Linha: `Celular da Ana` `Android · vivo · visto há 6 s` / `revisando 1 de 2 · 3 na fila · 4 parados` / chip `2 pedem você`
- Botão: `Abrir o aparelho`
- Colocação: título `Esperando colocação no conjunto`, descrição `PRs pedidos a contas que estão em mais de um aparelho. Nenhum pegou ainda.`, botão `Começar em um aparelho…`

### Faixa de aparelhos (2 ou mais)
`Celular da Ana` / `Android · 2 pedem você` · `Notebook velho` / `Windows 10 · nada pede você`

### Painel do aparelho
- Pill: `vivo` (ok) · `pausado pelo admin` (warn) · `sem sinal há 2 h` (err) · `versão antiga` (warn) · `lendo…` (neutro) · `sem leitura` (neutro)
- Linha: `Android · Farol 2.64.2 · visto há 6 s` · sem sinal: `Android · Farol 2.64.2 · visto às 20:21, há 2 h`
- Controles: `Ao mesmo tempo` (select 1 a 4) · `Pausar` / `Retomar`
- Fatos:
  - `Agora`: `Revisando 1 de 2` / `teto de 2 ao mesmo tempo` · pausado: `Pausado pelo admin` / `termina o que começou e não pega PR novo` · sem sinal: `Sem sinal` / `às 20:21 revisava 1 de 2`
  - `IA`: `Pronta` / `Claude Code instalado e logado` · não pronta: `Não está pronta` / `instale e faça login no Claude Code no celular`
  - `Comandos do admin`: `Aceita` / `ligado no celular em 12/09` · `Não aceita` / `só se liga no próprio celular`
  - `Versão`: `Farol 2.64.2` / `em dia`
  - Versão antiga: `Versão` `Farol 2.58.0` / `precisa da 2.64.2 ou mais nova` · `Comandos do admin` `Indisponíveis` / `esta versão não recebe comandos` · `Fila` `Não publicada` / `aparece depois de atualizar`
- `Contas do GitHub nele`: `@ana-exemplo` `token válido` · `@ana-pessoal` `token expirado`
- `Falhas recentes`: `limite do plano` hoje 19:02 em app-mobile#74 · `credencial expirada` hoje 17:40 em site-institucional#12 · `falhou ao abrir a sessão` ontem 14:10 em loja-web#219 · vazio: `Nenhuma nas últimas 24 h.`

### Avisos
- Sem comandos: título `Este celular não aceita comandos do admin`; texto `Tudo continua visível aqui, mas as ações ficam desligadas até você ligar isso no próprio celular:`; caminho `Sistema > Aparelhos > Aceitar políticas e comandos do admin`; fim `Só precisa fazer uma vez.`
  - title dos controles: `Este celular não aceita comandos do admin. Ligue no próprio celular, em Sistema > Aparelhos.`
- Sem sinal: título `Sem sinal há 2 h`; texto `O celular foi visto pela última vez às 20:21. A fila abaixo é a última que ele publicou e pode ter mudado desde então. As ações voltam quando ele der sinal.`
  - title dos controles: `Sem sinal há 2 h: o comando venceria antes de chegar.`
- Versão antiga, title: `Atualize o Farol no celular para mandar comandos.`

### Cabeçalho da fila
- Título: `Fila do Celular da Ana` · sem sinal: `Última fila conhecida`
- Lateral: `publicada às 22:23 · atualiza a cada 10 s` · `publicada às 20:21, há 2 h` · `primeira leitura` · `leitura falhou às 22:20` · `não publicada nesta versão`
- Filtros: `Tudo` · `Pedem você` · `Revisando` · `Na fila` · `Parados` · `Feitos`
- Grupos:
  - `Pedem você` · `O aparelho revisou e espera sua decisão.`
  - `Revisando agora` · `Ao vivo, atualiza a cada 10 s.`
  - `Na fila` · `Ainda não começaram.`
  - `Parados` · `Não andam sozinhos. Cada um diz o porquê.`
  - `Revisados e ignorados` · `Saíram da fila.`
- Ocultos: `Mostrar ocultos (1)` / `Esconder ocultos (1)`

### Miolo da fila (sem lista)
- Carregando: `Lendo a fila do Celular da Ana pela primeira vez…`
- Falhou: título `Não deu para ler a fila do Celular da Ana`; texto `O banco não respondeu em 15 s (tentativa das 22:20). Isso não quer dizer que a fila está vazia: o celular pode ter PRs esperando.`; botão `Tentar de novo`
- Vazia: título `Nada na fila do Celular da Ana`; texto `Nenhum PR pedido a @ana-exemplo ou @ana-pessoal espera revisão. Leitura das 22:23.`
- Versão antiga: título `Atualize o Farol no celular`; texto `Este celular está na versão 2.58.0, que ainda não publica a fila nem aceita comandos do admin. Por isso não há fila para mostrar aqui, e não é que ela esteja vazia. Atualize para a 2.64.2 ou mais nova no próprio celular; depois disso a fila aparece sozinha.`
- Nenhum executor: título `Só este computador no conjunto`; texto `Nenhum outro aparelho está ligado à sua sincronização. Quando você abrir o Farol num celular ou notebook com a mesma sincronização, ele aparece aqui com a fila, o estado e as contas dele.`; botão `Adicionar aparelho em Sistema`

### Estados de cada PR

| grupo | chip (`.sync-chip`) | frase | botões |
|---|---|---|---|
| Pedem você | `decidir` (warn) | `revisado: aprovar, 3 motivos` | `Decidir` (primary) · `Ver review completo` |
| Revisando agora | `revisando` (info) | `revisando agora, 2 min, lendo o diff · Opus 5.5` | `Ver ao vivo` · `Transferir` · `Cancelar` |
| Na fila | `esperando` (mute) | `na fila, a revisão automática vai pegar` | `Revisar agora` (primary) · `Ignorar` |
| Na fila | `sem automática` (warn) | `a conta ana-pessoal não revisa sozinha` | `Revisar agora` (primary) · `Ignorar` · `Ligar a automática da conta` |
| Na fila | `nova tentativa` (info) | `esperando nova tentativa depois de falha de rede, às 22:26` | `Revisar agora` (primary) |
| Parados | `estacionado` (bad) | `parou: falhou 3 vezes seguidas, ontem 14:10` | `Destravar e revisar` (primary) |
| Parados | `saiu de cena` (mute) | `outra pessoa pegou este PR` | `Revisar agora` (primary) |
| Parados | `limite do plano` (mute) | `assinatura no limite até 23:00` | nenhum; texto `sem ação até o reset, às 23:00` |
| Parados | `espera do grupo` (mute) | `o teto de consumo do grupo segura` | nenhum; texto `sem ação: sai sozinho quando o grupo liberar` |
| Revisados e ignorados | `visto` (ok) | `já revisado, ontem 16:40` | `Revisar de novo` · `Ocultar` |
| Revisados e ignorados | `ignorado` (mute) | `não volta para a fila` | `Restaurar` |
| Revisados e ignorados | `oculto` (mute) | `visto e oculto por você` | `Mostrar` |
| Revisados e ignorados | `transferido` (mute) | `foi para o Notebook velho` | nenhum |

- Sem sinal, item revisando: `revisando às 20:21, pode já ter acabado`
- `Transferir` com um só executor fica desligado, title `Não há outro executor para receber esta revisão.`
- Botão com comando pendente fica desligado, title `Esperando o celular aplicar o comando anterior.`
- `aria-label` de cada botão: `<rótulo>: <repo>#<número>`, por exemplo `Revisar agora: loja-web#223`.

### Decidir (abre dentro do item)
- `Veredito do celular: aprovar` + motivos em lista
- Veredito aprovar: `Aprovar no GitHub` (primary) · `Pedir mudanças` · `Marcar como visto`
- Veredito pedir mudanças: `Pedir mudanças no GitHub` (primary) · `Aprovar mesmo assim` · `Marcar como visto`
- Rodapé: `Posta no GitHub pelo celular, como @ana-exemplo.`
- Depois de aplicado: chip `visto`, frase `decidido por você: aprovado, postado pelo celular às 22:24`

### Retorno de comando (no item e no histórico)

| estado | chip | no item | no histórico |
|---|---|---|---|
| enviado | `enviado` (info, ponto pulsando) | `Revisar agora, enviado às 22:23. O celular aplica no próximo ciclo, em até 10 s.` | `esperando o celular, até 10 s` |
| aplicado | `aplicado` (ok) | `Ignorar, aplicado pelo celular às 22:18.` | `aplicado às 22:18` |
| recusado | `recusado` (bad) | `Revisar agora: o celular recusou. Outra pessoa pegou este PR, e lá o Farol saiu de cena.` | `outra pessoa pegou este PR, e lá o Farol saiu de cena` |
| vencido | `vencido` (warn) | `Revisar de novo: o celular não confirmou em 2 min. Nada mudou lá.` + link `Enviar de novo` | `o celular não confirmou em 2 min` |

O motivo do recusado vem do celular, já em português, e é mostrado sem edição. O vencido é decidido no admin depois de 2 min sem resposta.

- Histórico: título `Comandos enviados`, lateral `últimas 24 h · vence em 2 min sem resposta`. Linha: hora · ação em negrito · PR · chip · nota.
- Nomes de comando sem PR: `Pausar`, `Retomar`, `Teto de 3 ao mesmo tempo`, `Revisar sozinho: sim em @ana-pessoal`, `Silenciar @ana-pessoal`, `Aprovável sem ressalvas: aprova sozinho em @ana-exemplo`.

### Contas neste aparelho
- Título `Contas neste aparelho` · lateral `publicado às 22:23` (sem sinal: `publicado às 20:21, há 2 h`)
- Descrição: `O valor marcado é o que o aparelho publicou. Trocar aqui manda um comando, e ele aplica no próximo ciclo, em até 10 s.`
- Campos e opções (mesmos textos da tela local de Contas):
  - `Revisar sozinho`: `Sim` / `Não`
  - `Silenciada`: `Sim` / `Não`
  - `Aprovável sem ressalvas`: `espera você aprovar` / `aprova sozinho`
  - `Aprovável com ressalvas`: `espera você aprovar` / `aprova e destaca as ressalvas`
  - `Com blocker`: `espera você (padrão)` / `reprova sozinho (posta pedir mudanças)`
- Aviso sob o campo quando automático: `o aparelho posta a aprovação sozinho no GitHub` · no blocker: `o aparelho posta pedir mudanças sozinho no GitHub`
- Ao lado do campo: chip `enviado` / `aplicado` / `recusado` / `vencido`, como nos PRs.

### Confirmação (só ao ligar uma opção automática)
- Sem ressalvas: título `Deixar o Celular da Ana aprovar sozinho?`; texto `Quando a revisão de um PR pedido a @ana-exemplo terminar sem ressalvas, o Celular da Ana vai postar a aprovação no GitHub sozinho, sem passar por você.`; confirmar `Ligar a aprovação automática`
- Com ressalvas: título `Deixar o Celular da Ana aprovar com ressalvas sozinho?`; texto `Quando a revisão de um PR pedido a @ana-exemplo terminar com ressalvas, o Celular da Ana vai aprovar no GitHub e destacar as ressalvas no comentário, sem passar por você.`; confirmar `Ligar a aprovação com ressalvas`
- Blocker: título `Deixar o Celular da Ana reprovar sozinho?`; texto `Quando a revisão de um PR pedido a @ana-exemplo encontrar um blocker, o Celular da Ana vai postar pedir mudanças no GitHub sozinho, sem passar por você.`; confirmar `Ligar a reprovação automática`
- Lista comum:
  - `Vale a partir da próxima revisão. As que já pedem decisão continuam esperando você.`
  - `A revisão sai no GitHub com o nome de @ana-exemplo.`
  - `Para desligar, volte aqui e escolha a opção que espera você.`
- Cancelar: `Manter esperando você` (recebe o foco; Esc cancela)

## 5. Teclado e foco
- Sub-abas, faixa de aparelhos e filtros: setas esquerda/direita movem, Enter ativa. `:focus-visible` do app (contorno `--accent`).
- Diálogo: foco preso dentro; Esc = `Manter esperando você`; ao fechar, o foco volta ao select que abriu.
- Retornos de comando usam `role="status"` para o leitor de tela anunciar enviado, aplicado, recusado e vencido.
- Botões desligados continuam focáveis via `aria-disabled="true"` (em vez de `disabled`) para o title com o motivo ser lido.

## 6. Dados que a tela lê do celular
Por aparelho: nome, sistema, versão, visto por último, aceita comandos, pausado, teto e ocupadas, IA pronta, contas com validade do token, até 3 falhas (tipo, quando, PR), hora da última fila publicada. Por PR: repo, número, título, autor com foto, conta, quando foi pedido, estado, frase, motivos do veredito, últimas linhas ao vivo. Por comando: id, hora de envio, ação, alvo, estado, motivo do recusado, hora de aplicação.
