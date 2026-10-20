set -euo pipefail
umask 077
base=/root/keel-validation-tools-20261020/ffmpeg-static-5.3.0
mkdir "$base"
cd "$base"
python3 - <<'PY'
import pathlib,json,hashlib
p=pathlib.Path('/root/keel-qa-final-pair-20261020/keel-sdk/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static')
r=json.loads((p/'package.json').read_text());assert r['name']=='ffmpeg-static'and r['version']=='5.3.0'and r[r['name']]['binary-release-tag']=='b6.1.1'
assert r['repository']['url']=='https://github.com/eugeneware/ffmpeg-static'
assert b'`${baseUrl}/${executableBaseName}-${platform}-${arch}.gz`'in(p/'install.js').read_bytes()
q={'package':'ffmpeg-static','version':r['version'],'tag':r[r['name']]['binary-release-tag'],'officialPackageURL':r['repository']['url'],'platform':'linux','arch':'x64','derivedDownloadURL':'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz','packageJSONSHA256':hashlib.sha256((p/'package.json').read_bytes()).hexdigest(),'installScriptSHA256':hashlib.sha256((p/'install.js').read_bytes()).hexdigest(),'destination':str(p/'ffmpeg')}
pathlib.Path('package-provenance.json').write_text(json.dumps(q,indent=2)+'\n')
PY
curl --fail --silent --show-error --location --retry 0 --connect-timeout 10 --max-time 90 -H 'Accept: application/vnd.github+json' https://api.github.com/repos/eugeneware/ffmpeg-static/releases/tags/b6.1.1 -o release.json
python3 - <<'PY'
import json,pathlib
r=json.load(open('release.json'));a=[x for x in r['assets']if x['name']=='ffmpeg-linux-x64.gz'];assert r['tag_name']=='b6.1.1'and len(a)==1
x=a[0];assert x['browser_download_url']=='https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz'
pathlib.Path('asset.json').write_text(json.dumps(x,indent=2)+'\n')
PY
curl --fail --silent --show-error --location --retry 0 --connect-timeout 10 --max-time 180 https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz -o ffmpeg-linux-x64.gz
python3 - <<'PY'
import pathlib,json,hashlib,gzip
p=pathlib.Path('.');a=json.load(open('asset.json'));b=(p/'ffmpeg-linux-x64.gz').read_bytes();assert len(b)==a['size']
if a.get('digest'):assert a['digest']=='sha256:'+hashlib.sha256(b).hexdigest()
raw=gzip.decompress(b);assert len(raw)>1024*1024 and len(raw)<200*1024*1024 and raw[:4]==b'\x7fELF'
(p/'ffmpeg').write_bytes(raw);(p/'ffmpeg').chmod(0o700)
PY
./ffmpeg -version > version.txt 2>&1
python3 - <<'PY'
import pathlib,json,hashlib,os,datetime
p=pathlib.Path('.');package=json.load(open('package-provenance.json'));version=(p/'version.txt').read_text();assert version.startswith('ffmpeg version 6.1.1-static')
b=(p/'ffmpeg').read_bytes();dest=pathlib.Path(package['destination']);assert dest.parent.resolve().is_relative_to(pathlib.Path('/root/keel-qa-final-pair-20261020/keel-sdk/node_modules/.pnpm'))
assert json.loads((dest.parent/'package.json').read_text())['version']=='5.3.0'
if dest.exists():assert not dest.is_symlink()and dest.read_bytes()==b
else:
 fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
assert hashlib.sha256(dest.read_bytes()).hexdigest()==hashlib.sha256(b).hexdigest()
a=json.load(open('asset.json'))
r={'schema':'keel-independent-ffmpeg-static-linux@1','qualifiedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),**package,'binaryBytes':len(b),'binarySHA256':hashlib.sha256(b).hexdigest(),'gzipSHA256':hashlib.sha256((p/'ffmpeg-linux-x64.gz').read_bytes()).hexdigest(),'officialAssetDigest':a.get('digest'),'officialAssetSize':a['size'],'binaryVersionBanner':version.splitlines()[0],'genuineExecutionVersionCheck':True,'elf':True,'existingDifferentFileOverwritten':False,'sdkDistTouched':False,'globalChanges':False,'credentialChanges':False,'proxyOrRecipientFallback':False,'actualSource':str(p.resolve()/'ffmpeg'),'assetMetadataSHA256':hashlib.sha256((p/'asset.json').read_bytes()).hexdigest()}
(p/'qualification-receipt.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r));print('QUALIFICATION_RECEIPT_SHA256',hashlib.sha256((p/'qualification-receipt.json').read_bytes()).hexdigest())
PY
