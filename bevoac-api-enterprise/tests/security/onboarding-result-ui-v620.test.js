'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ONBOARDING_RESULT_RETURN_URL,
  ONBOARDING_RESULT_SCRIPT
} = require('../../src/lib/onboarding-result-assets');
const {
  ONBOARDING_RESULT_HTML
} = require('../../src/routes/onboarding-azure');

test('onboarding return destination is the approved fixed HTTPS website', () => {
  assert.equal(ONBOARDING_RESULT_RETURN_URL, 'https://bevoac.fr/');

  const url = new URL(ONBOARDING_RESULT_RETURN_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'bevoac.fr');
  assert.equal(url.pathname, '/');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.port, '');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
});

test('onboarding result HTML renders the fixed return link server-side', () => {
  assert.match(ONBOARDING_RESULT_HTML, /id="return-action"/);
  assert.ok(
    ONBOARDING_RESULT_HTML.includes(`href="${ONBOARDING_RESULT_RETURN_URL}"`)
  );
  assert.match(ONBOARDING_RESULT_HTML, /rel="noreferrer"/);
  assert.match(ONBOARDING_RESULT_HTML, /referrerpolicy="no-referrer"/);
});

test('onboarding browser script consumes only bounded result fragment fields', () => {
  assert.match(
    ONBOARDING_RESULT_SCRIPT,
    /new URLSearchParams\(window\.location\.hash\.slice\(1\)\)/
  );
  assert.match(ONBOARDING_RESULT_SCRIPT, /params\.get\('status'\)/);
  assert.match(ONBOARDING_RESULT_SCRIPT, /params\.get\('subscriptionCount'\)/);
  assert.match(ONBOARDING_RESULT_SCRIPT, /params\.get\('reason'\)/);
  assert.doesNotMatch(ONBOARDING_RESULT_SCRIPT, /window\.location\.search/);
  assert.doesNotMatch(
    ONBOARDING_RESULT_SCRIPT,
    /returnUrl|return_url|redirect_uri|return-action/i
  );
  assert.equal(
    ONBOARDING_RESULT_SCRIPT.includes(ONBOARDING_RESULT_RETURN_URL),
    false
  );
});

test('onboarding states and error reasons remain explicit allowlists', () => {
  for (const state of ['success', 'action_required', 'error', 'unknown']) {
    assert.ok(ONBOARDING_RESULT_SCRIPT.includes(`${state}: Object.freeze({`));
  }

  for (const reason of [
    'admin_consent_not_granted',
    'access_denied',
    'invalid_state',
    'callback_failed',
    'VALIDATION_ERROR'
  ]) {
    assert.ok(ONBOARDING_RESULT_SCRIPT.includes(`${reason}:`));
  }

  assert.match(
    ONBOARDING_RESULT_SCRIPT,
    /Object\.prototype\.hasOwnProperty\.call\(states, requestedState\)/
  );

  assert.match(
    ONBOARDING_RESULT_SCRIPT,
    /Object\.prototype\.hasOwnProperty\.call\(safeReasons, reason\)/
  );
});

test('onboarding subscription count is bounded before rendering', () => {
  assert.ok(
    ONBOARDING_RESULT_SCRIPT.includes(
      'const subscriptionCount = /^\\d{1,6}$/.test(rawCount) ? Number(rawCount) : 0;'
    )
  );
});

test('onboarding browser script cannot navigate, call the network, or persist state', () => {
  const forbiddenTokens = [
    ['window', '.close('].join(''),
    ['window', '.open('].join(''),
    ['location', '.assign('].join(''),
    ['location', '.replace('].join(''),
    ['fetch', '('].join(''),
    ['XML', 'HttpRequest'].join(''),
    ['Web', 'Socket'].join(''),
    ['Event', 'Source'].join(''),
    ['send', 'Beacon'].join(''),
    ['session', 'Storage'].join(''),
    ['local', 'Storage'].join(''),
    ['document', '.cookie'].join('')
  ];

  for (const token of forbiddenTokens) {
    assert.equal(ONBOARDING_RESULT_SCRIPT.includes(token), false, token);
  }
});
