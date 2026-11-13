// O motivo de cada regra que BLOQUEIA, em linguagem de gente, para o texto público do pedido de
// mudanças (12/11/2026). Com só o arquivo e a linha, o autor do biud-frontend#1992 adivinhou a causa e
// corrigiu o data-testid, que não era ela. O id da regra, a causa e a mensagem da ferramenta seguem
// fora do texto público (PR #253): estas frases são do Farol, uma por regra, conferidas contra o enunciado
// do catálogo. Regra de organização nunca bloqueia e não entra; regra sem frase sai com o texto genérico.
// PURO: sem IO.
const MOTIVO_PUBLICO = Object.freeze({
  'backend.degradation.leaves-trace': 'a falha da fonte acessória degrada sem deixar rastro (log ou métrica) que permita contá-la, ou um número não medido aparece como se fosse medido',
  'backend.delivery.idempotent-effect': 'o efeito não está protegido contra entrega repetida',
  'backend.input.checked-before-effect': 'dado de fora é usado antes de ser conferido',
  'backend.isolation.scope-required': 'a operação acontece mesmo sem o escopo de isolamento (empresa, tenant ou pessoa)',
  'backend.output.sanitized': 'a saída leva dado que o destino não deveria receber, ou valor de fora sem neutralizar',
  'backend.verification.inconclusive-is-not-pass': 'verificação que não concluiu é tratada como satisfeita',
  'core.duplication.business-rule': 'regra de negócio repetida em mais de um lugar, sem fonte única',
  'core.javascript.modern-and-explicit': 'construção antiga ou implícita onde o repositório pede JavaScript moderno e explícito',
  'core.suppression.declared': 'supressão de lint, ou supressão sem identificador e motivo no mesmo comentário',
  'core.testing.behavior-proof': 'o teste continuaria passando sem o comportamento que ele diz proteger',
  'core.testing.coverage-under-mocked-strategy': 'a suíte isola dependências com dublê e não chega à cobertura total que essa escolha exige',
  'core.testing.e2e-without-mocks': 'teste de ponta a ponta usando mock de módulo',
  'frontend.component.scalable-units': 'medida fixa em px onde a interface deve acompanhar a fonte do usuário (use rem ou token escalável)',
  'frontend.design-system.canonical-source': 'o design system deixa de consumir a fonte canônica (valor visual montado à mão, controle copiado em vez do componente, ou inventário sem declaração explícita)',
});

const motivoPublico = (regra) => (Object.hasOwn(MOTIVO_PUBLICO, regra) ? MOTIVO_PUBLICO[regra] : null);

export { MOTIVO_PUBLICO, motivoPublico };
