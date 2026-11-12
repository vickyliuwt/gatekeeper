#!/usr/bin/env node
// Run it yourself. The Paste and Scan access code lives in SSM /gatekeeper/demo-code (SecureString).
//   node scripts/gk/demo-code.mjs --show   print it (only in your own terminal; never paste it into a chat or a slide)
//   node scripts/gk/demo-code.mjs --new    set a new random code; gk-submit picks it up within 5 minutes
import { aws, cli, info, newDemoCode, step } from './lib/run.mjs';

export const HELP = 'Usage: node scripts/gk/demo-code.mjs --show | --new';
const NAME = '/gatekeeper/demo-code';

await cli(import.meta.url, HELP, (options) => {
  if (options.renew) {
    aws(['ssm', 'put-parameter', '--name', NAME, '--type', 'SecureString', '--overwrite', '--value', newDemoCode()]);
    info(`${NAME}: new value saved. Run again with --show to read it.`);
  } else if (options.show) {
    step('Access code (keep it out of git, chats, screenshots and the video)');
    process.stdout.write(`${aws(['ssm', 'get-parameter', '--name', NAME, '--with-decryption', '--query', 'Parameter.Value', '--output', 'text']).stdout}\n`);
  } else {
    process.stdout.write(`${HELP}\n`);
  }
});
