import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { projectLoader } from './loader.js';

export interface Prompter {
  ask(question: string, defaultValue?: string): Promise<string>;
  close?(): void;
}

interface ToolLike {
  description?: string;
  inputSchema?: unknown;
  execute?: unknown;
}

export interface DiscoveredTools {
  file: string;
  exportName: string;
  /** How many parameters the factory takes (0 = the export is the tool set itself). */
  arity: number;
  tools: Record<string, ToolLike>;
}

const CANDIDATES = [
  'src/tools.ts',
  'src/agent/tools.ts',
  'src/ai/tools.ts',
  'lib/tools.ts',
  'tools.ts',
  'src/tools/index.ts',
];
const READ_ONLY = /^(list|get|read|search|find|show|fetch|lookup|view)/i;

/** Guesses where the agent's tools live: well-known paths first, then any file under src/ that calls `tool(`. */
export function guessToolsFile(cwd: string): string | undefined {
  const known = CANDIDATES.find((f) => existsSync(join(cwd, f)));
  if (known) return known;
  const hits: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || hits.length > 20) return;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, depth + 1);
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && /\btool\(\s*\{/.test(readFileSync(full, 'utf8')))
        hits.push(full);
    }
  };
  if (existsSync(join(cwd, 'src'))) walk(join(cwd, 'src'), 0);
  return hits[0] ? relative(cwd, hits[0]) : undefined;
}

const looksLikeToolSet = (v: unknown): v is Record<string, ToolLike> =>
  typeof v === 'object' &&
  v !== null &&
  Object.keys(v).length > 0 &&
  Object.values(v).every(
    (t) => typeof t === 'object' && t !== null && ('inputSchema' in t || 'execute' in t),
  );

/**
 * Imports the file and finds an exported tool set, or a factory returning one. Factories are called with
 * placeholder arguments; building AI SDK tools does not run them, so this is safe for typical code.
 */
export async function discoverTools(cwd: string, file: string): Promise<DiscoveredTools | undefined> {
  const jiti = projectLoader(join(cwd, file));
  const mod = (await jiti.import(join(cwd, file))) as Record<string, unknown>;
  for (const [exportName, value] of Object.entries(mod)) {
    if (looksLikeToolSet(value)) return { file, exportName, arity: 0, tools: value };
    if (typeof value !== 'function') continue;
    const placeholder = new Proxy({}, { get: () => undefined });
    try {
      const out = value(placeholder, { id: 'rolecall', role: 'admin' });
      if (looksLikeToolSet(out)) return { file, exportName, arity: value.length, tools: out };
    } catch {
      // not a tool factory, or it needs real arguments
    }
  }
  return undefined;
}

/** A minimal valid-looking value for a JSON schema, so users only edit what matters. */
export function sampleFromJsonSchema(schema: unknown): unknown {
  const s = (schema ?? {}) as {
    type?: string | string[];
    properties?: Record<string, unknown>;
    required?: string[];
    enum?: unknown[];
    default?: unknown;
    anyOf?: unknown[];
  };
  if (s.default !== undefined) return s.default;
  if (s.enum?.length) return s.enum[0];
  if (s.anyOf?.length) return sampleFromJsonSchema(s.anyOf[0]);
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (type === 'object' || s.properties) {
    const out: Record<string, unknown> = {};
    for (const key of s.required ?? []) out[key] = sampleFromJsonSchema(s.properties?.[key]);
    return out;
  }
  if (type === 'string') return 'TODO';
  if (type === 'number' || type === 'integer') return 1;
  if (type === 'boolean') return true;
  if (type === 'array') return [];
  return null;
}

function exampleFor(tool: ToolLike): unknown {
  const schema = tool.inputSchema as { toJSONSchema?: () => unknown; jsonSchema?: unknown } | undefined;
  try {
    if (typeof schema?.toJSONSchema === 'function') return sampleFromJsonSchema(schema.toJSONSchema());
    if (schema?.jsonSchema && typeof schema.jsonSchema === 'object')
      return sampleFromJsonSchema(schema.jsonSchema);
  } catch {
    // fall through
  }
  return {};
}

