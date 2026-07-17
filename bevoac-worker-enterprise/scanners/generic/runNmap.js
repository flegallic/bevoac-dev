const { execFile } = require('child_process');
const xml2js = require('xml2js');
const { assertPublicHttpTarget } = require('../../src/lib/network-guard');

async function runNmap(targetUrl, options = {}) {
  return new Promise(async (resolve) => {
    let target;
    try {
      target = await assertPublicHttpTarget(targetUrl, options.guardConfig || {});
    } catch (error) {
      return resolve({ error: `Invalid or blocked Nmap target: ${error.message}` });
    }
    const timeoutMs = options.timeoutMs || 30000;
    const address = target.pinnedAddress;
    execFile('nmap', ['-F', '-Pn', '-n', '-oX', '-', address], { timeout: timeoutMs }, (error, stdout) => {
      if (error && error.killed) return resolve({ error: `Nmap exceeded the ${timeoutMs} ms timeout limit`, resolvedAddresses: target.resolvedAddresses });
      if (error) return resolve({ error: `Nmap execution error: ${error.message}`, resolvedAddresses: target.resolvedAddresses });
      xml2js.parseString(stdout, (err, result) => {
        if (err) return resolve({ error: 'Failed to parse Nmap XML output', resolvedAddresses: target.resolvedAddresses });
        try {
          const openPorts = [];
          const hosts = result.nmaprun.host || [];
          if (hosts.length > 0 && hosts[0].ports && hosts[0].ports[0].port) {
            for (const p of hosts[0].ports[0].port) {
              if (p.state[0].$.state === 'open') openPorts.push({ port: parseInt(p.$.portid, 10), service: p.service ? p.service[0].$.name : 'unknown' });
            }
          }
          resolve({ hostname: target.hostname, scannedAddress: address, resolvedAddresses: target.resolvedAddresses, open_ports: openPorts, total_open: openPorts.length });
        } catch (parseError) {
          resolve({ error: 'Structural error in Nmap data', details: parseError.message, resolvedAddresses: target.resolvedAddresses });
        }
      });
    });
  });
}

module.exports = { runNmap };
