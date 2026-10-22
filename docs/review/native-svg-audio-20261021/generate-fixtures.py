from pathlib import Path
import subprocess,hashlib,json
root=Path(__file__).resolve().parents[3]/'tests/fixtures/native-media'
commands=[]
for ext,args in [('mp3',['-c:a','libmp3lame','-b:a','32k']),('ogg',['-c:a','libopus','-b:a','24k']),('flac',['-c:a','flac']),('aac',['-c:a','aac','-b:a','32k','-f','adts']),('m4a',['-c:a','aac','-b:a','32k','-movflags','+faststart'])]:
    cmd=['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(root/'tone.wav'),'-map_metadata','-1',*args,str(root/f'tone.{ext}')]
    subprocess.run(cmd,check=True);commands.append(cmd)
(root/'smil.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"><animate attributeName="fill" values="#ff0000;#0000ff;#ff0000" dur="1s" repeatCount="indefinite" calcMode="discrete"/></rect></svg>')
(root/'css.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>@keyframes color{0%,49%{fill:#ff0000}50%,100%{fill:#0000ff}}rect{animation:color 1s steps(1) infinite}</style><rect width="32" height="32"/></svg>')
files=[{'path':p.name,'byteLength':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(root.iterdir()) if p.name!='manifest.json']
(root/'manifest.json').write_text(json.dumps({'scope':'generated representative media, not Gatorrr or GIF incident evidence','generation':'16044-byte PCM WAV from baseline.mjs; ffmpeg 9.0.1 locally converts the identical WAV, no source substitutions','commands':commands,'files':files},indent=2)+'\n')
print(json.dumps(files,indent=2))
