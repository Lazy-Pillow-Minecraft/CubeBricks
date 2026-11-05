// Hidden, isolated WebGL verification; never opens or changes user projects.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-face-culling-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.whenReady().then(async () => {
  let report;
  const directory = path.resolve('build/performance');
  fs.mkdirSync(directory, { recursive: true });
  const page = path.join(directory, 'face-culling-preview.html');
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><body style="margin:0">');
  try {
    const win = new BrowserWindow({ show: false, width: 400, height: 400,
      webPreferences: { backgroundThrottling: false, contextIsolation: true } });
    await win.loadFile(page);
    const root = pathToFileURL(path.resolve('src')).href;
    const checks = await win.webContents.executeJavaScript(`(async()=>{
      const {WebGLSceneRenderer}=await import(${JSON.stringify(root + '/render/webgl-renderer.js')});
      const {CubeBricksProject}=await import(${JSON.stringify(root + '/model.js')});
      const {createUvPreviewElement}=await import(${JSON.stringify(root + '/texture/culled-face-preview.js')});
      const {VERTEX_SHADER,FRAGMENT_SHADER,LOG_DEPTH_FRAGMENT_SHADER}=await import(${JSON.stringify(root + '/render/shaders.js')});
      const checks=[],check=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
      const canvas=document.createElement('canvas');canvas.style.cssText='width:256px;height:256px';document.body.append(canvas);
      const renderer=new WebGLSceneRenderer(canvas),gl=renderer.gl;
      const compile=source=>{const shader=gl.createShader(gl.FRAGMENT_SHADER);gl.shaderSource(shader,source);gl.compileShader(shader);
        check(gl.getShaderParameter(shader,gl.COMPILE_STATUS),gl.getShaderInfoLog(shader)||'fragment shader compiles');gl.deleteShader(shader);};
      compile(FRAGMENT_SHADER);if(gl.getExtension('EXT_frag_depth'))compile(LOG_DEPTH_FRAGMENT_SHADER);
      const texture=document.createElement('canvas');texture.width=texture.height=16;const context=texture.getContext('2d');
      context.fillStyle='#ff0000';context.fillRect(0,0,16,16);renderer.setTexture(texture);
      const faces=Object.fromEntries(['north','south','east','west','up','down'].map(name=>[name,{texture:0,uv:[0,0,16,16]}]));
      faces.south={texture:null,uv:[16,16,0,0],rotation:90};
      const source=new CubeBricksProject({formatId:'bedrock_entity',cullFaces:true,renderType:'cutout',textureSize:[16,16],
        elements:[{type:'cube',uid:'test-cube',position:[-8,-8,-1],size:[16,16,2],pivot:[0,0,0],faces}]});
      const original=JSON.stringify(source.elements[0]);
      const preview=new CubeBricksProject({formatId:'bedrock_entity',cullFaces:true,renderType:'translucent'});
      preview.elements=[createUvPreviewElement(source.elements[0]).element];preview.outliner=['test-cube'];
      const camera={projection:'orthographic',zoom:1,panX:0,panY:0,yaw:0,pitch:0,target:[0,0,0],renderMode:'textured',
        previewShade:true,faceDistinct:true,grid:false,wire:false,geometryOnly:true,culledFacePreview:true,
        captureModelOnly:true,cubeBirthMs:0,cubeDeathMs:0};
      const pixels=()=>{const result=new Uint8Array(64*64*4);gl.readPixels(canvas.width/2-32,canvas.height/2-32,64,64,gl.RGBA,gl.UNSIGNED_BYTE,result);return result;};
      for(const projection of ['orthographic','perspective']){
        camera.projection=projection;renderer.render(source,null,camera);
        check(pixels().every(value=>value===0),projection+': a culled face leaves no texture or face tint');
        check(renderer.pickDetailed(source,128,128,true)===null,projection+': culled fronts and discarded backs do not intercept input');
        renderer.render(preview,null,camera);const sample=pixels();let ink=0,gaps=0;
        for(let i=0;i<sample.length;i+=4){const [r,g,b,a]=sample.subarray(i,i+4);
          if(a===0){gaps++;continue;}check(Math.abs(r-g)<=1&&Math.abs(g-b)<=1&&a<=117,'hatching is neutral white, translucent, and untinted');ink++;}
        check(ink>300&&gaps>300,projection+': hatch strokes alternate with transparent gaps');
        const at=(x,y)=>sample[(y*64+x)*4+3];let match=0;
        for(let y=1;y<63;y++)for(let x=1;x<63;x++)if(Math.abs(at(x,y)-at(x+1,y-1))<=2)match++;
        check(match>3700,projection+': hatch strokes follow a screen-space 45 degree diagonal');
        check(renderer.pickDetailed(preview,128,128,true)?.faceName==='south','UV preview placeholder stays selectable for restoration');
      }
      check(JSON.stringify(source.elements[0])===original,'UV preview never changes saved face data');
      check(gl.getError()===gl.NO_ERROR,'rendering completes without WebGL errors');
      return {checks:checks.filter((message,index)=>index===checks.indexOf(message)),samples:checks.length};
    })()`);
    report = { ok: true, ...checks };
  } catch (error) { report = { ok: false, error: error.stack }; }
  fs.writeFileSync(path.join(directory, 'face-culling-preview.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1);
});
