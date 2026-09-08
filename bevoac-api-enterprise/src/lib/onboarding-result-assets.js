'use strict';

const { createHash } = require('crypto');

const ONBOARDING_LANDING_URL =
  'https://onboarding.bevoac.fr/v1/onboarding/azure';

// Versioned, server-owned destination. Never derive it from request,
// query-string or fragment data.
const ONBOARDING_RESULT_RETURN_URL = ONBOARDING_LANDING_URL;

const ONBOARDING_RESULT_STYLE = `
:root {
  color-scheme: light;
  font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  background: #f5f7fb;
  color: #242424;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: linear-gradient(180deg, #f8fbff 0%, #eef2f7 100%);
}
[hidden] { display: none !important; }
.page-shell {
  width: min(100% - 32px, 900px);
  margin: 0 auto;
  padding: 40px 0 28px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}
.brand-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 10px;
  background: #0f6cbd;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}
.brand-copy { display: grid; gap: 1px; }
.brand-name { font-size: 15px; font-weight: 700; letter-spacing: .08em; }
.brand-context { color: #616161; font-size: 12px; }
.result-card {
  overflow: hidden;
  border: 1px solid #e1e6ee;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 18px 46px rgba(31,31,31,.09);
}
.result-header { padding: 42px; border-bottom: 1px solid #edf0f4; }
.status-row { display: flex; align-items: flex-start; gap: 18px; }
.status-icon {
  display: grid;
  flex: 0 0 auto;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 50%;
  background: #e8f3fb;
  color: #0f6cbd;
  font-size: 28px;
  font-weight: 700;
}
[data-onboarding-state="success"] .status-icon { background: #e7f4e4; color: #107c10; }
[data-onboarding-state="action_required"] .status-icon { background: #fff4ce; color: #8a5d00; }
[data-onboarding-state="error"] .status-icon { background: #fde7e9; color: #c50f1f; }
.eyebrow {
  margin: 1px 0 6px;
  color: #0f6cbd;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
}
[data-onboarding-state="success"] .eyebrow { color: #107c10; }
[data-onboarding-state="action_required"] .eyebrow { color: #8a5d00; }
[data-onboarding-state="error"] .eyebrow { color: #c50f1f; }
h1 {
  margin: 0;
  color: #1b1a19;
  font-size: clamp(28px, 5vw, 40px);
  font-weight: 650;
  letter-spacing: -.025em;
  line-height: 1.12;
}
.lead {
  margin: 14px 0 0;
  max-width: 700px;
  color: #4f4f4f;
  font-size: 17px;
  line-height: 1.6;
}
.result-body { display: grid; gap: 18px; padding: 28px 42px 36px; }
.summary-card, .next-card, .security-note { border-radius: 14px; }
.summary-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 22px;
  border: 1px solid #dce6f1;
  background: #f7fbff;
}
.summary-label { margin: 0 0 4px; color: #616161; font-size: 13px; font-weight: 600; }
.summary-title { margin: 0; font-size: 16px; font-weight: 600; }
.subscription-count { color: #0f6cbd; font-size: 34px; font-weight: 700; }
.next-card { padding: 20px 22px; background: #f7f7f7; }
.next-card h2 { margin: 0 0 8px; font-size: 16px; }
.next-card p, .security-note p, .return-help {
  margin: 0;
  color: #565656;
  font-size: 14px;
  line-height: 1.55;
}
.actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.primary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: inherit;
  text-decoration: none;
  min-height: 42px;
  padding: 0 18px;
  border: 1px solid #0f6cbd;
  border-radius: 8px;
  background: #0f6cbd;
  color: #fff;
  cursor: pointer;
  font-weight: 650;
}
.primary-action:hover { background: #115ea3; }
.primary-action:disabled { cursor: wait; opacity: .65; }
.primary-action:focus-visible { outline: 3px solid rgba(15,108,189,.3); outline-offset: 3px; }
.security-note {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid #e5e5e5;
}
.security-badge {
  display: grid;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  background: #eef4fb;
  color: #0f6cbd;
  font-weight: 700;
}
.security-note strong { color: #323130; }
.page-footer { margin-top: 18px; color: #737373; font-size: 12px; text-align: center; }
@media (max-width: 640px) {
  .page-shell { width: min(100% - 20px, 900px); padding-top: 18px; }
  .brand { margin-bottom: 16px; }
  .result-card { border-radius: 16px; }
  .result-header, .result-body { padding-left: 22px; padding-right: 22px; }
  .result-header { padding-top: 28px; padding-bottom: 28px; }
  .status-row { display: grid; }
  .summary-card { align-items: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
}
`.trim();

