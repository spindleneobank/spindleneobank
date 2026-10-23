export async function run(
  cmd: string[],
  o: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number } = {},
) {
  const p = Bun.spawn(cmd, { cwd: o.cwd, env: o.env as never, stdout: 'pipe', stderr: 'pipe' });
  const t = setTimeout(() => p.kill(), o.timeoutMs ?? 600_000);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  clearTimeout(t);
  return { cmd: cmd.join(' '), code, stdout: out.slice(-6000), stderr: err.slice(-3000) };
}
