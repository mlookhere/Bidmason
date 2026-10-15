"""Basic repository security content guard, not a full security review."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
for path in root.rglob('*'):
    if not path.is_file() or '.git' in path.parts or path.suffix not in {'.py', '.js', '.ts', '.json', '.md', '.yml', '.yaml', '.html'}:
        continue
    if any(part in {'node_modules', '.venv'} for part in path.parts):
        continue
    text = path.read_text(encoding='utf-8', errors='replace')
    if re.search(r'(?i)(sk_live_|sk_test_)[0-9a-zA-Z]{12,}', text):
        raise SystemExit(f'Possible embedded payment secret: {path.relative_to(root)}')
print('Basic secret-pattern scan passed; full security validation remains required.')
