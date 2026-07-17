async function withTimeout(label, timeoutMs, fn) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(fn), timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function settleModule(label, timeoutMs, fn) {
  try {
    return await withTimeout(label, timeoutMs, fn);
  } catch (error) {
    return { error: error.message, timeoutMs };
  }
}

module.exports = { withTimeout, settleModule };