const ONBOARDING_LANDING_STYLE = `${ONBOARDING_RESULT_STYLE}
.steps-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.step-card {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 16px;
  border: 1px solid #e1e6ee;
  border-radius: 12px;
  background: #fff;
}
.step-number {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  background: #eef4fb;
  color: #0f6cbd;
  font-weight: 700;
}
.step-card strong { display: block; margin: 1px 0 4px; color: #323130; }
.step-card p { margin: 0; color: #616161; font-size: 13px; line-height: 1.5; }
.form-card {
  display: grid;
  gap: 14px;
  padding: 22px;
  border: 1px solid #dce6f1;
  border-radius: 14px;
  background: #f7fbff;
}
.form-card h2 { margin: 0; font-size: 18px; }
.field-group { display: grid; gap: 7px; }
.field-label { color: #323130; font-size: 14px; font-weight: 650; }
.credential-input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #b7c7d8;
  border-radius: 8px;
  background: #fff;
  color: #242424;
  font: inherit;
}
.credential-input:focus-visible {
  outline: 3px solid rgba(15,108,189,.22);
  outline-offset: 2px;
  border-color: #0f6cbd;
}
.field-help, .form-status {
  margin: 0;
  color: #565656;
  font-size: 13px;
  line-height: 1.5;
}
.form-status[data-state="error"] { color: #a4262c; font-weight: 600; }
.form-status[data-state="success"] { color: #107c10; font-weight: 600; }
.form-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
@media (max-width: 640px) {
  .steps-grid { grid-template-columns: 1fr; }
}`.trim();

const ONBOARDING_RESULT_SCRIPT = `
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.hash.slice(1));
  const requestedState = params.get('status') || '';
  const states = Object.freeze({
    success: Object.freeze({
      label: 'Connection successful',
      icon: '✓',
      title: 'Azure onboarding completed',
      message: 'Microsoft administrator consent was validated and Bevoac completed the initial Azure subscription discovery.',
      next: 'Return to the Azure onboarding page to review or continue the authorized audit setup.'
    }),
    action_required: Object.freeze({
      label: 'Action required',
      icon: '!',
      title: 'Microsoft consent was received',
      message: 'Bevoac completed the consent step, but the Azure connection still requires an additional permission or verification action.',
      next: 'Return to the Azure onboarding page and complete the requested Azure RBAC or verification step.'
    }),
    error: Object.freeze({
      label: 'Onboarding could not be completed',
      icon: '×',
      title: 'We could not complete Azure onboarding',
      message: 'The Microsoft onboarding flow did not complete successfully.',
      next: 'Return to the Azure onboarding page and start a new onboarding request. If the problem persists, contact your Bevoac administrator.'
    }),
    unknown: Object.freeze({
      label: 'Onboarding result unavailable',
      icon: 'i',
      title: 'No valid onboarding result was found',
      message: 'This page must be opened from an active Bevoac Azure onboarding flow.',
      next: 'Return to the Azure onboarding page to start or review the onboarding process.'
    })
  });
  const safeReasons = Object.freeze({
    admin_consent_not_granted: 'Microsoft administrator consent was not granted.',
    access_denied: 'Microsoft administrator consent was declined or cancelled.',
    invalid_state: 'The onboarding session could not be validated. Start a new onboarding request.',
    callback_failed: 'Bevoac could not complete the Microsoft callback. Start a new onboarding request.',
    VALIDATION_ERROR: 'The onboarding session could not be validated. Start a new onboarding request.'
  });

  const state = Object.prototype.hasOwnProperty.call(states, requestedState)
    ? requestedState
    : 'unknown';
  const view = states[state];
  const rawCount = params.get('subscriptionCount') || '';
  const subscriptionCount = /^\\d{1,6}$/.test(rawCount) ? Number(rawCount) : 0;
  const reason = params.get('reason') || '';

  document.documentElement.dataset.onboardingState = state;
  document.title = view.title + ' | Bevoac';
  document.getElementById('status-icon').textContent = view.icon;
  document.getElementById('status-label').textContent = view.label;
  document.getElementById('result-title').textContent = view.title;
  document.getElementById('result-message').textContent =
    state === 'error' && Object.prototype.hasOwnProperty.call(safeReasons, reason)
      ? safeReasons[reason]
      : view.message;
  document.getElementById('next-message').textContent = view.next;

  const summary = document.getElementById('subscription-panel');
  if (state === 'success' || state === 'action_required') {
    summary.hidden = false;
    document.getElementById('subscription-count').textContent = String(subscriptionCount);
    document.getElementById('subscription-label').textContent =
      subscriptionCount === 1
        ? 'Azure subscription discovered'
        : 'Azure subscriptions discovered';
  }
})();
`.trim();

