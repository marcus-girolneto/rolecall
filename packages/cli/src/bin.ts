#!/usr/bin/env node
import { main } from './cli.js';

// Exit explicitly: suites often import app code that opens database pools or timers at module load, which would
// otherwise keep the process alive after the run. `rolecall ui` never resolves, so it keeps serving.
main(process.argv.slice(2)).then((code) => process.exit(code));
