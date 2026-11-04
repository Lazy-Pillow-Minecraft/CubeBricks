import assert from 'node:assert/strict';
import {isolateTextureLayerIds,reidentifyTextureLayers} from '../src/common/core/texture-layer-identity.js';
const original={layers:[{uid:'g',type:'group'},{uid:'a',parentUid:'g',maskLayerUid:'b',source:'red'},{uid:'b',source:'white'}],activeLayerUid:'a',
  animation:{frames:[{uid:'frame',layerUids:['g','a','__all_layers__'],paintLayerUid:'a',visibility:{a:false}}]}};
const copy=reidentifyTextureLayers(structuredClone(original)),[group,a,b]=copy.layers;
assert.notEqual(group.uid,'g');assert.notEqual(a.uid,'a');assert.notEqual(b.uid,'b');
assert.equal(a.parentUid,group.uid);assert.equal(a.maskLayerUid,b.uid);assert.equal(copy.activeLayerUid,a.uid);
assert.deepEqual(copy.animation.frames[0].layerUids,[group.uid,a.uid,'__all_layers__']);
assert.equal(copy.animation.frames[0].paintLayerUid,a.uid);assert.deepEqual(copy.animation.frames[0].visibility,{[a.uid]:false});
assert.equal(original.layers[1].uid,'a');assert.equal(original.animation.frames[0].paintLayerUid,'a');
const assets=isolateTextureLayerIds([structuredClone(original),structuredClone(original)]);
assert.equal(assets[0].layers[0].uid,'g');assert.notEqual(assets[1].layers[0].uid,'g');
assert.equal(assets[1].animation.frames[0].layerUids[0],assets[1].layers[0].uid);
console.log('Texture copies: layer, group, mask and frame reference identities remain isolated.');
