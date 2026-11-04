const test=require('node:test');
const assert=require('node:assert/strict');
const {packArchive,unpackArchive}=require('../electron/archive-codec.cjs');
const {openIndexedArchive}=require('../electron/archive-index.cjs');
const {encodePng}=require('../electron/texture-delta.cjs');

test('indexed CBM2 reads current blocks without decoding distant history and restores identical bytes',async()=>{
  const image=encodePng({width:1,height:1,rgba:Buffer.from([20,40,60,255])});
  const entries=[['current_state',Buffer.from('{"status":"complete"}')],
    ['textures/texture_a/current',Buffer.from(JSON.stringify({source:image}))],
    ['history/large.json',Buffer.alloc(8*1024*1024+1,120)],
    ['texture_changes/1/texture_a.json',Buffer.from(JSON.stringify({before:Buffer.from('old pixels').toString('base64'),after:Buffer.from('new pixels').toString('base64')}))]];
  const bytes=await packArchive(entries),index=openIndexedArchive(bytes);
  assert.equal(index.cache.size,0);
  assert.deepEqual(index.get('current_state'),entries[0][1]);
  assert.equal(index.cache.size,1,'opening current metadata does not decompress historical blocks');
  assert.ok(index.blocks.length>1);
  assert.equal(index.originalSize('history/large.json'),8*1024*1024+1);
  const full=unpackArchive(bytes);
  for(const [name,value]of index)assert.deepEqual(value,full.get(name));
  const damaged=Buffer.from(bytes),block=index.blocks[1];
  damaged.fill(0,block.offset,block.offset+block.length);
  const lazy=openIndexedArchive(damaged);
  assert.deepEqual(lazy.get('current_state'),entries[0][1]);
  assert.throws(()=>lazy.get('history/large.json'));
});
