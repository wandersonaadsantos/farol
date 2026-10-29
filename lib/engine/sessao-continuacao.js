// Só uma admissão obtida por este engine pode autorizar continuação da operação.
const admissions = new WeakMap();
const identidade = opts => [opts.id, opts.account, opts.operationKind,
  opts.coordination?.prKey, opts.coordination?.account, opts.coordination?.materialVersion, opts.coordination?.headSha];

function lembrarAdmissao(engine, opts, handle) {
  if (!handle || typeof handle !== 'object') return;
  if (!admissions.has(engine)) admissions.set(engine, new WeakMap());
  admissions.get(engine).set(handle, identidade(opts));
}

function retomarAdmissao(engine, opts) {
  const handle = opts.continuationHandle;
  const saved = handle && typeof handle === 'object' ? admissions.get(engine)?.get(handle) : null;
  if (!saved || identidade(opts).some((value, i) => value !== saved[i])
    || (handle.done && !handle.noop) || handle.lost || typeof handle.valido !== 'function' || !handle.valido()) {
    throw Object.assign(new Error('posse inválida para continuar esta revisão; nada foi publicado'), { coordenacao: 'perdido' });
  }
  return handle;
}

function continuarSessao(engine, prompt, opts, run) {
  const handle = retomarAdmissao(engine, opts);
  return run(engine, prompt, opts).then(res => {
    retomarAdmissao(engine, opts);
    return Object.assign(res, { coordination: handle });
  }, error => {
    if (handle.lost || !handle.valido()) error.coordenacao = 'perdido';
    throw error;
  });
}

function avisarAdmissao(engine, opts, handle) {
  lembrarAdmissao(engine, opts, handle);
  if (typeof opts.onAdmitted !== 'function') return Promise.resolve();
  return Promise.resolve().then(() => opts.onAdmitted(handle));
}

function assinaturaDaSessao(engine, auth) {
  const prefix = { codex: 'codex', agy: 'agy' }[auth.kind];
  const keys = prefix ? [`${prefix}ReviewModel`, `${prefix}ReviewEffort`] : ['reviewModel', 'reviewEffort'];
  return { kind: auth.kind, id: auth.id || '', dir: auth.dir || '', grupo: auth.grupo || '',
    settings: keys.map(key => [key, engine.config?.[key]]) };
}

function conferirAssinatura(engine, opts, auth) {
  const expected = opts.sessionBinding;
  if (!expected) return;
  const actual = assinaturaDaSessao(engine, auth);
  if (['kind', 'id', 'dir', 'grupo'].some(key => actual[key] !== expected[key])
    || expected.settings.some(([key, value]) => engine.config?.[key] !== value)) {
    throw Object.assign(new Error('o perfil ou modelo mudou; a conversa anterior não pode ser retomada neste perfil'), { continuationChanged: true });
  }
}

export { continuarSessao, avisarAdmissao, assinaturaDaSessao, conferirAssinatura };
