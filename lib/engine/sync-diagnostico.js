// Resposta de diagnóstico cifrada, vinculada ao comando assinado e ao aparelho alvo.
// Reusa os nós efêmeros de operações; não expõe terminal nem arquivos arbitrários.
import { createHash } from 'node:crypto';
import io from '../io.js';
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import { tag } from '../sync/tags.js';
import { fragmentar } from '../sync/espelho.js';
import { coletarIdentidade } from './diagnostico-identidade.js';
import assinatura from '../sync/assinatura.js';
import comando from '../sync/comando.js';

const NO = 'live/operations';
const ESQUEMA = 'diag1';
const TTL_MS = 300000;
const MAX_PARTES = 64;
const HEX = /^[0-9a-f]{32}$/;

function idDe(rt, cmdId, parte) {
  return tag(kek.bufferDe(rt.material.id), 'event', `diagnostico|${cmdId}|${parte}`);
}

function contexto(rt, id, no) {
  return { uid: rt.uid, caminho: `${NO}/${id}`, campo: 'diagnostico', no: NO, esquema: ESQUEMA, material: rt.material, extras: [no.dev, no.t0, no.x] };
}

async function gravar(rt, cmdId, parte, dados, agora, inicio) {
  const id = idDe(rt, cmdId, parte);
  const no = { v: 1, dev: rt.deviceId, t0: inicio, x: agora + TTL_MS };
  const c = envelope.cifrar({ ...contexto(rt, id, no), cur: rt.cur, r: 1, dados });
  if (!c.ok) return false;
  const r = await rt.client.put(`/users/${rt.uid}/${NO}/${id}`, { ...no, enc: c.enc }, {});
  return r?.ok === true;
}

function aguardarColeta() { return { estado: 'executando', code: 'diagnostico_indisponivel', semRecibo: true }; }

async function publicarDiagnostico(engine, cmdId, args, agora = Date.now(), inicio = agora, clock = Date.now) {
  const rt = engine.sync;
  const dados = await coletarIdentidade(engine, { tagDoPr: args.prTag || '', kId: kek.bufferDe(rt.material.id), agora });
  const pacote = fragmentar(dados);
  const publicadoEm = Math.max(agora, clock());
  if (pacote.partes.length > MAX_PARTES) return { estado: 'recusado', code: 'diagnostico_grande' };
  for (let i = 0; i < pacote.partes.length; i++) {
    if (!(await gravar(rt, cmdId, String(i), { cmdId, parte: pacote.partes[i] }, publicadoEm, inicio))) return aguardarColeta();
  }
  // Metadados por último: resposta parcial nunca é anunciada como coleta concluída.
  const ok = await gravar(rt, cmdId, 'meta', { cmdId, partes: pacote.partes.length, hash: pacote.hash }, publicadoEm, inicio);
  return ok ? { estado: 'aplicado', code: '' } : aguardarColeta();
}

async function recuperarComando(rt, cmdId) {
  const caminho = `live/commands/${cmdId}`;
  const [pedido, atual] = await Promise.all([
    rt.client.get(`/users/${rt.uid}/${caminho}`), rt.client.get(`/users/${rt.uid}/live/control/admin`),
  ]);
  const no = pedido?.ok && pedido.data;
  const admin = atual?.ok && atual.data;
  if (!no || !admin || no.generation !== admin.generation) return null;
  if (!assinatura.verificar(admin.publicKey, no.sig, { uid: rt.uid, caminho, generation: no.generation, valor: comando.valorAssinado(no) })) return null;
  const claro = envelope.decifrar({ enc: no.enc, material: rt.material, uid: rt.uid, caminho, campo: 'comando', esquema: comando.ESQUEMA });
  const c = claro.ok && comando.sanearComando(claro.valor?.c);
  return c?.tipo === 'diagnosticar' ? { alvo: no.alvo } : null;
}

async function lerParte(rt, cmdId, parte, alvo, agora) {
  const id = idDe(rt, cmdId, parte);
  const r = await rt.client.get(`/users/${rt.uid}/${NO}/${id}`);
  const no = r?.ok && r.data;
  if (!no || no.dev !== alvo || no.x <= agora || no.x > agora + TTL_MS) return null;
  const aberto = envelope.decifrar({ ...contexto(rt, id, no), enc: no.enc });
  return aberto.ok && aberto.valor?.cmdId === cmdId ? aberto.valor : null;
}

async function lerDiagnostico(engine, dados, agora = Date.now()) {
  const rt = engine.sync;
  const cmdId = String(dados?.cmdId || '');
  if (!HEX.test(cmdId) || !rt?.client || !rt.material) return { ok: false, code: 'forma' };
  // O alvo vem do comando que ESTE admin emitiu, nunca da resposta nem do navegador.
  const emitido = (rt.comandosEmitidos || []).find(c => c.cmdId === cmdId && c.tipo === 'diagnosticar') || await recuperarComando(rt, cmdId);
  if (!emitido) return { ok: false, code: 'comando_desconhecido' };
  const meta = await lerParte(rt, cmdId, 'meta', emitido.alvo, agora);
  if (!meta) return { ok: false, code: 'diagnostico_aguardando' };
  if (!Number.isSafeInteger(meta.partes) || meta.partes < 1 || meta.partes > MAX_PARTES) return { ok: false, code: 'diagnostico_invalido' };
  const partes = [];
  for (let i = 0; i < meta.partes; i++) {
    const p = await lerParte(rt, cmdId, String(i), emitido.alvo, agora);
    if (typeof p?.parte !== 'string') return { ok: false, code: 'diagnostico_incompleto' };
    partes.push(p.parte);
  }
  const texto = partes.join('');
  if (createHash('sha256').update(texto).digest('hex') !== meta.hash) return { ok: false, code: 'diagnostico_incompleto' };
  const diagnostico = io.parseJson(texto, null);
  if (diagnostico?.esquema !== 'diagnostico-identidade-1') return { ok: false, code: 'diagnostico_invalido' };
  return { ok: true, alvo: emitido.alvo, diagnostico, texto: io.safeStringify(diagnostico) };
}

export { publicarDiagnostico, lerDiagnostico };
