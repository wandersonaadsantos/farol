# B2: as telas no Claude Design

Fonte versionada dos quadros. O desenho fica no Claude Design (canvas publicado); aqui está
o que o gera, para comparar desenho e implementação depois.

| Artefato | Onde |
|---|---|
| Canvas publicado | https://claude.ai/artifact/TpikCGQajjhpN8JDZ2K2Q6 |
| Versão 1 | 16 quadros, molduras estimadas |
| Versão 2 | as mesmas telas com as molduras ajustadas às alturas medidas, e a correção do transbordo horizontal no celular |
| Versão 3 | pareamento alinhado à implementação: código vencido e usado viram um estado só, sem link morto e sem a promessa de guardar o que se digitava |
| Versão 4 (16/09/2026 à noite) | alinhada à implementação integrada: as 18 divergências de Aparelhos e Grupos (C1, C2, C4), transferir e tomar com destinos e motivos (C8), candidatos e iniciar com o motivo da espera (C5), listas remotas e estados da leitura (C3), repetir no histórico, designar admin; molduras remedidas |

## Como refazer

```
node montar.mjs <pasta de saida>
```

`montar.mjs` injeta `comum.css` (vocabulário copiado de `ui/app.css`), o topo do app e a
barra do Sistema em cada fragmento de `quadros/`, e gera um `.dc.html` por quadro mais o
`canvas.json`. A partir daí, a skill `design` semeia e publica.

## Regras que os quadros seguem

- Componentes e tokens do app atual, tema escuro (o padrão); nada de framework, fonte remota
  ou ícone externo.
- Duas larguras: computador em 1280 px e celular em 390 px, este medido sem rolagem
  horizontal (a medição está na evidência da entrega).
- Proteção que não está valendo aparece como "ainda não vale", com motivo e o que falta.
- Cada painel separa carregando, vazio, falha, indisponível e desligado.
- Dados sintéticos; e-mail só como marcador entre colchetes.
