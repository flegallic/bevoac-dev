const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');

function loadSchema() {
  const schemaPath = path.join(__dirname, '..', '..', 'contracts', 'scan-request.schema.json');
  const raw = fs.readFileSync(schemaPath, 'utf8');
  return JSON.parse(raw);
}

const schema = loadSchema();
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true
});
addFormats(ajv);
const validate = ajv.compile(schema);

function formatErrors(errors) {
  return (errors || []).map((item) => ({
    path: item.instancePath || item.schemaPath || '/',
    message: item.message
  }));
}

function validateScanRequestedMessage(payload) {
  const valid = validate(payload);
  if (valid) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: formatErrors(validate.errors)
  };
}

// Backward-compatible export name to avoid runtime mismatches.
const validateScanRequest = validateScanRequestedMessage;

module.exports = {
  validateScanRequestedMessage,
  validateScanRequest
};
