import asyncio

import pytest

from ipad_finder import cli


def test_parser_defaults():
    args = cli.build_parser().parse_args([])
    assert args.host == "127.0.0.1"
    assert args.port == 8765
    assert not args.no_browser and not args.demo and not args.check


def test_version_flag(capsys):
    with pytest.raises(SystemExit) as info:
        cli.main(["--version"])
    assert info.value.code == 0
    assert "iPad-finder" in capsys.readouterr().out


def test_check_reports_bluetooth_error(monkeypatch, capsys):
    from ipad_finder.scanner import BluetoothUnavailable

    class BrokenScanner:
        def __init__(self, on_advert=None):
            pass

        async def start(self):
            raise BluetoothUnavailable("powered_off", "Bluetooth er slået fra. Slå Bluetooth til og prøv igen.")

        async def stop(self):
            pass

    monkeypatch.setattr(cli, "BleScanner", BrokenScanner)
    assert cli.main(["--check", "--seconds", "0.1"]) == 2
    assert "Bluetooth er slået fra" in capsys.readouterr().out


def test_check_summarises_devices(monkeypatch, capsys):
    class ScriptedScanner:
        def __init__(self, on_advert=None):
            self.on_advert = on_advert

        async def start(self):
            for rssi, data in ((-70, {"76": "10050300000000"}), (-50, {"76": "10050300000000"})):
                self.on_advert({"id": "A", "rssi": rssi, "manufacturerData": data, "name": None})
            self.on_advert({"id": "B", "rssi": -80, "manufacturerData": {}, "name": "Galaxy"})

        async def stop(self):
            pass

    monkeypatch.setattr(cli, "BleScanner", ScriptedScanner)
    assert cli.main(["--check", "--seconds", "0.05"]) == 0
    out = capsys.readouterr().out
    assert "Fandt 2 enheder, heraf 1 Apple-enheder" in out
    assert out.index(" -50 dBm") < out.index(" -80 dBm")


def test_run_server_demo_mode_opens_demo_url(monkeypatch, capsys):
    opened = []
    monkeypatch.setattr(cli.webbrowser, "open", lambda url: opened.append(url))

    async def scenario():
        args = cli.build_parser().parse_args(["--demo", "--port", "0"])
        task = asyncio.ensure_future(cli.run_server(args))
        for _ in range(50):
            await asyncio.sleep(0.02)
            if opened:
                break
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert opened and opened[0].endswith("/?demo")
    assert "iPad-finder kører nu" in capsys.readouterr().out
