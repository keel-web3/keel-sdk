"""One reviewed Gator-only sequence. No retry, repin, signer or SDK override."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time

NAMES = ['normal-assembly','qa-pure-audit','exact-plan','reviewed-predicate','actual-native']
ORIGINAL = {'artifactId':'fcf16528-aa7e-43c0-a7f0-8a4542ed96e6','artifactRevision':1,'releaseId':'0c6c734d-20c0-4d3a-959a-fb7ac8143af2','releaseRevision':14}

def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()

def check(condition, message):
    if not condition:
        raise RuntimeError(message)

def regular(file):
    file = Path(file)
    info = file.lstat()
    check(file.is_absolute() and file.resolve()==file and stat.S_ISREG(info.st_mode),'noncanonical source')
    return file

def persist(file, value):
    data = (json.dumps(value,indent=2)+'\n').encode()
    with os.fdopen(os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as stream:
        stream.write(data);stream.flush();os.fsync(stream.fileno())
    directory = os.open(Path(file).parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)

def validate(config, admission, config_sha):
    check(set(config)=={'schema','original','outputDirectory','sources','steps','generatedAdmission'},'config fields')
    check(config['schema']=='keel-gator-one-shot-pipeline@1' and config['original']==ORIGINAL,'original scope')
    check([step['name'] for step in config['steps']]==NAMES,'exact five steps')
    check(admission['schema']=='keel-reviewed-gator-one-shot-pipeline@1' and admission['decision']=='APPROVE','independent admission')
    check(admission['configSHA256']==config_sha and admission['pipelineSHA256']==sha(__file__),'source admission')
    check(admission['original']==ORIGINAL and admission['maximumAssemblies']==1 and admission['maximumNativeExecutions']==1 and admission['signing'] is False and admission['submission'] is False,'one-shot scope')
    check(admission['reviewerId']=='independent-release-reviewer','independent reviewer')
    check(isinstance(config['sources'],list) and len(config['sources'])>=10,'source closure')
    paths=[]
    for source in config['sources']:
        check(set(source)=={'path','bytes','sha256'},'source fields')
        file=regular(source['path']);paths.append(str(file))
        check(file.stat().st_size==source['bytes'] and sha(file)==source['sha256'],'source changed')
    check(len(paths)==len(set(paths)) and str(Path(__file__).resolve()) in paths,'source identity')
    for index,step in enumerate(config['steps']):
        check(set(step)=={'name','argv','cwd','timeoutSeconds'},'step fields')
        check(isinstance(step['argv'],list) and all(isinstance(item,str) and item for item in step['argv']),'argument vector')
        check(step['timeoutSeconds']==[150,30,15,30,1100][index],'fixed step timeouts')
        check(Path(step['cwd']).is_absolute() and Path(step['cwd']).resolve()==Path(step['cwd']),'step cwd')
        placeholders=[item for item in step['argv'] if item=='$ADMISSION_SHA256']
        check(len(placeholders)==(1 if index==4 else 0),'generated hash placeholder')
    root=Path(config['outputDirectory'])
    check(root.is_absolute() and root.parent.resolve()==root.parent and not root.exists(),'exclusive evidence root')
    generated=Path(config['generatedAdmission'])
    check(generated.is_absolute() and not generated.exists(),'exclusive future admission')
    check(config['steps'][4]['argv'][2]==str(generated),'exact generated admission argv')
    return root

def main(argv):
    check(len(argv)==4,'config/hash/review/hash required')
    config_file,config_sha,review_file,review_sha=argv
    check(sha(regular(config_file))==config_sha and sha(regular(review_file))==review_sha,'initial hash')
    config=json.loads(Path(config_file).read_bytes());review=json.loads(Path(review_file).read_bytes())
    root=validate(config,review,config_sha)
    root.mkdir(mode=0o700)
    persist(root/'claim.json',{'schema':'keel-gator-one-shot-claim@1','configSHA256':config_sha,'reviewSHA256':review_sha,'pipelineSHA256':sha(__file__),'at':time.time(),'consumedBeforeCompiler':True,'signing':False,'submission':False})
    records=[];started=time.monotonic()
    try:
        for index,step in enumerate(config['steps']):
            for source in config['sources']:
                file=regular(source['path'])
                check(file.stat().st_size==source['bytes'] and sha(file)==source['sha256'],'source changed between steps')
            arguments=list(step['argv'])
            if index==4:
                arguments=[sha(regular(config['generatedAdmission'])) if value=='$ADMISSION_SHA256' else value for value in arguments]
            persist(root/(str(index)+'-argv.json'),{'argv':arguments,'cwd':step['cwd'],'timeoutSeconds':step['timeoutSeconds']})
            before=time.monotonic()
            with (root/(str(index)+'.stdout')).open('xb') as output,(root/(str(index)+'.stderr')).open('xb') as error:
                os.chmod(output.name,0o600);os.chmod(error.name,0o600)
                result=subprocess.run(arguments,cwd=step['cwd'],stdin=subprocess.DEVNULL,stdout=output,stderr=error,timeout=step['timeoutSeconds'],check=False)
            record={'name':step['name'],'exitCode':result.returncode,'seconds':round(time.monotonic()-before,3)}
            records.append(record);persist(root/(str(index)+'-receipt.json'),record)
            check(result.returncode==0,'step failed: '+step['name'])
        persist(root/'result.json',{'schema':'keel-gator-one-shot-result@1','status':'COMPLETED_REQUIRES_INDEPENDENT_AUDIT','configSHA256':config_sha,'steps':records,'seconds':round(time.monotonic()-started,3),'signing':False,'submission':False,'productionActivated':False})
    except BaseException as error:
        persist(root/'failure.json',{'schema':'keel-gator-one-shot-failure@1','status':'STOPPED_NO_RETRY','errorClass':type(error).__name__,'completedSteps':records,'seconds':round(time.monotonic()-started,3),'signing':False,'submission':False,'productionActivated':False})
        raise

if __name__=='__main__':main(sys.argv[1:])
