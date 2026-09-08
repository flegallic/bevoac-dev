'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ONBOARDING_LANDING_URL,
  ONBOARDING_RESULT_RETURN_URL,
  ONBOARDING_RESULT_SCRIPT,
  ONBOARDING_LANDING_SCRIPT
} = require('../../src/lib/onboarding-result-assets');
const {
  ONBOARDING_LANDING_HTML,
  ONBOARDING_RESULT_HTML,
  configuredOnboardingOrigin,
  requireOnboardingBrowserOrigin
} = require('../../src/routes/onboarding-azure');

const CANONICAL_LANDING =
  'https://onboarding.bevoac.fr/v1/onboarding/azure';

test('onboarding return destination is the canonical fixed HTTPS onboarding page', () => {
  assert.equal(ONBOARDING_LANDING_URL, CANONICAL_LANDING);
  assert.equal(ONBOARDING_RESULT_RETURN_URL, CANONICAL_LANDING);

  const url = new URL(ONBOARDING_RESULT_RETURN_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'onboarding.bevoac.fr');
  assert.equal(url.pathname, '/v1/onboarding/azure');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.port, '');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
});

test('onboarding result HTML renders the canonical return link server-side', () => {
  assert.match(ONBOARDING_RESULT_HTML, /id="return-action"/);
  assert.ok(
    ONBOARDING_RESULT_HTML.includes(`href="${ONBOARDING_RESULT_RETURN_URL}"`)
  );
  assert.match(ONBOARDING_RESULT_HTML, /Return to Azure onboarding/);
  assert.match(ONBOARDING_RESULT_HTML, /rel="noreferrer"/);
  assert.match(ONBOARDING_RESULT_HTML, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(ONBOARDING_RESULT_HTML, /stbevoacprodfront|z28\.web\.core\.windows\.net/i);
});

test('canonical onboarding landing is English, branded and does not expose infrastructure URLs', () => {
  assert.match(ONBOARDING_LANDING_HTML, /<html lang="en">/);
  assert.match(ONBOARDING_LANDING_HTML, /class="brand-mark"[^>]*>B<\/div>/);
  assert.match(ONBOARDING_LANDING_HTML, /Connect Microsoft Azure to Bevoac/);
  assert.match(ONBOARDING_LANDING_HTML, /Start Microsoft admin consent/);
  assert.match(ONBOARDING_LANDING_HTML, /placeholder="biv_live_/);
  assert.doesNotMatch(ONBOARDING_LANDING_HTML, /bev_live_/);
  assert.doesNotMatch(ONBOARDING_LANDING_HTML, /securise V3|sécurisé V3|support@bevoac\.fr/i);
  assert.doesNotMatch(ONBOARDING_LANDING_HTML, /stbevoacprodfront|z28\.web\.core\.windows\.net/i);
  assert.doesNotMatch(ONBOARDING_LANDING_HTML, /apiBaseUrl/i);
});

test('browser landing uses only the same-origin browser bootstrap endpoint and clears the key field', () => {
  assert.ok(
    ONBOARDING_LANDING_SCRIPT.includes(
      "fetch('/v1/onboarding/azure/browser-start'"
    )
  );
  assert.ok(ONBOARDING_LANDING_SCRIPT.includes("body: '{}'"));
  assert.ok(ONBOARDING_LANDING_SCRIPT.includes("credentials: 'omit'"));
  assert.ok(ONBOARDING_LANDING_SCRIPT.includes("cache: 'no-store'"));
  assert.ok(ONBOARDING_LANDING_SCRIPT.includes("apiKeyInput.value = ''"));
  assert.ok(ONBOARDING_LANDING_SCRIPT.includes("login.microsoftonline.com"));
  assert.ok(ONBOARDING_LANDING_SCRIPT.includes("window.location.assign"));

  const forbiddenTokens = [
    ['session', 'Storage'].join(''),
    ['local', 'Storage'].join(''),
    ['document', '.cookie'].join(''),
    ['window', '.open('].join(''),
    ['XML', 'HttpRequest'].join(''),
    ['Web', 'Socket'].join(''),
    ['Event', 'Source'].join(''),
    ['send', 'Beacon'].join('')
  ];

  for (const token of forbiddenTokens) {
    assert.equal(ONBOARDING_LANDING_SCRIPT.includes(token), false, token);
  }
});

test('browser bootstrap origin is derived from the configured callback and enforced', () => {
  const config = {
    onboarding: {
      redirectUri: 'https://onboarding.bevoac.fr/v1/onboarding/azure/callback'
    }
  };

  assert.equal(
    configuredOnboardingOrigin(config),
    'https://onboarding.bevoac.fr'
  );

  assert.doesNotThrow(() => {
    requireOnboardingBrowserOrigin(config, {
      headers: {
        origin: 'https://onboarding.bevoac.fr',
        'sec-fetch-site': 'same-origin'
      }
    });
  });

  assert.throws(
    () => requireOnboardingBrowserOrigin(config, {
      headers: {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site'
      }
    }),
    /Browser onboarding must originate/
  );

  assert.throws(
    () => requireOnboardingBrowserOrigin(config, {
      headers: {
        origin: 'https://onboarding.bevoac.fr',
        'sec-fetch-site': 'cross-site'
      }
    }),
    /Cross-site browser onboarding requests are not allowed/
  );
});

test('onboarding result browser script consumes only bounded result fragment fields', () => {
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

test('result browser script cannot navigate, call the network, or persist state', () => {
  const forbiddenTokens = [
    ['window', '.close('].join(''),
    ['window', '.open('].join(''),
    ['location', '.assign('].join(''),
    ['location', '.replace('].join(''),
    ['fe', 'tch', '('].join(''),
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