const ONBOARDING_LANDING_SCRIPT = `
(function () {
  'use strict';

  const form = document.getElementById('onboarding-form');
  const apiKeyInput = document.getElementById('api-key');
  const startButton = document.getElementById('start-button');
  const status = document.getElementById('form-status');

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || '';
  }

  function referenceFrom(response) {
    const value = response.headers.get('x-correlation-id');
    return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value)
      ? ' Reference: ' + value + '.'
      : '';
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    if (startButton.disabled) return;

    let apiKey = apiKeyInput.value.trim();
    apiKeyInput.value = '';

    if (!apiKey) {
      setStatus('Enter your Bevoac client API key to continue.', 'error');
      apiKeyInput.focus();
      return;
    }

    startButton.disabled = true;
    setStatus('Creating a secure onboarding session…', 'progress');

    try {
      const response = await fetch('/v1/onboarding/azure/browser-start', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: '{}',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      });

      apiKey = '';

      if (!response.ok) {
        throw new Error(
          'Unable to start Azure onboarding.' + referenceFrom(response)
        );
      }

      const payload = await response.json();
      if (!payload || typeof payload.authorizationUrl !== 'string') {
        throw new Error('The onboarding service returned an invalid response.');
      }

      const authorizationUrl = new URL(payload.authorizationUrl);
      if (
        authorizationUrl.protocol !== 'https:' ||
        authorizationUrl.hostname.toLowerCase() !== 'login.microsoftonline.com' ||
        !authorizationUrl.pathname.endsWith('/adminconsent')
      ) {
        throw new Error('The onboarding service returned an unexpected Microsoft URL.');
      }

      setStatus('Redirecting to Microsoft…', 'success');
      window.location.assign(authorizationUrl.toString());
    } catch (error) {
      apiKey = '';
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to start Azure onboarding.';
      setStatus(message, 'error');
      startButton.disabled = false;
      apiKeyInput.focus();
    }
  });
})();
`.trim();

function cspSha256(value) {
  return `'sha256-${createHash('sha256').update(value, 'utf8').digest('base64')}'`;
}

const ONBOARDING_RESULT_STYLE_HASH = cspSha256(ONBOARDING_RESULT_STYLE);
const ONBOARDING_RESULT_SCRIPT_HASH = cspSha256(ONBOARDING_RESULT_SCRIPT);
const ONBOARDING_LANDING_STYLE_HASH = cspSha256(ONBOARDING_LANDING_STYLE);
const ONBOARDING_LANDING_SCRIPT_HASH = cspSha256(ONBOARDING_LANDING_SCRIPT);

const ONBOARDING_RESULT_CSP = [
  "default-src 'none'",
  `style-src ${ONBOARDING_RESULT_STYLE_HASH}`,
  "style-src-attr 'none'",
  `script-src ${ONBOARDING_RESULT_SCRIPT_HASH}`,
  "script-src-attr 'none'",
  "connect-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

const ONBOARDING_LANDING_CSP = [
  "default-src 'none'",
  `style-src ${ONBOARDING_LANDING_STYLE_HASH}`,
  "style-src-attr 'none'",
  `script-src ${ONBOARDING_LANDING_SCRIPT_HASH}`,
  "script-src-attr 'none'",
  "connect-src 'self'",
  "img-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

module.exports = {
  ONBOARDING_LANDING_URL,
  ONBOARDING_RESULT_RETURN_URL,
  ONBOARDING_RESULT_STYLE,
  ONBOARDING_RESULT_SCRIPT,
  ONBOARDING_RESULT_STYLE_HASH,
  ONBOARDING_RESULT_SCRIPT_HASH,
  ONBOARDING_RESULT_CSP,
  ONBOARDING_LANDING_STYLE,
  ONBOARDING_LANDING_SCRIPT,
  ONBOARDING_LANDING_STYLE_HASH,
  ONBOARDING_LANDING_SCRIPT_HASH,
  ONBOARDING_LANDING_CSP
};
