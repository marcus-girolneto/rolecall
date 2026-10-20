import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';
import {
  compareRuns,
  generateSigningKeyPair,
  type RunMode,
  readBundle,
  runSuite,
  type SuiteDef,
  toJUnit,
  verifyBundle,
  writeBundle,
} from '@rolecall/core';
import { cac } from 'cac';
import { type AttackGenerator, generateAttackFile, loadGenerator } from './attacks.js';
import { pushBundle } from './cloud.js';
import { c, printRun, printVerify } from './console.js';
import { detectPullRequest, upsertPrComment } from './github.js';
import { initWizard, nextSteps, type Prompter } from './init.js';
import { projectLoader } from './loader.js';
import { toMarkdown } from './markdown.js';
import { listRuns, loadRunDetail } from './runs.js';
import { renderDashboard, startDashboard } from './server.js';
import { VERSION } from './version.js';

const DEFAULT_SUITE = 'rolecall.suite.ts';
const DEFAULT_RUNS = '.rolecall/runs';

export interface CliIO {
  /** Answers interactive questions. Defaults to the terminal when stdin is a TTY. */
  prompt?: Prompter;
  /** Overrides how `rolecall attacks` gets its generator and model (tests). */
  attacks?: { generator: AttackGenerator; model: unknown };
}

