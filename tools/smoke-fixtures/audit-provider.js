// CLI sintético: só a fronteira de IA; o executor e a contabilidade são reais.
import { auditResponse } from '../../test/helpers/audit-response.js';
import { safeStringify } from '../../lib/io.js';
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const report = auditResponse(input);
  console.log(safeStringify({ type: 'result', subtype: 'success', result: safeStringify(report), session_id: `fixture-${process.pid}`,
    total_cost_usd: 0.12, usage: { input_tokens: 10, output_tokens: 20 } }));
});
