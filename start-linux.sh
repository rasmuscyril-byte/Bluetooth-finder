#!/usr/bin/env bash
# iPad-finder – start på Linux:  ./start-linux.sh
cd "$(dirname "$0")" || exit 1

PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done

if [ -z "$PY" ]; then
  echo "Python 3.9 eller nyere blev ikke fundet. Installer den med din pakkehåndtering (fx: sudo apt install python3 python3-venv)."
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Gør klar første gang ..."
  "$PY" -m venv .venv || { echo "Kunne ikke oprette .venv (mangler python3-venv?)"; exit 1; }
fi

.venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.txt || {
  echo "Installationen af Bluetooth-biblioteket (bleak) fejlede. Er du på internettet?"
  exit 1
}

exec .venv/bin/python -m ipad_finder "$@"
