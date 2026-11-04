// Contraste no tema claro: link do PR e selo "sua revisão" usam o âmbar de texto (--accent-text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/app.css', import.meta.url), 'utf8');

function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  const canais = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function declaracaoClara(token) {
  const re = new RegExp(`:root\\[data-theme="light"\\]\\s*\\{[^}]*?--${token}:\\s*(#[0-9a-fA-F]{6})`);
  return css.match(re)?.[1];
}
function regra(seletor) {
  const esc = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

test('--accent-text do tema claro tem contraste AA sobre --surface', () => {
  const texto = declaracaoClara('accent-text');
  const superficie = declaracaoClara('surface');
  assert.ok(texto && superficie);
  assert.ok(contraste(texto, superficie) >= 4.5);
});

test('link do PR e selo usam --accent-text no tema claro', () => {
  const claro = regra(':root[data-theme="light"] .prow.mine .pw-ref, :root[data-theme="light"] .pr-ref a');
  assert.match(claro, /color:\s*var\(--accent-text\)/);
  assert.match(regra('.pw-head .badge'), /color:\s*var\(--accent-text\)/);
});
