const { execFile } = require('child_process');
const xml2js = require('xml2js');
const { assertPublicHttpTarget } = require('../../src/lib/network-guard');
const { sanitizeString } = require('../../src/lib/result-sanitizer');
const { throwIfAborted } = require('../../src/lib/abort');

async function runNmap(targetUrl, options = {}) {
  return new Promise(async (resolve) => {
    let target;
    let child;
    let settled = false;
    const cleanup = () => options.signal?.removeEventListener?.('abort', onAbort);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onAbort = () => {
      child?.kill('SIGKILL');
      finish({ error: 'Nmap scan aborted', errorCode: 'ABORT_ERR', resolvedAddresses: target?.resolvedAddresses || [] });
    };

    try {
      throwIfAborted(options.signal, 'Nmap scan');
      target = await assertPublicHttpTarget(targetUrl, options.guardConfig || {});
      throwIfAborted(options.signal, 'Nmap scan');
    } catch (error) {
      return finish({ error: sanitizeString(`Invalid or blocked Nmap target: ${error.message}`), errorCode: error.code || null });
    }

    const timeoutMs = options.timeoutMs || 30000;
    const address = target.pinnedAddress;
    child = execFile('nmap', ['-F', '-Pn', '-n', '-oX', '-', address], { timeout: timeoutMs }, (error, stdout) => {
      if (error && error.killed) return finish({ error: `Nmap exceeded the ${timeoutMs} ms timeout limit`, resolvedAddresses: target.resolvedAddresses });
      if (error) return finish({ error: sanitizeString(`Nmap execution error: ${error.message}`), resolvedAddresses: target.resolvedAddresses });
      xml2js.parseString(stdout, (err, result) => {
        if (err) return finish({ error: 'Failed to parse Nmap XML output', resolvedAddresses: target.resolvedAddresses });
        try {
          const openPorts = [];
          const hosts = result.nmaprun.host || [];
          if (hosts.length > 0 && hosts[0].ports && hosts[0].ports[0].port) {
            for (const port of hosts[0].ports[0].port) {
              if (port.state[0].$.state === 'open') openPorts.push({ port: parseInt(port.$.portid, 10), service: port.service ? port.service[0].$.name : 'unknown' });
            }
          }
          finish({ hostname: target.hostname, scannedAddress: address, resolvedAddresses: target.resolvedAddresses, open_ports: openPorts, total_open: openPorts.length });
        } catch {
          finish({ error: 'Structural error in Nmap data', errorCode: 'NMAP_XML_STRUCTURE_INVALID', resolvedAddresses: target.resolvedAddresses });
        }
      });
    });

    if (options.signal) {
      if (options.signal.aborted) return onAbort();
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

module.exports = { runNmap };
