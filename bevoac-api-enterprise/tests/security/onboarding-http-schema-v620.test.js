'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EMPTY_QUERY_SCHEMA,
  CALLBACK_QUERY_SCHEMA,
  ONBOARDING_RESULT_HTML
} = require('../../src/routes/onboarding-azure');
const {
  ONBOARDING_RESULT_RETURN_URL,
  ONBOARDING_RESULT_STYLE,
  ONBOARDING_RESULT_SCRIPT
} = require('../../src/lib/onboarding-result-assets');

test('onboarding status rejects unexpected query parameters', () => {
  assert.equal(EMPTY_QUERY_SCHEMA.additionalProperties, false);
  assert.equal(EMPTY_QUERY_SCHEMA.maxProperties, 0);
});

test('Microsoft callback accepts only the documented, bounded parameter set', () => {
  assert.equal(CALLBACK_QUERY_SCHEMA.additionalProperties, false);
  assert.deepEqual(CALLBACK_QUERY_SCHEMA.required, ['state']);
  assert.equal(CALLBACK_QUERY_SCHEMA.properties.state.maxLength, 4096);
  assert.equal(CALLBACK_QUERY_SCHEMA.properties.tenant.format, 'uuid');
  assert.equal(CALLBACK_QUERY_SCHEMA.properties.error_description.maxLength, 1000);
  assert.ok(CALLBACK_QUERY_SCHEMA.properties.error_uri);
  assert.ok(CALLBACK_QUERY_SCHEMA.properties.trace_id);
  assert.ok(CALLBACK_QUERY_SCHEMA.properties.correlation_id);
});

test('credential-free onboarding result page uses only local, bounded browser state', () => {
  assert.match(ONBOARDING_RESULT_HTML, /No client credential is requested or stored/);
  assert.ok(ONBOARDING_RESULT_HTML.includes(`<style>${ONBOARDING_RESULT_STYLE}</style>`));
  assert.ok(ONBOARDING_RESULT_HTML.includes(`<script>${ONBOARDING_RESULT_SCRIPT}</script>`));
  assert.match(ONBOARDING_RESULT_SCRIPT, /new URLSearchParams\(window\.location\.hash\.slice\(1\)\)/);
  assert.match(ONBOARDING_RESULT_SCRIPT, /success:/);
  assert.match(ONBOARDING_RESULT_SCRIPT, /action_required:/);
  assert.match(ONBOARDING_RESULT_SCRIPT, /error:/);
  assert.match(ONBOARDING_RESULT_SCRIPT, /unknown:/);
  assert.doesNotMatch(
    ONBOARDING_RESULT_HTML,
    /apiKey|sessionStorage|localStorage|<script[^>]+src=|<link[^>]+href=/i
  );
  assert.doesNotMatch(
    ONBOARDING_RESULT_SCRIPT,
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|document\.cookie|innerHTML|outerHTML|eval\s*\(|new\s+Function|window\.open/i
  );
});


test('onboarding return action is a fixed HTTPS link rendered without JavaScript', () => {
  assert.equal(ONBOARDING_RESULT_RETURN_URL, 'https://bevoac.fr/');
  const links = ONBOARDING_RESULT_HTML.match(/<a\b[^>]*\bid="return-action"[^>]*>[^<]*<\/a>/g) || [];
  assert.equal(links.length, 1);
  assert.ok(links[0].includes(`href="${ONBOARDING_RESULT_RETURN_URL}"`));
  assert.match(links[0], /rel="noreferrer"/);
  assert.match(links[0], /referrerpolicy="no-referrer"/);
  assert.match(links[0], /aria-describedby="return-help"/);
  assert.match(links[0], />Return to Bevoac<\/a>$/);
  assert.doesNotMatch(links[0], /\b(?:target|onclick|hidden|disabled)=/i);
  assert.doesNotMatch(ONBOARDING_RESULT_HTML, /window\.close\s*\(|close-action|close-help/);
  assert.match(ONBOARDING_RESULT_HTML, /This link opens the Bevoac website/);
});
