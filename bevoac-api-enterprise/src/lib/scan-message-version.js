const { scanMessageVersion } = require('../../contracts/scan-message-version.json');
if (!scanMessageVersion || typeof scanMessageVersion !== 'string') throw new Error('Invalid scan message contract version.');
module.exports = { SCAN_MESSAGE_VERSION: scanMessageVersion };
