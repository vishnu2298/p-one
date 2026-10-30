#!/usr/bin/env bash
# Builds the web version of the app into ../backend/web so the API can serve it (npm run demo).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf ../backend/web
EXPO_PUBLIC_API_URL=same-origin npx expo export --platform web --output-dir ../backend/web
# Make it installable on a phone ("Add to Home screen") and give it a branded browser bar.
python3 - <<'PY'
import re
p = "../backend/web/index.html"
s = open(p).read()
s = s.replace("<head>", '<head>\n<link rel="manifest" href="/manifest.json">\n<meta name="theme-color" content="#1747C6">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<link rel="apple-touch-icon" href="/icon-192.png">', 1)
s = re.sub(r"<meta name=\"viewport\" content=\"([^\"]*)\"", lambda m: '<meta name="viewport" content="%s, viewport-fit=cover"' % m.group(1) if "viewport-fit" not in m.group(1) else m.group(0), s, count=1)
open(p, "w").write(s)
PY
echo "Built ../backend/web"
