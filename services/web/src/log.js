// one JSON object per line
// stdout.write = pure JSON lines, so Logs Insights can read jobId + traceId
// never log code, the access code or a request body
export function createLogger(svc, write = (line) => process.stdout.write(`${line}\n`)) {
  return function log(stage, fields = {}) {
    const { level = 'info', ...rest } = fields;
    write(JSON.stringify({ ts: new Date().toISOString(), level, svc, stage, ...rest }));
  };
}
