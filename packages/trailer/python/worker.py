import json,sys,traceback
from contextlib import redirect_stdout
from pathlib import Path
from common import analyze_beats
from renderer import render,verify,stills
def main():
    op=sys.argv[1];x=json.load(sys.stdin)
    if op=="beats":return analyze_beats(x["audioPath"],**{k:x[k] for k in ("bpm","beatSeconds","firstDownbeat","beats") if k in x})
    if op=="render":return render(x["timeline"],x["outDir"],x.get("preview",False),x.get("targets"))
    if op=="verify":return verify(x["timeline"],x["renderDir"],x.get("attackToleranceMs",15),x.get("loudnessTolerance",.5))
    if op=="stills":return stills(x["timeline"],x["outDir"],x["times"],x.get("targets"))
    if op=="gameboy":
        from gameboy import capture
        return capture(x["capture"],x["outDir"])
    raise ValueError("Unknown operation "+op)
try:
    with redirect_stdout(sys.stderr):result=main()
    print(json.dumps(result,allow_nan=False))
except Exception as e:
    traceback.print_exc(file=sys.stderr);print(json.dumps({"error":{"code":"TRAILER_WORKER_FAILED","message":str(e)}}));sys.exit(1)
