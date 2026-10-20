import { writeFileSync } from 'node:fs';
import { listRuns, loadRunDetail } from 'rolecall';

const dir = process.argv[2];
const runs = listRuns(dir);
const details = Object.fromEntries(runs.map((r) => [r.id, loadRunDetail(dir, r.id)]));
writeFileSync(process.argv[3], JSON.stringify({ mode: 'static', runs, details }, null, 2));
console.log('runs', runs.length);
