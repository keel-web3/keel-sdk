"""Independent no-host regression: confirmed DB CAS is not a stopped-owner fence."""
import importlib.util, json, pathlib, sys
from types import SimpleNamespace
root = pathlib.Path(sys.argv[1])
spec=importlib.util.spec_from_file_location('fixture', root/'dependency-contract.test.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
case=f.RecoveryFence();case.setUp()
try:
 d,guard=case.prepare();d.stop_fails=True
 def rollback(*args):
  d.actions.append(('cas-confirmation',True))
  return {'confirmed':True}
 result=f.a.recover_runtime(d,guard,case.old,'a'*64,None,case.plan,SimpleNamespace(rollback_database=rollback),{'factory-disable.sql':case.sql},lambda _:None)
 observed={'sourceRoot':str(root),'actions':d.actions,'result':result,'oldRunning':d.states[f.h.OLD_ID]['State']['Running'],'candidateRunning':d.states['a'*64]['State']['Running']}
 print(json.dumps(observed,sort_keys=True,indent=2),flush=True)
 assert ('start',f.h.OLD_ID) not in d.actions, 'old restart attempted while owned candidate stop is unconfirmed'
 assert not d.states[f.h.OLD_ID]['State']['Running'], 'old must remain stopped if another database owner is still running'
 assert result['status']=='unconfirmed'
finally:case.doCleanups()
