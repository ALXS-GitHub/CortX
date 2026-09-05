/**
 * Build the `cortx` (CLI/TUI) and `cortx-mcp` sidecars and put them where
 * Tauri expects them, under the target triple it looks for.
 *
 * ## Why this runs on every app build
 *
 * `tauri build` does *not* build sidecars: it copies whatever is already in
 * `src-tauri/binaries/` into the bundle. The release workflow compensates with
 * an explicit `cargo build -p cortx-tui -p cortx-mcp` step before it calls
 * tauri-action — a local build had nothing of the sort, so the two disagreed:
 *
 * - CI produced an installer whose CLI matched the commit;
 * - a local build produced one whose CLI was whatever was last copied in, with
 *   no warning of any kind.
 *
 * That is not academic. The shell integration lives in `cortx-core` and is
 * emitted by **the CLI**, from the `cortx init <shell>` line in the user's
 * profile. So a change to `shell_init.rs` would build, install and run without
 * taking effect, because the app was new and the CLI on PATH was old — twice
 * in one session, once for a whole afternoon.
 *
 * Wiring it into `beforeBuildCommand` closes the gap: local and CI now produce
 * the same thing. Cargo is incremental, so on an unchanged tree this costs a
 * "Finished" line and two file copies; the CI step becomes redundant, which is
 * harmless and worth keeping as a belt.
 *
 * Replaces `build-sidecar.sh`, which was bash-only (awkward on Windows, the
 * platform this project targets first) and handled `cortx-tui` alone.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: frontendDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
  return result.stdout ?? '';
}

/**
 * The host triple, straight from the compiler that will do the build.
 *
 * Never guessed from `process.platform`/`arch`: the naming Tauri resolves is
 * the Rust triple, and only rustc knows which one it is (a gnu vs msvc
 * toolchain on the same Windows, for one).
 */
function hostTriple(): string {
  const verbose = run('rustc', ['-vV']);
  const line = verbose.split('\n').find((l) => l.startsWith('host:'));
  if (!line) throw new Error('rustc -vV printed no host line');
  return line.slice('host:'.length).trim();
}

const host = hostTriple();

/**
 * The triple the bundle is actually for.
 *
 * The release matrix cross-compiles — it builds `x86_64-apple-darwin` on an
 * Apple Silicon runner — so the host is not always the answer. Tauri exports
 * the target it was asked for to `beforeBuildCommand`; without it (a plain
 * `bun run build:sidecars`, or a Tauri that stopped exporting it) the host is
 * the right default, and is what every non-cross job builds anyway.
 */
const fromEnv = process.env.TAURI_ENV_TARGET_TRIPLE?.trim();
const target = fromEnv || host;
const cross = target !== host;
const exe = target.includes('windows') ? '.exe' : '';

// The source is logged on purpose: if Tauri ever stops exporting the variable
// the fallback is silent, and the only place it would go wrong is a
// cross-compiling CI job — the one build nobody watches.
console.log(
  `Building sidecars for ${target} (${fromEnv ? 'from TAURI_ENV_TARGET_TRIPLE' : 'host, no target exported'})${
    cross ? ' — cross-compiling' : ''
  }`
);

// Both crates in one invocation: cargo resolves the shared dependency graph
// (they both pull in cortx-core) once instead of twice. `--target` is passed
// only when it differs from the host, so a local build keeps writing to
// `target/release` and keeps its cache — cargo moves the output under
// `target/<triple>/release` the moment the flag appears, host or not.
run('cargo', [
  'build',
  '--release',
  ...(cross ? ['--target', target] : []),
  '-p',
  'cortx-tui',
  '-p',
  'cortx-mcp',
]);

const releaseDir = cross
  ? join(frontendDir, 'target', target, 'release')
  : join(frontendDir, 'target', 'release');

const outDir = join(frontendDir, 'src-tauri', 'binaries');
mkdirSync(outDir, { recursive: true });

for (const name of ['cortx', 'cortx-mcp']) {
  const from = join(releaseDir, `${name}${exe}`);
  const to = join(outDir, `${name}-${target}${exe}`);
  copyFileSync(from, to);
  console.log(`  ${name}${exe} -> ${to}`);
}
