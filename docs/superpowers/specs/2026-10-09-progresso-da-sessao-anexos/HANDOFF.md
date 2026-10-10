# Handoff: linha de progresso do cartão "Analisando agora"

Quadros: `Progresso da Sessao.dc.html` (8 estados no escuro, 8 no claro, 360 px com 4 sessões empilhadas).

## Decisões

- **Porcentagem à esquerda, em coluna fixa de 34 px**, alinhada à direita. A barra começa no mesmo x em todos os cartões empilhados, em qualquer largura.
- **Texto do estado embaixo da barra**, não ao lado: em 360 px não sobra largura para os dois na mesma linha.
- **Sinal de vida = ponto de 6 px sob a porcentagem.** Acende a cada evento que chega e apaga em 1 s. Sem evento, fica apagado (45% de opacidade). Ele só se mexe quando algo acontece de verdade; nada atravessa a tela.
- **A esteira deixa de pulsar.** `.sf-node.sf-active .sf-dot` perde o `sfpulse` e fica com o ponto fixo. A esteira diz em que etapa a sessão está; o ponto da barra diz se ela está viva. Assim o sinal não aparece duplicado.
- **Recomendação fora do escopo:** o `.spin.accent` do cabeçalho é um terceiro indicador de "rodando", e gira sem parar. Sugiro removê-lo (os quadros já estão sem ele). Se ficar, que pare no estado 6.

## Token que falta

`--warn` não está definido no `app.css`: as regras atuais usam `var(--warn, #d98324)`, então hoje o fallback é que pinta. Proposta, no mesmo espírito de `--urgent` (apelido, nenhuma cor nova):

```css
:root { --warn: var(--accent); }
```

Texto em alerta usa `--accent-text` (já existe, já ajustado para contraste no claro: `#9a5900`, 5,5:1). `--warn` puro no claro (`#e08700`) dá cerca de 2,6:1 sobre branco, então ele só pinta o ponto e a borda, nunca texto.

## Marcação

```html
<div class="op-progress sess-progress" data-estado="viva"
     role="progressbar" aria-valuemin="0" aria-valuemax="100"
     aria-valuenow="42" aria-valuetext="42%, cerca de 3 minutos restantes">
  <span class="sess-pct">42%</span>
  <div class="op-bar"><div class="op-bar-fill" style="width:42%"></div></div>
  <span class="sess-sinal" aria-hidden="true"></span>
  <div class="sess-txt">
    <span class="sess-estado">~3 min restantes</span>
    <span class="sess-base">típico: 5,7 min em PR deste tamanho (32 revisões)</span>
  </div>
</div>
```

`data-estado`: `viva` (estados 1 a 5 e 7), `muda` (6), `concluida` (8). Remover a classe `indeterminada`. `.sess-base` fica vazio (ou ausente) quando não houver texto secundário.

Atualizar o `aria-valuetext` só quando o texto muda ou a cada 10 pontos percentuais; não a cada segundo, para não encher o leitor de tela. O texto do estado 6 entra uma vez em uma região `aria-live="polite"` do cartão.

## CSS

Substitui o bloco de `app.css` linhas 2303 a 2312 (barra indeterminada, `sess-muda`, `sess-fechando`) e a linha 1580.

```css
.sess-progress {
  display: grid; grid-template-columns: 34px minmax(0, 1fr);
  column-gap: 10px; row-gap: 5px; align-items: center;
  margin: 10px 0 8px;
}
.sess-progress .sess-pct {
  min-width: 0; text-align: right;
  font-size: 11.5px; font-weight: 600; color: var(--text);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.sess-progress .op-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.sess-progress .op-bar-fill { background: var(--info); border-radius: 2px; transition: width 1s linear; }

.sess-sinal {
  justify-self: end; margin-right: 2px;
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--info); opacity: .45;
}
.sess-sinal.pisca { animation: sess-sinal 1s ease-out; }
@keyframes sess-sinal { 0% { opacity: 1; transform: scale(1.35); } 100% { opacity: .45; transform: scale(1); } }

.sess-txt { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; min-width: 0; }
.sess-estado { font-size: 12px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.sess-base { font-size: 11.5px; color: var(--muted); text-wrap: pretty; }

/* 6: sessão muda. A barra para e esmaece; o alerta fica no ponto e no texto */
.sess-progress[data-estado="muda"] .sess-pct { color: var(--muted); }
.sess-progress[data-estado="muda"] .op-bar-fill { background: var(--muted); transition: none; }
.sess-progress[data-estado="muda"] .sess-sinal { background: var(--warn); opacity: 1; animation: none; }
.sess-progress[data-estado="muda"] .sess-estado { color: var(--accent-text); }
.session-card:has(.sess-progress[data-estado="muda"]) { border-left-color: var(--warn); }

/* 8: concluída */
.sess-progress[data-estado="concluida"] .op-bar-fill { background: var(--ok); }
.sess-progress[data-estado="concluida"] .sess-sinal { background: var(--ok); opacity: 1; animation: none; }
.sess-progress[data-estado="concluida"] .sess-estado { color: var(--ok); }
.session-card:has(.sess-progress[data-estado="concluida"]) { border-left-color: var(--ok); }
.session-card.saindo { transition: opacity .3s ease, transform .3s ease; opacity: 0; transform: translateY(-4px); }

/* a esteira para de pulsar: o sinal de vida agora é .sess-sinal */
.sf-node.sf-active .sf-dot { animation: none; }

@media (prefers-reduced-motion: reduce) {
  .sess-progress .op-bar-fill { transition: none; }
  .sess-sinal { opacity: .8; }
  .sess-sinal.pisca { animation: none; }
  .session-card.saindo { transition: none; }
}

@media (max-width: 480px) {
  .session-card .act-cancel { min-height: 44px; }
}
```

