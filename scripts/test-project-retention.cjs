const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readProjectRetention, initializeProjectRetention, retainProject } = require('../electron/project-retention.cjs');
const { ProjectJournal } = require('../electron/project-journal.cjs');
const { unpackArchive, packArchive } = require('../electron/archive-codec.cjs');
const { encodePng } = require('../electron/texture-delta.cjs');
const { hasLargeHistory } = require('../electron/journal-import.cjs');

test('retention survives reopen and damaged/legacy metadata cannot authorize automatic deletion', async t => {
  const root = await fs.mkdtemp(path.join(__dirname,'..','.retention-test-'));
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(__dirname,'..'));return fs.rm(root,{recursive:true,force:true});});
  assert.equal((await readProjectRetention(root)).persistent,true);
  await initializeProjectRetention(root,false,1);
  assert.equal((await readProjectRetention(root)).persistent,false);
  await retainProject(root,7);
  await initializeProjectRetention(root,false,8);
  assert.deepEqual(await readProjectRetention(root),{version:1,persistent:true,savedSequence:7,
    savedAt:(await readProjectRetention(root)).savedAt});
  await fs.writeFile(path.join(root,'workspace_state'),'{broken');
  assert.equal((await readProjectRetention(root)).persistent,true);
});

test('staged history opens current elements first, supports immediate undo, resumes and excludes local metadata from export', async t => {
  const root = await fs.mkdtemp(path.join(__dirname,'..','.history-import-test-'));
  let staged, resumed;
  t.after(async()=>{await staged?.dispose();await resumed?.dispose();assert.equal(path.dirname(root),path.resolve(__dirname,'..'));await fs.rm(root,{recursive:true,force:true});});
  const content = x => JSON.stringify({name:'history',elements:[{uid:'cube_a',type:'cube',position:[x,0,0]}],groups:[],
    textures:[{uuid:'texture_a',source:encodePng({width:1,height:1,rgba:Buffer.from([x,0,0,255])})}],outliner:['cube_a']});
  const source = await new ProjectJournal(path.join(root,'source')).initialize(content(0));
  for(let i=1;i<=12;i++)await source.commit(content(i),'core.element.move');
  const archive=path.join(root,'history.cbmodel');
  await source.archive(archive);
  const bytes=await fs.readFile(archive),entries=unpackArchive(bytes);
  assert.equal(hasLargeHistory(entries,{historyThreshold:100000,historyByteThreshold:1}),true,
    'large history is detected by bytes as well as file count');
  // Extra immutable branches make background work observable without hundreds
  // of unrelated editing transactions in the test setup.
  for(let i=100;i<300;i++) entries.set(`transactions/${i}.json`,entries.get('transactions/1.json'));
  const augmentedBytes = await packArchive([...entries]);
  staged=await ProjectJournal.fromArchive(augmentedBytes,path.join(root,'staged'),entries,()=>{},
    {deferHistory:true,historyThreshold:1});
  assert.equal(JSON.parse(await staged.content()).elements[0].position[0],12);
  assert.ok(staged.historyImport.remaining.size>0,'model restoration does not wait for all historical files');
  const undo=await staged.navigate('undo');
  assert.equal(JSON.parse(undo.content).elements[0].position[0],11);
  assert.equal(JSON.parse(undo.content).textures[0].source,JSON.parse(content(11)).textures[0].source,
    'texture undo can read deltas before background extraction reaches them');
  await staged.commit(content(30),'core.element.move');
  await staged.dispose();
  // Resume uses the durable original archive; real records requested by undo
  // remain available even after an interrupted background import.
  resumed=await new ProjectJournal(path.join(root,'staged')).load();
  assert.equal(JSON.parse(await resumed.content()).elements[0].position[0],30,
    'edits made during background import survive an interruption and are not overwritten by archive counters');
  await resumed.finishHistoryImport();
  assert.ok(await fs.stat(path.join(root,'staged','transactions','299.json')),'resuming preserves even unused historical branches');
  assert.equal(await fs.stat(path.join(root,'staged','.history-import')).then(()=>true,()=>false),false);
  await retainProject(resumed.directory,12);
  const exported=path.join(root,'export.cbmodel');await resumed.archive(exported);
  const names=[...unpackArchive(await fs.readFile(exported)).keys()];
  assert.ok(!names.includes('workspace_state')&&!names.some(name=>name.startsWith('.history-import')));
});
