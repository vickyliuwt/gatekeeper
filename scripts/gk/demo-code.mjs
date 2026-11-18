#!/usr/bin/env node
// the access code lives in SSM as a secure string
// the show flag prints it
// only in your own terminal
// the new flag makes a new random code
// it is live in 5 min
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