## Textos exatos

Linha principal (`.sess-estado`) · linha secundária (`.sess-base`) · `aria-valuetext`.

| # | % | `.sess-estado` | `.sess-base` | `aria-valuetext` |
|---|---|---|---|---|
| 1 | 3% | preparando | aguardando o primeiro evento | 3%, preparando |
| 2 | 42% | ~3 min restantes | típico: 5,7 min em PR deste tamanho (32 revisões) | 42%, cerca de 3 minutos restantes |
| 3 | 18% | em andamento | ainda sem histórico para estimar o tempo | 18%, em andamento, sem estimativa de tempo |
| 4 | 60% | 12 de 20 arquivos lidos | (vazio) | 60%, 12 de 20 arquivos lidos |
| 5 | 93% | passou do tempo típico (~6 min) | ainda trabalhando | 93%, passou do tempo típico de cerca de 6 minutos, ainda trabalhando |
| 6 | mantém (ex.: 51%) | sem sinal há 1min 10s | a barra volta a andar quando chegar evento | 51%, parado, sem sinal há 1 minuto e 10 segundos |
| 7 | 97% | modelo concluiu · decidindo e postando | (vazio) | 97%, modelo concluiu, decidindo e postando |
| 8 | 100% | concluída | em 6min 12s | 100%, concluída |

Regras de texto:

- Tempo restante: `~N min restantes` arredondado ao minuto; abaixo de 1 min, `menos de 1 min`.
- Base da estimativa: com amostra do tamanho, `típico: X,X min em PR deste tamanho (N revisões)`; sem amostra do tamanho, `típico: 5,7 min (mediana geral)`. Sem histórico nenhum, estado 3.
- Ao passar da mediana: troca para o estado 5 com a mediana arredondada (`~6 min`). Não exibir tempo negativo nem "atrasado".
- Estado 6: contador `sem sinal há Ns` até 59 s, depois `Nmin Ns`, atualizado a cada segundo no visual (no leitor de tela, uma vez).
- Sem travessão em nenhum texto; o separador do estado 7 é ` · `.

## Movimento

| o quê | quanto | quando | com `prefers-reduced-motion` |
|---|---|---|---|
| Largura da barra | `width` com `transition: 1s linear`; o motor manda o valor a cada 1 s | sempre que a % muda | sem transição; a barra pula em passos de 1 s (0,3% por passo em 5,7 min, imperceptível) |
| Ponto de vida | uma piscada: opacidade .45 → 1 → .45 e escala 1.35 → 1 em 1 s, `ease-out` | uma vez por evento recebido (reiniciar a classe `.pisca`); eventos a menos de 250 ms um do outro não reiniciam | sem animação; ponto fixo a .8 |
| Estado 6 | nada anima: a barra para, ponto âmbar fixo | 45 s sem evento | igual |
| Saída (8) | cartão em 100% e verde por 1,5 s, depois opacidade 0 e 4 px para cima em 300 ms, e é removido | fim real | sem transição: some depois de 1,5 s |
| Esteira | sem pulso; a troca de etapa só muda cor e borda | troca de fase | igual |

Regras do número (lado do motor, para conferir com o visual):

- A % nunca volta. Se a fase real der um piso acima da % corrente (55% na verificação, 96% no fechamento), a barra anda até o piso com a mesma transição de 1 s, sem salto.
- Entre um piso e outro, a % pode desacelerar ao se aproximar do próximo piso, mas não estaciona: no estado 5 ela segue subindo devagar até 95% e fica abaixo do piso de fechamento.
- 99% é o teto antes do fim real; 100% só com o término.

