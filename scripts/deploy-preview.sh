#!/bin/sh
# Deploy a dedicated, noindex Vercel preview project WITH its waitlist API.
# Usage: sh scripts/deploy-preview.sh [--prepare-only] <project> [tag] [scope]
# Production env means the Production environment of that dedicated preview project.
set -eu
umask 077

PREPARE_ONLY=0
if [ "${1:-}" = '--prepare-only' ]; then
  PREPARE_ONLY=1
  shift
fi
if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then
  printf '%s\n' 'Usage: sh scripts/deploy-preview.sh [--prepare-only] <vercel-project> [tag] [scope]' >&2
  exit 1
fi
DEPLOY_PROJECT="$1"
DEPLOY_TAG="${2:-preview}"
DEPLOY_SCOPE="${3:-}"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
STAGE="$ROOT/.preview/$DEPLOY_PROJECT"
ENV_LIST=''
cleanup() {
  if [ -n "$ENV_LIST" ]; then rm -f "$ENV_LIST"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

command -v python3 >/dev/null 2>&1 || { printf '%s\n' 'Python 3 is required to prepare the deployment.' >&2; exit 1; }

# An explicit allowlist excludes local signup data, env files, credentials and research.
# It stages buildable source, not dist alone, and needs no Git checkout.
python3 - "$ROOT" "$DEPLOY_PROJECT" "$DEPLOY_TAG" <<'PY'
import html, json, re, shutil, sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
project, tag = sys.argv[2:]
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,99}', project):
    raise SystemExit('Use a Vercel project name or ID, not a path.')
previews = root / '.preview'
stage = previews / project
if previews.is_symlink() or stage.is_symlink():
    raise SystemExit('The deployment staging path cannot be a symbolic link.')
items = [
    'src', 'public', 'api', 'server', 'sql', 'admin', 'privacy', 'terms', 'package.json', 'package-lock.json',
    'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vercel.json',
]
required = [
    'api/waitlist.ts', 'api/waitlist/referral.ts', 'api/collect.ts', 'api/stats.ts', 'api/unsubscribe.ts',
    'api/admin/invite.ts', 'api/admin/test-email.ts',
    'server/production-waitlist.ts', 'server/postgres-waitlist.ts', 'server/postgres-analytics.ts',
    'server/analytics.ts', 'server/admin-api.ts', 'server/email.ts', 'server/signup-config.ts', 'server/supabase-ca.ts',
    'server/http.ts', 'server/waitlist.ts',
    'sql/001_waitlist.sql', 'sql/002_email_waitlist.sql', 'sql/003_analytics.sql', 'sql/004_api_role.sql',
    'sql/005_admin_features.sql',
]
for name in items + required:
    candidate = root / name
    if not candidate.exists():
        raise SystemExit(f'Missing deployment source: {name}. No deployment was made.')
    if candidate.is_symlink():
        raise SystemExit(f'Deployment source must be a regular path: {name}.')
    if candidate.is_dir() and any(child.is_symlink() for child in candidate.rglob('*')):
        raise SystemExit(f'Deployment source contains a symbolic link: {name}.')
if 'pg' not in json.loads((root / 'package.json').read_text()).get('dependencies', {}):
    raise SystemExit('The PostgreSQL runtime dependency is missing. No deployment was made.')

previews.mkdir(mode=0o700, exist_ok=True)
stage.mkdir(mode=0o700, exist_ok=True)
stage.chmod(0o700)
link = stage / '.vercel' / 'project.json'
if (stage / '.vercel').is_symlink() or link.is_symlink():
    raise SystemExit('The saved Vercel project link cannot be a symbolic link.')
saved_link = link.read_bytes() if link.is_file() else None
for child in stage.iterdir():
    if child.is_dir() and not child.is_symlink(): shutil.rmtree(child)
    else: child.unlink()
if saved_link is not None:
    link.parent.mkdir(mode=0o700)
    link.write_bytes(saved_link)
for name in items:
    source, target = root / name, stage / name
    if source.is_dir(): shutil.copytree(source, target)
    else: shutil.copy2(source, target)

