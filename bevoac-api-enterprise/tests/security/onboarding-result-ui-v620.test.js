'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runInNewContext } = require('node:vm');
const {
  ONBOARDING_RESULT_RETURN_URL,
  ONBOARDING_RESULT_SCRIPT
} = require('../../src/lib/onboarding-result-assets');

// Execute the shipped browser script against a deliberately minimal DOM double.
// This is a unit test, not a browser integration or Microsoft consent test.
function renderFragment(hash, search = '') {
  const ids = [
    'status-icon', 'status-label', 'result-title', 'result-message',
    'next-message', 'subscription-panel', 'subscription-count',
    'subscription-label', 'return-action', 'return-help'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    textContent: '',
    hidden: id === 'subscription-panel'
  }]));
  const forbidden = () => { throw new Error('Unexpected navigation or HTML mutation'); };
  for (const element of Object.values(elements)) {
    Object.defineProperty(element, 'innerHTML', { set: forbidden });
    Object.defineProperty(element, 'outerHTML', { set: forbidden });
    element.setAttribute = forbidden;
    element.addEventListener = forbidden;
  }
  // The return destination belongs to server-rendered HTML, never fragment data.
  Object.defineProperty(elements['return-action'], 'href', {
    value: ONBOARDING_RESULT_RETURN_URL,
    writable: false
  });
  const document = {
    title: '',
    documentElement: { dataset: {} },
    getElementById(id) {
      assert.ok(Object.hasOwn(elements, id), `Unexpected DOM lookup: ${id}`);
      return elements[id];
    }
  };
  Object.defineProperty(document, 'cookie', { get: forbidden, set: forbidden });
  const window = Object.freeze({
    location: Object.freeze({ hash, search }),
    close: forbidden,
    open: forbidden,
    setTimeout: forbidden
  });
  runInNewContext(ONBOARDING_RESULT_SCRIPT, { window, document, URLSearchParams }, {
    timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false }
  });
  return { document, elements };
}

test('onboarding return destination is the approved HTTPS website without URL data', () => {
  assert.equal(ONBOARDING_RESULT_RETURN_URL, 'https://bevoac.fr/');
  const url = new URL(ONBOARDING_RESULT_RETURN_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'bevoac.fr');
  assert.equal(url.username + url.password + url.port + url.search + url.hash, '');
  assert.equal(url.pathname, '/');
  assert.doesNotMatch(ONBOARDING_RESULT_SCRIPT, /window\.(?:close|open|setTimeout)\s*\(/);
});

for (const state of ['success', 'action_required', 'error', 'unknown']) {
  test(`onboarding ${state} rendering leaves the fixed return link unchanged`, () => {
    const attacker = encodeURIComponent('https://attacker.invalid/?token=not-a-token');
    const extra = `&returnUrl=${attacker}&return_url=${attacker}&redirect_uri=${attacker}&next=${attacker}`;
    const { document, elements } = renderFragment(`#status=${state}&subscriptionCount=1${extra}`, `?next=${attacker}`);
    assert.equal(document.documentElement.dataset.onboardingState, state);
    assert.equal(elements['return-action'].href, 'https://bevoac.fr/');
    assert.equal(elements['subscription-panel'].hidden, !['success', 'action_required'].includes(state));
    assert.doesNotMatch(JSON.stringify(elements), /attacker\.invalid/);
    if (state === 'success' || state === 'action_required') {
      assert.equal(elements['subscription-count'].textContent, '1');
      assert.equal(elements['subscription-label'].textContent, 'Azure subscription discovered');
    }
  });
}

for (const status of ['', 'constructor', '__proto__', 'toString', 'SUCCESS', '<img src=x onerror=alert(1)>']) {
  test(`onboarding rejects unknown fragment state ${JSON.stringify(status)}`, () => {
    const { document, elements } = renderFragment(`#status=${encodeURIComponent(status)}`);
    assert.equal(document.documentElement.dataset.onboardingState, 'unknown');
    assert.equal(elements['subscription-panel'].hidden, true);
    assert.equal(elements['return-action'].href, 'https://bevoac.fr/');
  });
}

test('onboarding subscription count remains bounded when the return link is present', () => {
  const cases = [
    ['0', '0'], ['1', '1'], ['42', '42'], ['999999', '999999'], ['000002', '2'],
    ['', '0'], ['1000000', '0'], ['-1', '0'], ['1.5', '0'], ['1e3', '0'],
    ['+1', '0'], [' 1', '0'], ['<img>', '0']
  ];
  for (const [raw, expected] of cases) {
    const { elements } = renderFragment(`#status=success&subscriptionCount=${encodeURIComponent(raw)}`);
    assert.equal(elements['subscription-count'].textContent, expected, raw);
    assert.equal(elements['return-action'].href, 'https://bevoac.fr/');
  }
});

test('onboarding error messages use the existing allowlist, never arbitrary fragment text', () => {
  const known = renderFragment('#status=error&reason=access_denied');
  assert.equal(known.elements['result-message'].textContent, 'Microsoft administrator consent was declined or cancelled.');
  for (const reason of ['<img src=x onerror=alert(1)>', '__proto__', 'constructor', 'https://attacker.invalid/']) {
    const { elements } = renderFragment(`#status=error&reason=${encodeURIComponent(reason)}`);
    assert.equal(elements['result-message'].textContent, 'The Microsoft onboarding flow did not complete successfully.');
    assert.equal(elements['return-action'].href, 'https://bevoac.fr/');
  }
});

test('onboarding keeps the fixed return link without a valid result fragment', () => {
  for (const hash of ['', '#', '#status=%E0%A4%A', '#returnUrl=javascript%3Aalert(1)']) {
    const { document, elements } = renderFragment(hash);
    assert.equal(document.documentElement.dataset.onboardingState, 'unknown');
    assert.equal(elements['return-action'].href, 'https://bevoac.fr/');
  }
});
