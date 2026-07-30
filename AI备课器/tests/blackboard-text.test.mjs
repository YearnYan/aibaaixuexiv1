import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEducationalSvgMarkup } from '../src/educationalSvg.js';

test('blackboard SVG text uses regular font weight', () => {
  const source = String.raw`<svg viewBox="0 0 240 100">
    <g font-weight="700">
      <text x="10" y="30" font-weight="bold">title</text>
      <text x="10" y="70"><tspan font-weight="800">formula</tspan></text>
    </g>
  </svg>`;
  const result = normalizeEducationalSvgMarkup(source, { blackboard: true });

  assert.equal((result.match(/font-weight="400"/g) || []).length, 4);
  assert.doesNotMatch(result, /font-weight="(?:bold|700|800)"/);
});
