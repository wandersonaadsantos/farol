// Dublê do endpoint de reviews do GitHub para os testes da arbitragem de postagem. Sem
// efeito colateral no import. Responde às três formas de chamada que o Farol usa:
//   - POST gh api repos/{repo}/pulls/{n}/reviews --input <arquivo>
//   - GET  ... --jq <filtro com == "conta">  (os meus: state, submitted_at, commit_id)
//   - GET  ... --jq <filtro com != "conta">  (dos outros: quem, tipo, state, commit_id)
// O jq não é executado: o dublê já devolve no formato que cada filtro produziria.
// `estado.ocultarNovos` imita o índice atrasado: review postado com a chave ligada não
// aparece na listagem até `revelar()`.
import fs from 'node:fs';

const ESTADO = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' };

export function recusa422() {
  return { ok: false, code: 1, stdout: JSON.stringify({ message: 'Unprocessable Entity', errors: ['commit_id inválido'] }), stderr: 'gh: Unprocessable Entity (HTTP 422)' };
}

export function criarGithubFalso({ conta = 'eu', agora = () => Date.now(), head = () => '' } = {}) {
  const reviews = [];
  const posts = [];
  const estado = { falharLeitura: false, aoPostar: null, ocultarNovos: false, proximoId: 1000 };

  const ok = (stdout) => ({ ok: true, code: 0, stdout, stderr: '' });

  function registrar(payload, user) {
    const review = {
      id: estado.proximoId++, user, state: ESTADO[payload.event] || '', commit_id: payload.commit_id || head(),
      submitted_at: new Date(agora()).toISOString(), oculto: estado.ocultarNovos,
    };
    reviews.push(review);
    return review;
  }

  function postar(args) {
    const payload = JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8'));
    posts.push({ args: [...args], payload });
    const decisao = estado.aoPostar ? estado.aoPostar(payload, posts.length) : 'aceitar';
    if (decisao && typeof decisao === 'object') return Promise.resolve(decisao);
    const review = registrar(payload, conta);
    if (decisao === 'aceitar-e-cair') return Promise.reject(new Error('processo encerrado depois do aceite'));
    return Promise.resolve(ok(JSON.stringify({ id: review.id, state: review.state, commit_id: review.commit_id })));
  }

  function listar(args) {
    if (estado.falharLeitura) return Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'gh: HTTP 502' });
    const jq = args[args.indexOf('--jq') + 1] || '';
    const visiveis = reviews.filter((r) => !r.oculto);
    if (jq.includes(`== "${conta}"`)) {
      return Promise.resolve(ok(JSON.stringify(visiveis.filter((r) => r.user === conta).map((r) => ({ state: r.state, submitted_at: r.submitted_at, commit_id: r.commit_id })))));
    }
    return Promise.resolve(ok(JSON.stringify(visiveis.filter((r) => r.user !== conta).map((r) => ({ quem: r.user, tipo: 'User', state: r.state, commit_id: r.commit_id })))));
  }

  function run(cmd, args) {
    const a = args || [];
    if (a[0] === 'api' && a.includes('--input')) return postar(a);
    if (a[0] === 'api' && a.includes('--jq')) return listar(a);
    return Promise.resolve(ok(''));
  }

  return {
    run, reviews, posts, estado,
    revelar() { for (const r of reviews) r.oculto = false; },
    adicionarReview({ user, state, commit_id, submitted_at }) {
      reviews.push({ id: estado.proximoId++, user, state, commit_id, submitted_at: submitted_at || new Date(agora()).toISOString(), oculto: false });
    },
  };
}
