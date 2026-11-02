// Vite config. `base` is derived from the GitHub repo name so assets resolve on
// https://<user>.github.io/<repo>/ . Override locally with BASE_PATH=/ .
import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function repoName(): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH;
  const ghRepo = process.env.GITHUB_REPOSITORY; // "user/repo" inside Actions
  if (ghRepo) return `/${ghRepo.split('/')[1]}/`;
  try {
    const url = execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const m = url.match(/\/([^/]+?)(?:\.git)?$/);
    if (m) return `/${m[1]}/`;
  } catch { /* no remote: fall through */ }
  return '/';
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p, root) : [p.slice(root.length + 1)];
  });
}

/** After build: stamp the service worker with a version + precache list so updates invalidate old caches. */
function pwaPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'noclip-pwa',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files = listFiles(outDir).filter((f) => f !== 'sw.js' && !f.includes('cc0/'));
      const version = Date.now().toString(36);
      const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace("'__PRECACHE__'", JSON.stringify(files));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  base: repoName(),
  plugins: [pwaPlugin()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900, sourcemap: false },
  server: { host: true, port: 5173 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as never);
