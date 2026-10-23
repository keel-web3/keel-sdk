"""Reviewer-only real helper regression using a synthetic dynamic-name waker."""
import copy, importlib.util, os, unittest
from pathlib import Path
BASE=Path("/private/tmp/keel-image-only-release-20261020/docs/reviews/studio-publication-20261020/release/image-only-observer311")
ROOT=Path(os.environ.get("KEEL_REVIEW_OPERATOR_ROOT",str(BASE)))
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module);return module
b=load("keel_review_original_fixture",BASE/"image-only-controls.test.py")
m=load("keel_review_target_operator",ROOT/"activate-image-only.py")
b.m=m
class NameWakerDocker(b.Docker):
 def __init__(self,values):super().__init__(values);self.wakes=[];self.pending_check=None
 def action(self,identity,action,query=""):
  super().action(identity,action,query)
  if action=="stop" and self.values[identity]["Name"]=="/"+m.CURRENT:self.pending_check=identity
 def container(self,name):
  result=super().container(name)
  if self.pending_check==name:
   # First stopped-state read is the operator confirmation. The normal proxy
   # wakes the canonical name immediately after that read, before next action.
   self.pending_check=None
   for value in self.values.values():
    if value["Name"]=="/"+m.CURRENT and not value["State"]["Running"]:
     value["State"]["Running"]=True;self.wakes.append(value["Id"])
  return result
class RecoveryNameWaker(unittest.TestCase):
 def test_recovery_removes_owned_candidate_from_wake_name_before_stop(self):
  fixture=b.Controls();fixture.setUp()
  old=copy.deepcopy(fixture.old);old["Name"]="/"+fixture.plan["rollbackName"];old["State"]["Running"]=False
  candidate=copy.deepcopy(fixture.new);candidate["Name"]="/"+m.CURRENT;candidate["State"]["Running"]=True;candidate["HostConfig"]["OomKillDisable"]=None
  docker=NameWakerDocker([old,fixture.runner,candidate])
  result=m.recover(docker,fixture.old,fixture.plan,fixture.desired,b.g,b.oom,b.PROFILE)
  self.assertEqual(docker.wakes,[],"canonical-name waker must not restart an owned candidate during recovery")
  self.assertTrue(result["confirmed"],result)
  self.assertFalse(docker.container("newid")["State"]["Running"])
  self.assertEqual(docker.container("newid")["Name"],"/"+fixture.plan["failedName"])
  self.assertTrue(docker.container(m.CURRENT_ID)["State"]["Running"])
  self.assertNotIn(m.RUNNER,[call[0] for call in docker.calls])
if __name__=="__main__":unittest.main()
