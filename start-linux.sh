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

# (Re)create the environment unless it has a working pip, so a failed first
# run (e.g. python3-venv missing) does not leave a broken .venv behind.
if ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  echo "Gør klar første gang ..."
  if ! "$PY" -m venv --clear .venv; then
    rm -rf .venv
    echo "Kunne ikke oprette .venv. Mangler python3-venv? (fx: sudo apt install python3-venv)"
    exit 1
  fi
fi

.venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.txt || {
  echo "Installationen af Bluetooth-biblioteket (bleak) fejlede – se fejlbeskeden ovenfor. Første start kræver internet."
  exit 1
}

exec .venv/bin/python -m ipad_finder "$@"