page = stage / 'index.html'
markup = page.read_text()
markup = re.sub(r'<title>.*?</title>', f'<title>Preview ({html.escape(tag)}) · Open Swarm</title>', markup, count=1, flags=re.S)
robots = '<meta name="robots" content="noindex, nofollow" />'
if re.search(r'<meta\s+name=[\"\x27]robots[\"\x27][^>]*>', markup, re.I):
    markup = re.sub(r'<meta\s+name=[\"\x27]robots[\"\x27][^>]*>', robots, markup, count=1, flags=re.I)
else:
    markup = markup.replace('<head>', '<head>\n    ' + robots, 1)
page.write_text(markup)
# Keep the production routing and headers, and keep every preview page out of search results.
vercel_config = json.loads((stage / 'vercel.json').read_text())
vercel_config['headers'] = [
    {'source': '/(.*)', 'headers': [{'key': 'X-Robots-Tag', 'value': 'noindex, nofollow'}]},
    *vercel_config.get('headers', []),
]
(stage / 'vercel.json').write_text(json.dumps(vercel_config, indent=2) + '\n')
(stage / '.vercelignore').write_text('.data\n.env\n.env.*\n')
print(f'Full website and waitlist API prepared at {stage}')
PY

if [ "$PREPARE_ONLY" -eq 1 ]; then
  printf '%s\n' 'Prepared only. No hosting account, environment variables, database or deployment was accessed.'
  exit 0
fi

for required_command in node npm vercel; do
  command -v "$required_command" >/dev/null 2>&1 || { printf '%s\n' "$required_command is required. Nothing has been deployed." >&2; exit 1; }
done
run_vercel() {
  if [ -n "$DEPLOY_SCOPE" ]; then vercel "$@" --scope "$DEPLOY_SCOPE";
  else vercel "$@"; fi
}

cd "$STAGE"
run_vercel link --yes --project "$DEPLOY_PROJECT"
ENV_LIST="$(mktemp "${TMPDIR:-/tmp}/openswarm-deploy-env.XXXXXX")"
if ! run_vercel env ls production --no-color >"$ENV_LIST" 2>&1; then
  printf '%s\n' 'Could not verify the target project environment. Nothing has been deployed.' >&2
  exit 1
fi
# `env ls` shows metadata, not secret values. Fail closed if the listing cannot be recognized.
python3 - "$ENV_LIST" <<'PY'
import re, sys
from pathlib import Path
listing = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', Path(sys.argv[1]).read_text())
if not re.search(r'^\s*(?:[│┃|]\s*)?DATABASE_URL(?:\s|[│┃|]|$)', listing, re.M):
    raise SystemExit('DATABASE_URL is missing from the target Production environment. Configure the database and apply sql/001_waitlist.sql, sql/002_email_waitlist.sql and sql/003_analytics.sql before deploying. Nothing has been deployed.')
print('Target Production environment has DATABASE_URL. Its value was not displayed.')
PY

# Pull/build uses Vercel's own settings and runtime bundler; the stage is private and Git-ignored.
# No request-time or deploy-time SQL migration is run here.
run_vercel pull --yes --environment=production
npm ci
run_vercel build --prod

# A successful frontend build is insufficient: every Node function must be in the artifact.
python3 - "$STAGE/.vercel/output" <<'PY'
import json, sys
from pathlib import Path
output = Path(sys.argv[1])
if not (output / 'static' / 'index.html').is_file():
    raise SystemExit('Vercel did not produce the website. Nothing has been deployed.')
for name in ('api/waitlist', 'api/waitlist/referral', 'api/collect', 'api/stats', 'api/unsubscribe', 'api/admin/invite', 'api/admin/test-email'):
    bundle = output / 'functions' / f'{name}.func'
    config_file = bundle / '.vc-config.json'
    if not config_file.is_file():
        raise SystemExit(f'Missing built API function: {name}. Refusing a frontend-only deployment.')
    config = json.loads(config_file.read_text())
    handler = config.get('handler')
    if not str(config.get('runtime', '')).startswith('nodejs') or not isinstance(handler, str) or not (bundle / handler).is_file():
        raise SystemExit(f'Invalid Node API bundle: {name}. Nothing has been deployed.')
print('Website and all API function bundles verified.')
PY

run_vercel deploy --prebuilt --prod --yes
