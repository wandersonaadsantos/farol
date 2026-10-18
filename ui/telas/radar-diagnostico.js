// Coleta remota sob demanda. O relatório fica nesta tela e só existe após resposta do alvo.
import { api } from './infra.js';
import { esc } from '../pure/comum.js';
import { versaoAntiga } from '../pure/aparelhos-painel.js';

const MINIMA = '2.73.0';
const INTERVALO_MS = 2000;
const MINUTO_MS = 60 * 1000;
const JANELA_MS = 15 * MINUTO_MS;
const COLETAS = new Map();

function diagnosticoHtml(ap, desligado) {
  const coleta = COLETAS.get(ap.deviceId);
  const motivo = desligado || (versaoAntiga(ap.versao, MINIMA) ? 'O aparelho precisa atualizar para oferecer diagnóstico remoto.' : '');
  const dis = motivo || coleta?.pendente;
  const botao = `<button class="btn ap-diagnostico" data-dev="${esc(ap.deviceId)}" ${dis ? `disabled title="${esc(motivo)}"` : ''}>Coletar diagnóstico</button>`;
  const aviso = `<p>Consulta a identidade das contas, a fila e as retomadas. Credenciais não são enviadas. O relatório cifrado expira em cinco minutos.</p>`;
  const resultado = coleta?.relatorio ? `<pre class="report-md">${esc(coleta.relatorio)}</pre>` : '';
  return `<section aria-label="Diagnóstico remoto"><h3>Diagnóstico remoto</h3>${aviso}${botao}<p role="status">${esc(coleta?.mensagem || motivo)}</p>${resultado}</section>`;
}

async function aguardarDiagnostico(dev, cmdId, render) {
  const coleta = COLETAS.get(dev);
  if (coleta?.cmdId !== cmdId) return;
  try {
    const r = await api('/api/sync/diagnostic', { cmdId });
    if (r?.ok) {
      coleta.pendente = false;
      coleta.mensagem = 'Diagnóstico recebido do aparelho.';
      coleta.relatorio = r.texto;
      render();
      return;
    }
    if (Date.now() >= coleta.ate || !['diagnostico_aguardando', 'diagnostico_incompleto'].includes(r?.code)) {
      coleta.pendente = false;
      coleta.mensagem = `A coleta não foi concluída (${r?.code || 'sem resposta'}). Confira a conexão e tente novamente.`;
      render();
      return;
    }
    setTimeout(() => aguardarDiagnostico(dev, cmdId, render), INTERVALO_MS);
  } catch {
    coleta.pendente = Date.now() < coleta.ate;
    coleta.mensagem = coleta.pendente ? 'A conexão falhou. A coleta continua aguardando o aparelho…' : 'A coleta expirou. Tente novamente.';
    render();
    if (coleta.pendente) setTimeout(() => aguardarDiagnostico(dev, cmdId, render), INTERVALO_MS);
  }
}

async function coletarDiagnostico(dev, render) {
  if (COLETAS.get(dev)?.pendente) return;
  const coleta = { pendente: true, ate: Date.now() + JANELA_MS, mensagem: 'Solicitando ao aparelho…' };
  COLETAS.set(dev, coleta);
  render();
  try {
    const r = await api('/api/sync/command', { alvo: dev, tipo: 'diagnosticar', args: {} });
    if (!r?.ok) throw Error(r?.motivo || r?.code || 'o comando não saiu');
    coleta.cmdId = r.cmdId;
    coleta.mensagem = 'Comando enviado. Aguardando a coleta no aparelho…';
    render();
    await aguardarDiagnostico(dev, r.cmdId, render);
  } catch (err) {
    coleta.pendente = false;
    coleta.mensagem = `Não foi possível solicitar o diagnóstico: ${err.message}`;
    render();
  }
}

export { diagnosticoHtml, coletarDiagnostico };
