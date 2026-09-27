"""Command line entry point: ``python -m ipad_finder``."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
import webbrowser
from typing import Any, Optional, Sequence

from . import __version__
from .scanner import BleScanner, BluetoothUnavailable
from .server import BridgeServer

APPLE_COMPANY_ID = "76"  # 0x004C, as used in RawAdvert.manufacturerData keys


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m ipad_finder",
        description="iPad-finder: find en mistet iPad eller telefon ved at scanne Bluetooth-signaler.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="adresse serveren lytter på (standard: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="port (standard: 8765; næste ledige bruges hvis optaget)")
    parser.add_argument("--no-browser", action="store_true", help="åbn ikke browseren automatisk")
    parser.add_argument("--demo", action="store_true", help="vis en demo med simulerede enheder (kræver ikke Bluetooth)")
    parser.add_argument("--check", action="store_true", help="scan i nogle sekunder og skriv hvad der blev fundet")
    parser.add_argument("--seconds", type=float, default=10.0, help="antal sekunder for --check (standard: 10)")
    parser.add_argument("--fake-scanner", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("-v", "--verbose", action="store_true", help="vis tekniske detaljer i terminalen")
    parser.add_argument("--version", action="version", version=f"iPad-finder {__version__}")
    return parser


def _say(text: str = "") -> None:
    print(text, flush=True)


async def run_server(args: argparse.Namespace) -> int:
    scanner: Any
    if args.demo:
        scanner = None
    elif args.fake_scanner:
        from .fake import FakeScanner

        scanner = FakeScanner()
    else:
        scanner = BleScanner()

    server = BridgeServer(scanner, host=args.host, port=args.port)
    try:
        await server.start()
    except OSError as exc:
        _say(f"Kunne ikke starte den lokale webserver: {exc}")
        return 1

    url = server.url + ("?demo" if args.demo else "")
    try:
        if scanner is not None:
            await server.start_scanner()
            if scanner.error:
                _say(f"  Bluetooth: {scanner.error['message']}")
                _say("  (Jeg prøver igen hvert 5. sekund, mens programmet kører.)")
        _say("")
        _say("  iPad-finder kører nu.")
        _say(f"  Åbn {url} i din browser, hvis den ikke åbner af sig selv.")
        _say("  Luk dette vindue eller tryk Ctrl+C for at stoppe.")
        _say("")
        if not args.no_browser:
            try:
                webbrowser.open(url)
            except Exception:
                pass
        while True:
            await asyncio.sleep(3600)
    finally:
        await server.close()


async def run_check(seconds: float) -> int:
    seen: dict[str, dict[str, Any]] = {}

    def on_advert(advert: dict[str, Any]) -> None:
        previous = seen.get(advert["id"])
        if previous is None or (advert.get("rssi") or -999) > (previous.get("rssi") or -999):
            seen[advert["id"]] = advert

    scanner = BleScanner(on_advert)
    _say(f"Scanner efter Bluetooth-enheder i {seconds:g} sekunder ...")
    try:
        await scanner.start()
    except BluetoothUnavailable as exc:
        _say(f"Fejl: {exc.message}")
        return 2
    try:
        await asyncio.sleep(seconds)
    finally:
        await scanner.stop()

    if not seen:
        _say("Scanningen startede, men der blev ikke fundet nogen enheder – heller ikke din egen telefon.")
        _say("Er Bluetooth slået til, og understøtter computeren Bluetooth Low Energy (Bluetooth 4.0 eller nyere)?")
        return 3
    apple = [a for a in seen.values() if APPLE_COMPANY_ID in a.get("manufacturerData", {})]
    _say(f"Bluetooth virker! Fandt {len(seen)} enheder, heraf {len(apple)} Apple-enheder.")
    strongest = sorted(seen.values(), key=lambda a: a.get("rssi") or -999, reverse=True)[:15]
    for advert in strongest:
        vendor = "Apple" if APPLE_COMPANY_ID in advert.get("manufacturerData", {}) else ""
        name = advert.get("name") or ""
        _say(f"  {advert.get('rssi', '?'):>4} dBm  {advert['id']:<38} {vendor:<6} {name}")
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    started = time.monotonic()
    try:
        if args.check:
            return asyncio.run(run_check(args.seconds))
        return asyncio.run(run_server(args))
    except KeyboardInterrupt:
        if time.monotonic() - started > 1:
            _say("\nFarvel – og held og lykke med at finde den!")
        return 0
