import { spawnSync } from 'node:child_process';

const owner = 'Printrune';
const repository = 'battlebots-arena';
const execute = process.argv.includes('--publish');
const commitMessage = process.argv.find((argument) => argument.startsWith('--message='))?.slice('--message='.length)
  || 'Build mobile BattleBots arena with private multiplayer';

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr?.trim() ?? 'Git operation failed.');
  return result.stdout.trim();
}

const credentials = git(['credential', 'fill'], { input: `protocol=https\nhost=github.com\nusername=${owner}\n\n`, timeout: 5_000 });
const credentialValues = Object.fromEntries(credentials.split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
if (!credentialValues.password) throw new Error('No GitHub credential is available. Sign in with the approved account.');

async function github(route, options = {}) {
  return fetch(`https://api.github.com${route}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${credentialValues.password}`, 'Content-Type': 'application/json' },
  });
}

const profileResponse = await github('/user');
if (!profileResponse.ok) throw new Error(`GitHub authentication failed: ${profileResponse.status}`);
const profile = await profileResponse.json();
if (profile.login?.toLowerCase() !== owner.toLowerCase()) throw new Error(`The available credential belongs to ${profile.login}; expected ${owner}.`);

const repositoryResponse = await github(`/repos/${owner}/${repository}`);
if (!execute) {
  process.stdout.write(`${JSON.stringify({ authenticatedAs: profile.login, repository: `${owner}/${repository}`, exists: repositoryResponse.ok, action: 'Run with --publish after verification to create the public repository and push the game.' })}\n`);
  process.exit(0);
}
if (repositoryResponse.status === 404) {
  const created = await github('/user/repos', { method: 'POST', body: JSON.stringify({ name: repository, private: false, description: 'Mobile-first 3D BattleBots arcade arena. Private online 1v1, practice, touch controls, and password-protected access.' }) });
  if (!created.ok) throw new Error(`Repository creation failed: ${created.status} ${await created.text()}`);
} else if (!repositoryResponse.ok) {
  throw new Error(`Cannot inspect repository: ${repositoryResponse.status}`);
}

const branch = git(['branch', '--show-current']);
if (!branch.startsWith('codex/')) git(['switch', '-c', 'codex/arena-demo']);
git(['add', '--all']);
const stagedFiles = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
if (stagedFiles.some((file) => /(^|\/)\.env($|\.(?!example$))|(^|\/)\.local\//.test(file))) throw new Error('A private environment file was staged. Remove it before publishing.');
if (stagedFiles.length) {
  git(['-c', `user.name=${owner}`, '-c', `user.email=${profile.id}+${owner}@users.noreply.github.com`, 'commit', '-m', commitMessage]);
}
const remote = `https://github.com/${owner}/${repository}.git`;
const remotes = git(['remote']);
if (!remotes.split('\n').includes('origin')) git(['remote', 'add', 'origin', remote]);
else if (git(['remote', 'get-url', 'origin']) !== remote) throw new Error('Origin points elsewhere. Refusing to change the existing remote.');
git(['push', '--set-upstream', 'origin', git(['branch', '--show-current'])], { timeout: 120_000 });
process.stdout.write(`${JSON.stringify({ repository: `https://github.com/${owner}/${repository}`, branch: git(['branch', '--show-current']), commit: git(['rev-parse', '--short', 'HEAD']) })}\n`);