const list = (answer: string) =>
  answer
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Interactive `rolecall init`: finds the tools, asks who may use each one, writes rolecall.suite.ts. */
export async function initWizard(
  cwd: string,
  prompt: Prompter,
  log: (line: string) => void,
): Promise<{ file: string; content: string } | undefined> {
  log('Let’s describe who may do what in your agent. Press Enter to accept the suggestion in [brackets].\n');

  let found: DiscoveredTools | undefined;
  let toolsFile = guessToolsFile(cwd);
  for (let attempt = 0; attempt < 3 && !found; attempt++) {
    toolsFile = await prompt.ask('Where are your agent’s tools defined?', toolsFile);
    if (!toolsFile || !existsSync(join(cwd, toolsFile))) {
      log(`  Can't find "${toolsFile ?? ''}". Give the path from this folder, e.g. src/tools.ts`);
      toolsFile = undefined;
      continue;
    }
    try {
      found = await discoverTools(cwd, toolsFile);
    } catch (e) {
      log(`  Could not load ${toolsFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!found)
      log(`  No AI SDK tools found in ${toolsFile}. Export the tool set, or a function that returns it.`);
  }
  if (!found) return undefined;

  const toolNames = Object.keys(found.tools);
  log(`  Found ${toolNames.length} tools in ${found.exportName}(): ${toolNames.join(', ')}\n`);

  let roles: string[] = [];
  while (!roles.length)
    roles = list(
      await prompt.ask('What kinds of users does your app have? (comma-separated)', 'viewer, admin'),
    );

  log('\nFor each tool, list the users allowed to use it. Everyone else will be checked as blocked.');
  const allowed: Record<string, string[]> = {};
  for (const tool of toolNames) {
    const suggestion = READ_ONLY.test(tool) ? roles.join(', ') : (roles[roles.length - 1] ?? '');
    const answer = list(await prompt.ask(`  Who may use ${tool}?`, suggestion));
    const unknown = answer.filter((r) => !roles.includes(r));
    if (unknown.length) log(`    Ignoring unknown user type(s): ${unknown.join(', ')}`);
    allowed[tool] = answer.filter((r) => roles.includes(r));
  }

  const content = renderSuite({ found, roles, allowed, suiteName: projectName(cwd) });
  return { file: 'rolecall.suite.ts', content };
}

function projectName(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name) return `${pkg.name} agent`;
  } catch {
    // no package.json
  }
  return `${basename(cwd)} agent`;
}

/** JSON → a JS object literal in the repo's style: unquoted keys, single quotes. */
function literal(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${literal(v)}`,
    );
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : JSON.stringify(value);
}

function renderSuite(input: {
  found: DiscoveredTools;
  roles: string[];
  allowed: Record<string, string[]>;
  suiteName: string;
}): string {
  const { found, roles, allowed } = input;
  const tools = Object.keys(found.tools);
  const importPath = `./${found.file.replace(extname(found.file), '.js').replace(/\\/g, '/')}`;
  const id = (s: string) => (/^[A-Za-z_$][\w$]*$/.test(s) ? s : JSON.stringify(s));
  const call =
    found.arity === 0
      ? found.exportName
      : found.arity === 1
        ? `${found.exportName}(user)`
        : `${found.exportName}(data, user)`;

  const permissionRows = roles
    .map((role) => {
      const cells = tools
        .map((t) => `${id(t)}: '${allowed[t]?.includes(role) ? 'allow' : 'deny'}'`)
        .join(', ');
      return `    ${id(role)}: { ${cells} },`;
    })
    .join('\n');
  const exampleRows = tools
    .map((t) => `    ${id(t)}: ${literal(exampleFor(found.tools[t] as ToolLike))},`)
    .join('\n');
  const roleRows = roles.map((r) => `    ${id(r)}: { id: 'test-${r}', role: '${r}' },`).join('\n');
  const firstDenied = roles
    .flatMap((r) => tools.filter((t) => !allowed[t]?.includes(r)).map((t) => ({ r, t })))
    .at(0);

  return `import { aiSdkAgent } from '@rolecall/ai-sdk';
import { defineSuite } from '@rolecall/core';
import { ${found.exportName} } from '${importPath.replace(/^\.\/\.\//, './')}';

export default defineSuite({
  name: ${literal(input.suiteName)},
  // Rolecall calls your real tools. 'memory' = test data created in setup() below.
  target: { kind: 'memory', name: 'test data' },

  // 1. Your users. Shape each one like the signed-in user your tools check (id, role, tenant…).
  roles: {
${roleRows}
  },

  // 2. Fresh test data for every check (e.g. an in-memory store or a test database),
  //    and the part of it your tools can change, so Rolecall can show what changed.
  setup: () => ({}), // TODO: create the records your tools need
  snapshot: (data) => data,

  // 3. Your agent's tools, built for a given user.
  agent: aiSdkAgent({
    tools: (${found.arity >= 2 ? 'data' : '_data'}, ${found.arity >= 1 ? 'user' : '_user'}) => ${call}, // TODO: adjust if your factory needs other arguments
    // model: openai('gpt-5-mini'), // needed only for the conversations in step 5
  }),

  // 4. Who may use which tool. Edit freely.
  permissions: {
${permissionRows}
  },
  // One valid input per tool. Replace TODO with IDs that exist in your setup() data.
  examples: {
${exampleRows}
  },

  // 5. Optional: real conversations, including attacks. Needs \`model\` above.
  scenarios: [
${
  firstDenied
    ? `    // { name: '${firstDenied.r} asks for ${firstDenied.t}', role: '${firstDenied.r}', turns: ['Please run ${firstDenied.t}'], forbid: ['${firstDenied.t}'] },`
    : '    // { name: …, role: …, turns: […], forbid: [toolName] },'
}
  ],
});
`;
}

export function nextSteps(file: string): string[] {
  return [
    `Created ${file}. Next:`,
    '  1. Fill in setup() and replace the TODO example values with real test data.',
    '  2. Run:  npx rolecall run',
    `  3. Open the results:  npx rolecall ui`,
  ];
}
