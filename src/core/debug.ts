/**
 * Debug console command registry (spec 0.3 #2). Dev builds, or any build opened with ?debug=1.
 * Commands that depend on later-phase systems are registered with a `phase` tag so they report
 * honestly instead of silently doing nothing.
 */

export interface DebugApi {
  print(msg: string): void;
  [k: string]: unknown;
}

export interface Command { name: string; help: string; phase?: number; run(args: string[], api: DebugApi): void | Promise<void> }

export const debugEnabled = (): boolean => {
  try { return import.meta.env.DEV || new URLSearchParams(location.search).has('debug'); } catch { return false; }
};

/** Phase-gated commands from the spec that need systems which do not exist yet. */
export const FUTURE_COMMANDS: { name: string; help: string; phase: number }[] = [
  { name: 'ending', help: 'ending <1-6> : trigger an ending', phase: 5 },
];

export function parseLine(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

export class CommandRegistry {
  private cmds = new Map<string, Command>();
  history: string[] = [];

  register(c: Command): void { this.cmds.set(c.name, c); }
  list(): Command[] { return [...this.cmds.values()].sort((a, b) => a.name.localeCompare(b.name)); }

  async exec(line: string, api: DebugApi): Promise<void> {
    const [name, ...args] = parseLine(line);
    if (!name) return;
    this.history.push(line);
    const c = this.cmds.get(name.toLowerCase());
    if (!c) { api.print(`unknown command "${name}" (try "help")`); return; }
    if (c.phase) { api.print(`"${name}" needs systems that arrive in Phase ${c.phase}.`); return; }
    try { await c.run(args, api); } catch (e) { api.print(`error: ${(e as Error).message}`); }
  }

  /** Tab completion: the unique command starting with `prefix`, or the common prefix. */
  complete(prefix: string): string {
    const m = this.list().map((c) => c.name).filter((n) => n.startsWith(prefix));
    if (m.length === 1) return m[0];
    if (!m.length) return prefix;
    let p = m[0];
    for (const n of m) while (!n.startsWith(p)) p = p.slice(0, -1);
    return p;
  }
}
