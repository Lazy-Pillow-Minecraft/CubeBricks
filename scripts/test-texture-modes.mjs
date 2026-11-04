import assert from 'node:assert/strict';
import { faceTilingValues, setFaceTilingCoordinate } from '../src/common/core/face-tiling.js';
import { tiledFaceReference, tiledFaceRegions, flipbookFrame } from '../src/common/core/texture-features.js';
import { CubeBricksProject, Cube } from '../src/model.js';
import { tiledFacePaintBounds, tiledFacePaintCoordinates, tiledFacePaintPoint } from '../src/paint/tiled-face.js';
import { editUvRectangleField, uvRectangleFields } from '../src/common/core/uv-rectangle.js';

const face = { texture:'texture', uv:[3,4,11,14], rotation:90 };
const original = structuredClone(face), uv = face.uv;
assert.deepEqual(faceTilingValues(face),[0,0,16,16]);
assert.deepEqual(face,original,'reading tiled defaults does not materialize or overwrite UVs');
for (const [index,value] of [-3,2.5,8,4].entries()) assert.equal(setFaceTilingCoordinate(face,index,value),true);
assert.deepEqual(faceTilingValues(face),[-3,2.5,8,4]);
assert.equal(face.uv,uv,'tiled edits retain the ordinary UV array');
assert.equal(face.rotation,90);
assert.equal(setFaceTilingCoordinate(face,1,NaN),false);
assert.equal(setFaceTilingCoordinate(face,4,1),false);
assert.equal(setFaceTilingCoordinate(face,2,0),true);
assert.ok(face.tiling.width>0);
setFaceTilingCoordinate(face,2,8);

const cube = new Cube({uid:'cube_tile',faces:{north:face},size:[4096,32,16]});
const project = new CubeBricksProject({elements:[cube]});
const restored = new CubeBricksProject(JSON.parse(project.serialize())).getNode(cube.uid);
assert.deepEqual(restored.faces.north,face,'native serialization retains separate UV and tiling records');
const tileAsset = {mode:'tiled',width:64,height:32};
const key = tiledFaceReference(cube,'north',tileAsset);
face.tiling.offsetX += 64;
assert.equal(tiledFaceReference(cube,'north',tileAsset),key,'source-image periods determine repeated offsets, independently of face width');
assert.equal(tiledFaceReference(cube,'north',{mode:'default'}),null);
face.tiling.width = 8192; face.tiling.height = 2048;
const regions = tiledFaceRegions(cube,'north');
assert.ok(regions.length>1);
assert.equal(regions.reduce((sum,region)=>sum+region.width*region.height,0),4096*32);
assert.ok(regions.every(region=>region.width/4096*8192<=1024 && region.height/32*2048<=1024),
  'large faces split for rendering without exceeding 1024 pixel derived tiles');
assert.deepEqual(cube.size,[4096,32,16],'render splitting never changes the model');
face.tiling.width = 16; face.tiling.height = 16;
assert.equal(tiledFaceRegions(cube,'north').length,1,
  'physical face size does not alter its configured pixel extent or add render regions');
const image = {};
assert.equal(flipbookFrame({mode:'animation'},image,100),image,'flipbook remains a static placeholder');
const paintCube = { size:[24,8,1], faces:{north:{tiling:{offsetX:-2,offsetY:1,width:24,height:8}}} };
const canvas = { width:8,height:8 };
const facePoints = [[2,3,4],[2,3,-20],[2,11,4],[2,11,-20]];
const paintHit = { facePoints,point:[2,5,-6.25] };
assert.deepEqual(tiledFacePaintCoordinates(paintHit,paintCube,'north',canvas),[8.25,3]);
assert.deepEqual(tiledFacePaintPoint(paintHit,paintCube,'north',canvas),[0,3]);
assert.deepEqual(tiledFacePaintPoint(paintHit,paintCube,'north',canvas,false),[8,3],
  'geometry retains the face position across tile periods, including rotated faces');
assert.deepEqual(tiledFacePaintBounds(paintCube,'north',canvas),{minU:-2,minV:1,maxU:22,maxV:9});
assert.deepEqual(tiledFacePaintPoint({...paintHit,point:[2,3,3.5]},paintCube,'north',canvas),[6,1],
  'negative offsets wrap at pixel writes rather than at geometry endpoints');
assert.deepEqual(uvRectangleFields([7,6,2,1]),[2,1,5,5],'mirrored UVs display positive dimensions');
assert.deepEqual(editUvRectangleField([7,6,2,1],0,4,16),[9,6,4,1],'editing the origin moves both endpoints without changing mirroring');
assert.deepEqual(editUvRectangleField([7,6,2,1],2,8,16),[10,6,2,1],'editing width retains the origin and mirror orientation');
assert.deepEqual(editUvRectangleField([1,2,7,3],0,3,16),[3,2,9,3]);
assert.deepEqual(editUvRectangleField([1,2,7,3],2,4,16),[1,2,5,3]);
assert.deepEqual(editUvRectangleField([1,2,7,3],0,15,16),[10,2,16,3],'origin changes keep the rectangle within the texture');
assert.deepEqual(editUvRectangleField([1,2,7,3],2,99,16),[1,2,16,3],'width changes clamp the far edge rather than treating width as U2');
console.log('Texture modes: separate UV/tiling data, persistence and render splitting passed.');