export async function main(argv: string[], cwd = process.cwd(), io: CliIO = {}): Promise<number> {
  loadDotEnv(cwd);
  const cli = cac('rolecall');
  let exitCode = 0;
  let pending: Promise<void> | undefined;
  const action =
    <A extends unknown[]>(fn: (...args: A) => Promise<number | undefined>) =>
    (...args: A) => {
      pending = fn(...args).then((code) => {
        exitCode = code ?? 0;
      });
    };

  cli
    .command('run [suite]', 'Run a suite and write an evidence bundle')
    .option('--mode <mode>', 'replay | record | live', { default: 'replay' })
    .option('--out <dir>', 'Where evidence bundles are written', { default: DEFAULT_RUNS })
    .option('--cassettes <dir>', 'Where model recordings live', { default: 'rolecall/cassettes' })
    .option('--baseline <ref>', 'Bundle directory to compare against, or "latest"')
    .option('--filter <text>', 'Only run tests whose id contains this text')
    .option('--junit <file>', 'Also write JUnit XML')
    .option('--strict', 'Treat warnings as failures')
    .option('--push', 'Upload the bundle to Rolecall Cloud (needs ROLECALL_API_KEY)')
    .option(
      '--comment',
      'Post the result as a comment on the pull request (GitHub Actions, needs GITHUB_TOKEN)',
    )
    .action(
      action(async (suiteArg: string | undefined, o: Record<string, unknown>) => {
        const mode = String(o.mode) as RunMode;
        if (!['replay', 'record', 'live'].includes(mode))
          throw new Error(`--mode must be replay, record or live (got "${mode}")`);
        const suiteFile = resolve(cwd, suiteArg ?? DEFAULT_SUITE);
        if (!existsSync(suiteFile))
          throw new Error(`Suite not found: ${suiteFile}. Create one with \`rolecall init\`.`);
        const suite = await loadSuite(suiteFile);
        const outDir = resolve(cwd, String(o.out));

        const baselineDir =
          o.baseline === 'latest'
            ? listRuns(outDir).find((r) => r.suite.name === suite.name)?.id
            : typeof o.baseline === 'string'
              ? o.baseline
              : undefined;

        const run = await runSuite(suite, {
          cwd,
          mode,
          cassetteDir: resolve(cwd, String(o.cassettes)),
          ...(o.filter ? { filter: String(o.filter) } : {}),
        });
        const bundle = writeBundle(run, {
          outDir,
          producerVersion: VERSION,
          suiteFile,
          cwd,
          ...(signingKey() ? { signingKey: signingKey() } : {}),
        });

        const comparison = baselineDir
          ? compareRuns(
              run.result,
              readBundle(o.baseline === 'latest' ? join(outDir, baselineDir) : resolve(cwd, baselineDir))
                .result,
            )
          : undefined;
        printRun(run.result, comparison ? { comparison } : {});
        const shown = relative(cwd, bundle.dir) || bundle.dir;
        console.log(
          c.dim(
            `\nDetails: ${c.cyan('rolecall ui')}   ·   evidence saved in ${shown}${bundle.signed ? ' (signed)' : ''}`,
          ),
        );

        if (o.junit) write(resolve(cwd, String(o.junit)), toJUnit(run.result));
        if (process.env.GITHUB_STEP_SUMMARY) {
          appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            toMarkdown(run.result, { ...(comparison ? { comparison } : {}), bundleDir: bundle.dir }),
          );
        }
        if (o.comment) {
          const pr = detectPullRequest();
          const token = process.env.GITHUB_TOKEN;
          if (!pr || !token) {
            console.log(
              c.dim('PR comment skipped: not running for a pull request, or GITHUB_TOKEN is missing.'),
            );
          } else {
            try {
              const body = toMarkdown(run.result, {
                ...(comparison ? { comparison } : {}),
                bundleDir: bundle.dir,
                marker: true,
              });
              const posted = await upsertPrComment({
                pr,
                token,
                body,
                ...(process.env.GITHUB_API_URL ? { apiUrl: process.env.GITHUB_API_URL } : {}),
              });
              console.log(
                `${c.green('✔')} PR comment ${posted.action}${posted.url ? `: ${posted.url}` : ''}`,
              );
            } catch (e) {
              // A comment is a convenience; it must never hide the test verdict.
              console.log(
                `${c.yellow('▲')} Could not comment on the PR: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
        }
        if (o.push) {
          const pushed = await pushBundle(bundle.dir, cloudConfig());
          console.log(`${c.green('✔ uploaded')} run ${pushed.id}${pushed.url ? ` → ${pushed.url}` : ''}`);
        }

        const s = run.result.summary;
        const failed =
          s.fail + s.error > 0 || (o.strict && s.warn > 0) || (comparison?.regressions.length ?? 0) > 0;
        return failed ? 1 : 0;
      }),
    );

  cli
    .command('verify <bundle>', 'Recompute hashes and check the signature of an evidence bundle')
    .option('--public-key <file>', 'Trusted Ed25519 public key (PEM) the bundle must be signed with')
    .action(
      action(async (dir: string, o: Record<string, unknown>) => {
        const publicKey = o.publicKey ? readFileSync(resolve(cwd, String(o.publicKey)), 'utf8') : undefined;
        const report = verifyBundle(resolve(cwd, dir), publicKey ? { publicKey } : {});
        printVerify(dir, report);
        return report.ok ? 0 : 1;
      }),
    );

  cli
    .command('report <bundle>', 'Export a bundle as html, junit or json')
    .option('--format <format>', 'html | junit | json', { default: 'html' })
    .option('-o, --output <file>', 'Output file (default: next to the bundle)')
    .action(
      action(async (dir: string, o: Record<string, unknown>) => {
        const bundleDir = resolve(cwd, dir);
        const { result, manifest } = readBundle(bundleDir);
        const format = String(o.format);
        const ext = { html: 'html', junit: 'xml', json: 'json' }[format];
        if (!ext) throw new Error('--format must be html, junit or json');
        const file = resolve(cwd, o.output ? String(o.output) : join(bundleDir, `report.${ext}`));
        if (format === 'junit') write(file, toJUnit(result));
        else if (format === 'json') write(file, `${JSON.stringify(result, null, 2)}\n`);
        else {
          const runsDir = dirname(bundleDir);
          const detail = loadRunDetail(runsDir, manifest.runId);
          const item = listRuns(runsDir).find((r) => r.id === manifest.runId);
          if (!detail || !item) throw new Error(`Could not load run ${manifest.runId}`);
          write(file, renderDashboard({ mode: 'static', runs: [item], details: { [item.id]: detail } }));
        }
        console.log(`${c.green('✔')} wrote ${file}`);
        return 0;
      }),
    );

  cli
    .command('ui', 'Open the local dashboard for your runs')
    .option('--port <port>', 'Port', { default: 4300 })
    .option('--runs <dir>', 'Runs directory', { default: DEFAULT_RUNS })
    .action(
      action(async (o: Record<string, unknown>) => {
        const port = Number(o.port);
        await startDashboard(resolve(cwd, String(o.runs)), port);
        console.log(
          `${c.bold('rolecall')} dashboard on ${c.cyan(`http://127.0.0.1:${port}`)} ${c.dim('(Ctrl+C to stop)')}`,
        );
        await new Promise(() => {});
        return 0;
      }),
    );

  cli
    .command('keygen', 'Create an Ed25519 key pair for signing evidence bundles')
    .option('--out <dir>', 'Directory for the key files', { default: '.rolecall/keys' })
    .action(
      action(async (o: Record<string, unknown>) => {
        const dir = resolve(cwd, String(o.out));
        const keys = generateSigningKeyPair();
        write(join(dir, 'rolecall-signing.key'), keys.privateKeyPem, 0o600);
        write(join(dir, 'rolecall-signing.pub'), keys.publicKeyPem);
        console.log(`${c.green('✔')} key ${keys.keyId} written to ${dir}`);
        console.log(c.dim('Store the private key as a CI secret: ROLECALL_SIGNING_KEY. Never commit it.'));
        return 0;
      }),
    );

  cli.command('push <bundle>', 'Upload an evidence bundle to Rolecall Cloud').action(
    action(async (dir: string) => {
      const pushed = await pushBundle(resolve(cwd, dir), cloudConfig());
      console.log(`${c.green('✔ uploaded')} run ${pushed.id}${pushed.url ? ` → ${pushed.url}` : ''}`);
      return 0;
    }),
  );

  cli
    .command('init', 'Answer a few questions and get a rolecall.suite.ts for your agent')
    .option('--template', 'Skip the questions and write a commented template')
    .action(
      action(async (o: Record<string, unknown>) => {
        const file = resolve(cwd, DEFAULT_SUITE);
        if (existsSync(file))
          throw new Error(`${DEFAULT_SUITE} already exists. Delete it first to start over.`);
        const prompt = io.prompt ?? (process.stdin.isTTY && !o.template ? terminalPrompter() : undefined);
        if (!prompt) {
          write(file, STARTER_SUITE);
          console.log(
            `${c.green('✔')} created ${DEFAULT_SUITE} from the template. Edit it, then run \`rolecall run\`.`,
          );
          return 0;
        }
        try {
          const made = await initWizard(cwd, prompt, (line) => console.log(line));
          if (!made) {
            console.log(
              `\nNo tools found. Run ${c.cyan('rolecall init --template')} to start from a commented template.`,
            );
            return 1;
          }
          write(resolve(cwd, made.file), made.content);
          console.log('');
          for (const line of nextSteps(made.file))
            console.log(line.startsWith('Created') ? `${c.green('✔')} ${line}` : line);
          return 0;
        } finally {
          prompt.close?.();
        }
      }),
    );

  cli
    .command(
      'attacks [suite]',
      'Use AI to write attacks against every blocked action, then run them with `rolecall run`',
    )
    .option('--model <id>', 'OpenRouter model that writes the attacks (or ROLECALL_ATTACK_MODEL)')
    .option('--per-cell <n>', 'Attacks per blocked action', { default: 4 })
    .option('--context <text>', 'One line about your product, for more realistic attacks')
    .option('--out <file>', 'Where to save them (default rolecall/attacks.json)')
    .action(
      action(async (suiteArg: string | undefined, o: Record<string, unknown>) => {
        const suiteFile = resolve(cwd, suiteArg ?? DEFAULT_SUITE);
        if (!existsSync(suiteFile))
          throw new Error(`Suite not found: ${suiteFile}. Create one with \`rolecall init\`.`);
        const suite = await loadSuite(suiteFile);
        const modelId = String(o.model ?? process.env.ROLECALL_ATTACK_MODEL ?? '');
        let generator: AttackGenerator;
        let model: unknown;
        if (io.attacks) {
          ({ generator, model } = io.attacks);
        } else {
          if (!modelId) {
            throw new Error(
              'Choose the model that writes attacks: --model anthropic/claude-sonnet-4.5, or ROLECALL_ATTACK_MODEL in .env (any OpenRouter model id).',
            );
          }
          generator = await loadGenerator(cwd);
          model = generator.openRouterModel(modelId);
        }
        const made = await generateAttackFile({
          cwd,
          suite,
          generator,
          model,
          modelId: modelId || 'injected',
          perCell: Number(o.perCell),
          ...(o.out ? { out: String(o.out) } : {}),
          ...(o.context ? { appContext: String(o.context) } : {}),
          log: (line) => console.log(line),
        });
        console.log(
          `\n${c.green('✔')} ${made.count} attacks saved to ${relative(cwd, made.file)}${made.failed ? c.yellow(` (${made.failed} blocked actions failed)`) : ''}`,
        );
        console.log(
          `Review them, commit the file, then run ${c.cyan('rolecall run')}: each attack becomes a conversation with your agent.`,
        );
        return made.count ? 0 : 1;
      }),
    );

  cli.help();
  cli.version(VERSION);

  try {
    cli.parse(['node', 'rolecall', ...argv], { run: false });
    if (!cli.matchedCommand && !argv.some((a) => ['-h', '--help', '-v', '--version'].includes(a))) {
      cli.outputHelp();
      return argv.length ? 1 : 0;
    }
    await cli.runMatchedCommand();
    await pending;
    return exitCode;
  } catch (e) {
    console.error(`${c.red('rolecall:')} ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

async function loadSuite(file: string): Promise<SuiteDef<unknown, unknown>> {
  const jiti = projectLoader(file);
  const mod = await jiti.import<{ default?: SuiteDef<unknown, unknown> }>(file);
  const suite =
    (mod as { default?: SuiteDef<unknown, unknown> }).default ?? (mod as SuiteDef<unknown, unknown>);
  if (!suite || typeof suite !== 'object' || !('agent' in suite)) {
    throw new Error(`${file} must \`export default defineSuite({...})\``);
  }
  return suite;
}

/** Loads `.env` from the project without overriding variables that are already set. */
function loadDotEnv(cwd: string): void {
  const file = join(cwd, '.env');
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function terminalPrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: async (question, def) => {
      const answer = (await rl.question(`${question}${def ? c.dim(` [${def}]`) : ''} `)).trim();
      return answer || def || '';
    },
    close: () => rl.close(),
  };
}

