#!/bin/bash
# iPad-finder – dobbeltklik for at starte på en Mac.
cd "$(dirname "$0")" || exit 1

echo ""
echo "  📍 iPad-finder"
echo "  -------------"

PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done

if [ -z "$PY" ]; then
  echo "  Python 3.9 eller nyere blev ikke fundet."
  echo "  Hent Python her: https://www.python.org/downloads/ – og dobbeltklik så på denne fil igen."
  open "https://www.python.org/downloads/" >/dev/null 2>&1
  read -r -p "  Tryk Enter for at lukke ..."
  exit 1
fi

# (Re)create the environment unless it has a working pip, so an interrupted
# first run does not leave a broken .venv behind.
if ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  echo "  Gør klar første gang (det tager et minuts tid) ..."
  "$PY" -m venv --clear .venv || { read -r -p "  Kunne ikke oprette .venv. Tryk Enter for at lukke ..."; exit 1; }
fi

if ! .venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.txt; then
  echo "  Installationen af Bluetooth-biblioteket (bleak) fejlede – se fejlbeskeden ovenfor."
  echo "  Første start kræver internet."
  read -r -p "  Tryk Enter for at lukke ..."
  exit 1
fi

.venv/bin/python -m ipad_finder "$@"
status=$?
if [ $status -ne 0 ]; then
  read -r -p "  Tryk Enter for at lukke ..."
fi
exit $status
