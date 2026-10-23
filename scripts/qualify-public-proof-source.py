#!/usr/bin/env python3
"""Operator-only format probe: nine public reads, no retries or redirects.

This is not a simulation or a cryptographic proof-verification result. Preserve
the local output for offline verification by the qualified native executor.
Never substitute owner addresses, project slots, calldata or a different URL.
"""
import argparse
import json
import os
import time
import urllib.error
import urllib.request

URL = "https://ethereum-sepolia-rpc.publicnode.com"
PUBLIC_ACCOUNT = "0x" + "11" * 20
BEACON_ROOTS = "0x000f3df6d732807ef1319fb7b8bb8522d0beac02"
MAX_BYTES = 2 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("redirect refused")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-approved-public-probe", action="store_true", required=True)
    parser.add_argument("--output", required=True, help="new local JSON evidence file")
    args = parser.parse_args()
    # Reserve a private local result file before making any read.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    report = {"schema": "keel-public-proof-format-probe@1", "recipient": URL,
              "projectDataUsed": False, "signing": "not-performed", "reads": []}
    opener = urllib.request.build_opener(NoRedirect())
    started = time.monotonic()

    def read(method, params):
        if report["reads"]:
            time.sleep(1)
        if len(report["reads"]) >= 9 or time.monotonic() - started >= 160:
            raise RuntimeError("probe budget exhausted")
        entry = {"method": method, "params": params}
        report["reads"].append(entry)
        request = urllib.request.Request(URL, data=json.dumps({"jsonrpc": "2.0", "id": len(report["reads"]), "method": method, "params": params}).encode(), headers={"Content-Type": "application/json"})
        with opener.open(request, timeout=15) as response:
            if response.status != 200:
                raise RuntimeError("unexpected HTTP status")
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise RuntimeError("response budget exhausted")
        value = json.loads(raw)
        if "error" in value:
            entry["rpcErrorCode"] = value["error"].get("code")
            raise RuntimeError("RPC error; stop without retry")
        if value.get("id") != len(report["reads"]) or "result" not in value:
            raise RuntimeError("invalid RPC envelope")
        entry["result"] = value["result"]
        return value["result"]

    try:
        if read("eth_chainId", []) != "0xaa36a7":
            raise RuntimeError("wrong chain")
        header = read("eth_getBlockByNumber", ["latest", False])
        if not header or abs(time.time() - int(header["timestamp"], 16)) > 180:
            raise RuntimeError("unavailable or stale public header")
        anchor = {"blockHash": header["hash"], "requireCanonical": True}
        slot = int(header["timestamp"], 16) % 8191
        for address, keys in [(PUBLIC_ACCOUNT, [0]), (BEACON_ROOTS, [slot, slot + 8191])]:
            for key in keys:
                proof = read("eth_getProof", [address, ["0x" + format(key, "064x")], anchor])
                if not proof or not isinstance(proof.get("accountProof"), list) or len(proof.get("storageProof", [])) != 1:
                    raise RuntimeError("unsupported proof response shape")
            code = read("eth_getCode", [address, anchor])
            if not isinstance(code, str) or not code.startswith("0x"):
                raise RuntimeError("unsupported code response shape")
        parent = read("eth_getBlockByHash", [header["parentHash"], False])
        if not parent or parent["hash"] != header["parentHash"] or int(parent["number"], 16) + 1 != int(header["number"], 16):
            raise RuntimeError("parent mismatch")
        canonical = read("eth_getBlockByNumber", [header["number"], False])
        if not canonical or canonical["hash"] != header["hash"]:
            raise RuntimeError("canonical block changed")
        report["formatProbeCompleted"] = True
    except Exception as error:
        report["failure"] = {"category": type(error).__name__}
        if isinstance(error, urllib.error.HTTPError):
            report["failure"]["httpStatus"] = error.code
        # Never copy provider error bodies, proxy details or credential text.
    finally:
        report["elapsedSeconds"] = round(time.monotonic() - started, 3)
        with os.fdopen(fd, "w") as output:
            json.dump(report, output, indent=2)
            output.write("\n")
    print(json.dumps({"formatProbeCompleted": report.get("formatProbeCompleted", False), "readCount": len(report["reads"]), "failure": report.get("failure")}))
    return 0 if report.get("formatProbeCompleted") else 1


if __name__ == "__main__":
    raise SystemExit(main())
