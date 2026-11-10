// Isolated, hidden GPU check. Only generated fixtures and a temporary profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-procedural-formats-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.whenReady().then(async () => {
  let report;
  try {
    const page = path.join(profile, 'verify.html'); fs.writeFileSync(page, '<!doctype html><body style="margin:0">');
    const win = new BrowserWindow({ show: false, width: 400, height: 400, webPreferences: { backgroundThrottling: false } });
    await win.loadFile(page);
    const root = pathToFileURL(path.resolve('src')).href;
    const checks = await win.webContents.executeJavaScript(`(async()=>{
      const {Cube,CubeBricksProject,addModifier,exportBlockbench,importBlockbench,bakeProceduralShape}=await import(${JSON.stringify(root + '/model.js')});
      const {WebGLSceneRenderer}=await import(${JSON.stringify(root + '/render/webgl-renderer.js')});
      const {createUvPreviewElement}=await import(${JSON.stringify(root + '/texture/culled-face-preview.js')});
      const canvas=document.createElement('canvas');canvas.style.cssText='width:256px;height:256px';document.body.append(canvas);
      const renderer=new WebGLSceneRenderer(canvas),gl=renderer.gl,checks=[];
      const check=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
      const texture=document.createElement('canvas');texture.width=texture.height=16;const ctx=texture.getContext('2d');
      for(let y=0;y<16;y++)for(let x=0;x<16;x++){ctx.fillStyle='rgb('+(x*16)+','+(y*16)+','+((x*7+y*11)%16*16)+')';ctx.fillRect(x,y,1,1);}
      renderer.setTexture(texture);
      const faces=Object.fromEntries(['north','south','east','west','up','down'].map((name,index)=>[name,{texture:0,uv:[15,index,1,12+index%4],rotation:index%4*90}]));
      const camera={yaw:.6,pitch:.35,zoom:1.4,panX:0,panY:0,target:[0,4,0],renderMode:'textured',grid:false,wire:false,
        previewShade:false,faceDistinct:false,captureModelOnly:true,cubeBirthMs:0,cubeDeathMs:0};
      const pixels=project=>{renderer.invalidateGeometry();renderer.render(project,null,camera);const result=new Uint8Array(canvas.width*canvas.height*4);
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,result);return result;};
      const compare=(actual,expected,label)=>{let different=0,ink=0;for(let i=0;i<actual.length;i+=4){if(actual[i+3])ink++;
        if([0,1,2,3].some(c=>Math.abs(actual[i+c]-expected[i+c])>2))different++;}
        check(ink>40&&different<=4,label+' (different pixels='+different+')');};
      for(const formatId of ['java_block_item','modded_entity','bedrock_block'])for(const type of ['polygon_prism','bezier3d']){
        const project=new CubeBricksProject({formatId,textureSize:[16,16],elements:[{uid:'shape',type,
          origin:[0,2,0],rotation:[13,21,8],uvMode:'face',parameters:{radius:3.3,height:6.7,sides:7,thickness:1.6,segmentLength:3,segmentationMode:'distance'},
          nodes:[{position:[0,0,0]},{position:[3,4,5]},{position:[-1,8,9]}]}],
          groups:[{uid:'parent',children:['shape'],rotation:[15,24,-10]}],outliner:['parent']});
        const owner=project.getNode('shape');owner.subdivisionEdits=Object.fromEntries(owner.toFormatBaseCubes().map((_,index)=>[index,{faces:structuredClone(faces)}]));
        for(const projection of ['orthographic','perspective']){
          camera.projection=projection;const before=pixels(project),reimport=importBlockbench(exportBlockbench(project));
          compare(pixels(reimport),before,formatId+'/'+type+'/'+projection+': exported geometry and UV pixels match preview');
          const manual=new CubeBricksProject(JSON.parse(JSON.stringify(project)));bakeProceduralShape(manual,'shape');
          compare(pixels(manual),before,formatId+'/'+type+'/'+projection+': manual bake retains preview pixels');
        }
      }
      const project=new CubeBricksProject({formatId:'java_block_item',textureSize:[16,16],elements:[new Cube({uid:'source',position:[-3,0,-2],size:[6,8,4],uvMode:'face',faces})],
        groups:[{uid:'parent',children:['source'],rotation:[0,90,0]}],outliner:['parent']});
      for(const projection of ['orthographic','perspective']){
        camera.projection=projection;pixels(project);let hits=0;
        for(let y=32;y<224;y+=8)for(let x=32;x<224;x+=8){const hit=renderer.pickDetailed(project,x,y,true);if(!hit)continue;hits++;
          check(JSON.stringify(hit.cube.faces[hit.faceName])===JSON.stringify(project.elements[0].faces[hit.faceName]),'quarter-turn hit uses the source face and its UV');}
        check(hits>10,projection+': rotated-group source remains selectable');
      }
      project.groups[0].rotation=[13,21,8];
      for(const projection of ['orthographic','perspective']){
        camera.projection=projection;const before=pixels(project);
        compare(pixels(importBlockbench(exportBlockbench(project))),before,projection+': Java group pose consumes legal Cube rotations and preserves UVs');
        const preview=new CubeBricksProject({formatId:'bedrock_entity',textureSize:project.textureSize,cullFaces:true,
          elements:[createUvPreviewElement(project.elements[0]).element],groups:project.groups,outliner:project.outliner});
        compare(pixels(preview),before,projection+': UV preview retains the adapted original geometry');
      }
      check(gl.getError()===gl.NO_ERROR,'WebGL has no errors');
      return {checks:[...new Set(checks)],samples:checks.length};
    })()`);
    report = { ok: true, ...checks };
  } catch (error) { report = { ok: false, error: error.stack }; }
  const directory = path.resolve('build/performance'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'procedural-formats.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1);
});
