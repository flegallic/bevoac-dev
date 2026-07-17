const dns = require('dns').promises;
const { assertPublicHttpTarget } = require('../../src/lib/network-guard');

async function checkDNS(targetUrl, options = {}) {
  try {
    const target = await assertPublicHttpTarget(targetUrl, options.guardConfig || {});
    const records = await dns.resolveTxt(target.hostname);
    const flatRecords = records.flat();
    const hasSPF = flatRecords.some((record) => record.startsWith('v=spf1'));
    const spfRecord = flatRecords.find((record) => record.startsWith('v=spf1')) || null;
    return {
      hostname: target.hostname,
      resolvedAddresses: target.resolvedAddresses,
      spf_configured: hasSPF,
      spf_record: spfRecord,
      txt_records_count: flatRecords.length
    };
  } catch (error) {
    if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') return { spf_configured: false, error: 'No TXT/SPF records found' };
    return { error: `DNS Error: ${error.message}` };
  }
}

module.exports = { checkDNS };
