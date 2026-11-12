// One JSON object per line (README.md, "Logs").
// process.stdout.write keeps each line pure JSON in CloudWatch, so Logs Insights can
// read jobId and traceId as fields. Never pass code, the access code or a request body here.
export function createLogger(svc, write = (line) => process.stdout.write(`${line}\n`)) {
  return function log(stage, fields = {}) {
    const { level = 'info', ...rest } = fields;
    write(JSON.stringify({ ts: new Date().toISOString(), level, svc, stage, ...rest }));
  };
}
