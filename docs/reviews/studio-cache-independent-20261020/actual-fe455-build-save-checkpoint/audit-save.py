from pathlib import Path,PurePosixPath
import json,hashlib,tarfile,gzip,io,os,stat,time
root=Path('/private/tmp/keel-independent-fe455-actual-20261020');p=Path('/private/tmp/keel-actual311-image-20261020/image.tar');receipt=json.loads(Path('/private/tmp/keel-admitted311-build-actual-20261020/remote-build-receipt.json').read_bytes());sha=lambda b:hashlib.sha256(b).hexdigest();canon=lambda x:json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
started=time.monotonic();fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
with os.fdopen(fd,'rb') as f:
 before=os.fstat(f.fileno());assert stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode)==0o600 and before.st_nlink==1 and before.st_size==703956480
 h=hashlib.sha256()
 for chunk in iter(lambda:f.read(1024**2),b''):h.update(chunk)
 assert h.hexdigest()=='d7b01b81ba15044693511d2d1ec2acaecda0d9f97c62a309a2ba9282d9b6383e'
 f.seek(0)
 with tarfile.open(fileobj=f,mode='r:')as t:
  ms=t.getmembers();members={m.name:m for m in ms};assert len(ms)==len(members)==45
  for m in ms:assert m.isfile() or m.isdir();assert not PurePosixPath(m.name).is_absolute() and '..' not in PurePosixPath(m.name).parts and str(PurePosixPath(m.name))==m.name
  assert json.load(t.extractfile('oci-layout'))=={'imageLayoutVersion':'1.0.0'}
  idx=json.load(t.extractfile('index.json'));assert len(idx['manifests'])==1;image=idx['manifests'][0];assert image['digest']==receipt['imageId']
  verified={};visited=set()
  def descriptor(d):
   assert set(['digest','size','mediaType']).issubset(d) and d['digest'].startswith('sha256:');name='blobs/sha256/'+d['digest'][7:];m=members[name];assert m.isfile() and m.size==d['size'];visited.add(name);return name
  name=descriptor(image);raw=t.extractfile(name).read();assert sha(raw)==image['digest'][7:];manifest=json.loads(raw);verified[name]={'bytes':len(raw),'sha256':sha(raw),'mediaType':image['mediaType']}
  configDescriptor=manifest['config'];name=descriptor(configDescriptor);raw=t.extractfile(name).read();assert sha(raw)==configDescriptor['digest'][7:];config=json.loads(raw);verified[name]={'bytes':len(raw),'sha256':sha(raw),'mediaType':configDescriptor['mediaType']}
  assert config['os']=='linux' and config['architecture']=='amd64' and config['config']==receipt['imageConfig']
  assert config['rootfs']=={'type':'layers','diff_ids':receipt['rootFS']['Layers']};assert len(manifest['layers'])==38
  class HashReader:
   def __init__(self,stream):self.stream=stream;self.h=hashlib.sha256();self.n=0
   def read(self,n=-1):
    b=self.stream.read(n);self.h.update(b);self.n+=len(b);return b
  expanded=0;layers=[]
  for i,d in enumerate(manifest['layers']):
   name=descriptor(d);assert d['mediaType'] in ['application/vnd.oci.image.layer.v1.tar+gzip','application/vnd.docker.image.rootfs.diff.tar.gzip'];reader=HashReader(t.extractfile(name));uncompressed=hashlib.sha256();size=0
   with gzip.GzipFile(fileobj=reader,mode='rb')as g:
    for b in iter(lambda:g.read(1024**2),b''):size+=len(b);uncompressed.update(b)
   assert reader.n==d['size'] and reader.h.hexdigest()==d['digest'][7:];assert 'sha256:'+uncompressed.hexdigest()==config['rootfs']['diff_ids'][i]
   verified[name]={'bytes':reader.n,'sha256':reader.h.hexdigest(),'expandedBytes':size,'diffId':'sha256:'+uncompressed.hexdigest(),'mediaType':d['mediaType']};layers.append({'index':i,**verified[name]});expanded+=size
  assert {n for n in members if n.startswith('blobs/sha256/')}==visited and len(verified)==40
  legacy=json.load(t.extractfile('manifest.json'));assert len(legacy)==1 and legacy[0]['Config']=='blobs/sha256/'+configDescriptor['digest'][7:] and legacy[0]['Layers']==['blobs/sha256/'+d['digest'][7:]for d in manifest['layers']]
 after=os.fstat(f.fileno());assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
report={'schema':'keel.independent-actual-image-save-audit@1','imageId':receipt['imageId'],'configDigest':configDescriptor['digest'],'archiveBytes':before.st_size,'archiveSHA256':h.hexdigest(),'protectedMode':'0600','stableBeforeAfterFileIdentity':True,'ociAndDockerLegacyDescriptorsAgree':True,'manifestImageIdentityMatchesActualDaemonReceipt':True,'fullConfigExactActualReceipt':True,'allRootFSDiffIDsMatchActualReceipt':True,'blobCount':len(verified),'layerCount':len(layers),'allCompressedAndExpandedDigestsVerified':True,'totalExpandedLayerBytes':expanded,'first36ParentLayersAlreadyBoundByBuildReceiptReview':True,'newTwoLayersExpandedBytes':sum(l['expandedBytes']for l in layers[-2:]),'layers':layers,'elapsedSeconds':time.monotonic()-started,'filesExtracted':0,'hostActions':0,'activationAuthority':False,'appAndHTTPRuntimeQualificationPending':True}
(root/'save-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='layers'},indent=2));print('auditSHA256',sha((root/'save-audit.json').read_bytes()))
