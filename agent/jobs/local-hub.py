#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Serve a local model hub for the ASR measurement.

The tree already has this server, but only reachable through
`--hooks toolkit/components/ml/tests/tools/hooks_local_hub.py`, and `--hooks`
is a `mach perftest` flag — `mach mochitest` rejects it. So import the tree's
handler and run it directly rather than reimplementing it: it strips the
`?download=true` query that ModelHub appends (a stock SimpleHTTPRequestHandler
404s on it) and answers If-None-Match, which is what makes the model cache work.

Prints the port on the first line and then serves until killed.
"""
import importlib.util
import socket
import socketserver
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOOK = (
    HERE / ".." / ".." / "toolkit" / "components" / "ml" / "tests" / "tools"
    / "hooks_local_hub.py"
).resolve()


def load_handler():
    spec = importlib.util.spec_from_file_location("hooks_local_hub", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.CustomHTTPRequestHandler


def main():
    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        sys.exit(f"local-hub: {root} is not a directory")

    handler = load_handler()
    handler.hub_root = root

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        print(port, flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
