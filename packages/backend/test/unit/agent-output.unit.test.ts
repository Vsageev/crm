import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  formatAgentOutputForDisplay,
  parseAgentOutputBlocks,
} from '../../../shared/src/agent-output.ts';

const claudeDuplicateThinkingLogPath = fileURLToPath(
  new URL('../../data/agent-runs/018c6504-b751-49cb-8420-f9bdd36aeb0d/stdout.log', import.meta.url),
);

test('parseAgentOutputBlocks deduplicates Claude thinking when assistant arrives before content_block_stop', () => {
  const output = fs.readFileSync(claudeDuplicateThinkingLogPath, 'utf8');

  const blocks = parseAgentOutputBlocks(output);
  assert.ok(blocks);

  const duplicatedThinking = blocks.filter(
    (block) => block.type === 'thinking'
      && block.content === 'The user wants me to research the best tools for vibecoding. Let me do a web search for this.',
  );

  assert.equal(duplicatedThinking.length, 1);

  const firstToolCall = blocks.find((block) => block.type === 'tool_call');
  assert.ok(firstToolCall && firstToolCall.type === 'tool_call');
  assert.equal(firstToolCall.input, '{\n  "query": "select:WebSearch",\n  "max_results": 1\n}');
});

test('formatAgentOutputForDisplay does not render the same Claude thinking section twice', () => {
  const output = fs.readFileSync(claudeDuplicateThinkingLogPath, 'utf8');
  const display = formatAgentOutputForDisplay(output);
  const duplicateMarker = 'Thinking\nThe user wants me to research the best tools for vibecoding. Let me do a web search for this.';

  assert.equal(display.indexOf(duplicateMarker), display.lastIndexOf(duplicateMarker));
});
