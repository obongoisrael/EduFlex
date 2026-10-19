/**
 * Offline tests for AI roadmap generation (src/services/aiRoadmap.js).
 * Uses the real Anthropic SDK with a stubbed fetch — no API key, no network, no cost.
 *
 * Run with:  npm test
 */
// Safety: never run against real data. `npm test` (tests/run.js) sets up a throwaway database.
if (!process.env.EDUFLEX_TEST_RUN) {
  console.error('Refusing to run: these tests write to the database. Use "npm test", which uses a throwaway copy.');
  process.exit(1);
}
const Anthropic = require('@anthropic-ai/sdk').default;
const { aiRoadmapStructure, normalizeStructure, describeAiError, _setClient } = require('../src/services/aiRoadmap');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
}

/** A client whose HTTP layer returns `reply` (a Messages API body) and records the request. */
function stubClient(reply, status = 200) {
  const calls = [];
  const client = new Anthropic({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
    },
  });
  return { client, calls };
}

const message = (text, stop_reason = 'end_turn') => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5',
  content: [{ type: 'text', text }], stop_reason, usage: { input_tokens: 10, output_tokens: 10 },
});

const FORM = {
  course_name: 'Organic Chemistry', course_code: 'CHE 201', current_level: 'Beginner',
  preferred_learning_style: 'Exam-focused', difficulty: 'Hard', duration_days: 20, goal: 'Pass the CAT',
};

(async () => {
  console.log('\nAI roadmap service tests (offline)\n');

  // 1. Happy path: Claude's JSON is normalized into the app's roadmap structure
  const aiJson = {
    stages: [
      { title: 'Bonding & Structure', description: 'Foundations.', topics: [
        { title: 'Hybridization and molecular geometry', description: 'sp, sp2, sp3.', hours: 10,
          tasks: [{ title: 'Draw 10 molecules with hybridization labels', task_type: 'Practice', estimated_minutes: 45 },
                  { title: 'Bogus type task', task_type: 'Homework', estimated_minutes: 9999 }] },
        { title: '   ', description: 'empty title topic is dropped', hours: 2, tasks: [] },
      ] },
      { title: 'Reactions', description: 'Core mechanisms.', topics: [
        { title: 'SN1 vs SN2 mechanisms', description: 'Kinetics and stereochemistry.', hours: 30, tasks: [] },
      ] },
      { title: 'Empty stage', description: 'No topics → dropped', topics: [] },
    ],
    tools: [{ name: 'Molecular model kit', purpose: 'Visualise 3D shapes', category: 'Materials', is_required: true }],
  };
  const { client, calls } = stubClient(message(JSON.stringify(aiJson)));
  _setClient(client);
  const st = await aiRoadmapStructure(FORM);
  const req = calls[0];

  check('request goes to the Messages API', req && req.url.includes('/v1/messages'));
  check('uses Claude Opus 5 with adaptive thinking', req.body.model === 'claude-opus-5' && req.body.thinking.type === 'adaptive');
  check('refusal fallback enabled', req.body.fallbacks === 'default');
  check('output constrained to a JSON schema', req.body.output_config.format.type === 'json_schema'
    && req.body.output_config.format.schema.required.includes('stages'));
  check('student input is wrapped as data', req.body.messages[0].content.includes('<student_request>')
    && req.body.messages[0].content.includes('Organic Chemistry'));
  check('structure is marked as AI-built', st.source === 'ai');
  check('empty stages and topics are dropped', st.stages.length === 2 && st.stages[0].topics.length === 1);
  const tasks = st.stages[0].topics[0].tasks;
  check('unknown task types become Practice', tasks[1].task_type === 'Practice');
  check('task minutes are clamped', tasks[1].estimated_minutes === 240);
  const total = st.stages.flatMap(s => s.topics).reduce((a, t) => a + t.hours, 0);
  check('hours scaled to the student\'s time (20 days → ~20h)', Math.abs(total - 20) <= 1, `(got ${total})`);
  check('order fields added', st.stages[1].stage_order === 1 && st.stages[0].topics[0].topic_order === 0);
  check('tools normalized', st.tools.length === 1 && st.tools[0].is_required === 1);

  // 2. Refusal → throws so the route falls back to templates
  _setClient(stubClient(message('', 'refusal')).client);
  let threw = false;
  try { await aiRoadmapStructure(FORM); } catch { threw = true; }
  check('refusal triggers fallback (throws)', threw);

  // 3. Truncated output → throws
  _setClient(stubClient(message('{"stages": [', 'max_tokens')).client);
  threw = false;
  try { await aiRoadmapStructure(FORM); } catch { threw = true; }
  check('truncated output triggers fallback (throws)', threw);

  // 4. Invalid JSON → throws
  _setClient(stubClient(message('not json')).client);
  threw = false;
  try { await aiRoadmapStructure(FORM); } catch { threw = true; }
  check('invalid JSON triggers fallback (throws)', threw);

  // 5. No usable topics → throws
  threw = false;
  try { normalizeStructure({ stages: [{ title: 'x', topics: [] }], tools: [] }, 14); } catch { threw = true; }
  check('empty roadmap is rejected', threw);

  // 6. Bad API key → typed error, readable log reason
  _setClient(stubClient({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401).client);
  let reason = '';
  try { await aiRoadmapStructure(FORM); } catch (err) { reason = describeAiError(err); }
  check('invalid API key is reported clearly', reason === 'invalid API key', `(got "${reason}")`);

  _setClient(null);
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('Test runner error:', err); process.exit(1); });
