# Fontes, contexto e desempenho, entrega local

Base de desenvolvimento: `3f9b8685ab0966a0d4cd339a462bfa5b29367c86` (v2.77.2).
A entrega mantém Node/Electron e não adiciona dependências npm, embeddings, banco
vetorial, serviço externo ou análise paga de PRs.

## Decisões

- Fontes têm conta/repositório/H/B/M próprios. Review e autoanálise compartilham aquisição,
  mas mantêm separadas autoria, checkpoints, decisões e publicação.
- Cache de objetos e árvores fica fora dos snapshots descartados. Referências por
  consumidor protegem objetos Git; não há alternates dependentes de origem podável.
- Manifestos de material ficam fora do checkout verificado. Leases de filhos e resultados
  duráveis têm tratamento diferente. Incerteza sobre término conserva o material.
- UI aplica o estado imediatamente e agenda somente a pintura. Abas ocultas ficam dirty;
  foco, seleção, rascunho e FileList precisam sobreviver às atualizações.
- Dados históricos de consumo podem ser reutilizados com invalidação explícita.
  Orçamentos e falhas continuam vivos; gravações mantêm fsync e confirmação síncrona.
- O mapa é navegação candidata. O parser nativo evita uma dependência nova, mas tem limites
  declarados, sobretudo em TypeScript no piso Node e nas relações dinâmicas.

## Comparação reproduzível

`tools/benchmark-ui-pintura.js --root <checkout> --output <json>` executa o mesmo replay
de 100 deltas em cada versão. A fixture compara operações DOM, preservação de estado e
cauda de atividade; não é perfil de CPU em produção.

Com `FAROL_HOME` temporário e `GH_CONFIG_DIR` vazio, execute:

```text
node tools/benchmark-contexto.js --baseline <checkout-da-base> --output <resultado.json>
```

O replay usa 83 arquivos sintéticos e H/M congelados, sem comentários ou soluções
posteriores. Mede parser frio/quente, recuperação de consumidor e teste fora do diff,
compactação da memória com os mesmos blockers e cinco gravações com fsync real.
Não chama o máximo de cinco amostras de p95 nem afirma ganho de decisão de modelo.
Há três cenários: regressão conhecida, mudança compatível e fonte insuficiente.
O controle que só contém o diff é sintético; ele não representa o Farol anterior
completo, que já dispunha de buscas adicionais. Execute em processo novo para o
cache frio do parser; a reutilização sintática é limitada à memória do processo.

O smoke nativo usa `tools/electron-smoke.js --allow-desktop --output <pasta>` e runtime
isolado compatível. Dados, contas, rede e processos externos são controlados pela
fixture. Não usar `--allow-autostart-probe` para esta entrega. A jornada de pintura
verifica SSE/DOM/janela reais, incluindo hide/show, foco, arquivo selecionado e cauda.

## Limitações e ativação

As opções e os procedimentos estão em [CONFIGURATION.md](CONFIGURATION.md).
O rollout do mapa começa desligado; observe não muda a seleção e assist é controlado.
As correções determinísticas só passam a valer numa instalação futura autorizada.

Os benchmarks locais não comprovam consumo de agentes sob carga, qualidade de decisões,
economia faturada ou redução de CPU da instalação aberta. A bateria controlada com
provedores e julgamento humano permanece uma avaliação posterior, sem contaminar
fontes históricas. Há provas locais de recuperação e de redução de repetição.

Legados sem posse verificável não são removidos automaticamente. Esta entrega não
executa limpeza real, push, PR, merge, release, instalação ou restart do usuário.
Após reinício, materiais novos interrompidos só são recuperados quando há decisão
final correspondente ao PR/head/conta, sem sessão/fila/retomada referenciando, e o
SO comprova o término do proprietário e dos consumidores. Queda sem esse desfecho,
histórico podado ou identidade insuficiente conserva o material para diagnóstico.