function signingKey(): string | undefined {
  if (process.env.ROLECALL_SIGNING_KEY) return process.env.ROLECALL_SIGNING_KEY;
  const file = process.env.ROLECALL_SIGNING_KEY_FILE;
  return file ? readFileSync(file, 'utf8') : undefined;
}

function cloudConfig() {
  const apiKey = process.env.ROLECALL_API_KEY;
  if (!apiKey)
    throw new Error('ROLECALL_API_KEY is not set. Create a key in Rolecall Cloud → Project settings.');
  return { apiKey, apiUrl: process.env.ROLECALL_API_URL ?? 'https://api.rolecall.dev' };
}

function write(file: string, content: string, mode?: number) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, mode ? { mode } : {});
}

const STARTER_SUITE = `import { aiSdkAgent } from '@rolecall/ai-sdk';
import { defineSuite } from '@rolecall/core';
// import { createTools } from './src/tools';      // your AI SDK tool factory: (ctx, user) => ToolSet
// import { openai } from '@ai-sdk/openai';

export default defineSuite({
  name: 'My agent',
  // memory: runs anywhere. sandbox/staging: requires ROLECALL_ALLOW_LIVE=1. Production is never allowed.
  target: { kind: 'memory', name: 'test fixtures' },
  roles: {
    viewer: { id: 'u_viewer', role: 'viewer' },
    admin: { id: 'u_admin', role: 'admin' },
  },
  setup: () => ({ /* fresh state for every test */ }),
  snapshot: (ctx) => ctx, // what tools can change; compared before and after every test

  agent: aiSdkAgent({
    model: undefined as never, // e.g. openai('gpt-5-mini'); record once with --mode record, then replay offline
    tools: (ctx, user) => ({}), // createTools(ctx, user)
  }),

  policy: [
    // { role: 'viewer', tool: 'deleteRecord', args: { id: 'r1' }, expect: 'deny' },
    // { role: 'admin', tool: 'deleteRecord', args: { id: 'r1' }, expect: 'allow', state: 'changed' },
  ],
  scenarios: [
    // { name: 'Viewer asks to delete', role: 'viewer', turns: ['Delete record r1'], forbid: ['deleteRecord'] },
  ],
});
`;
