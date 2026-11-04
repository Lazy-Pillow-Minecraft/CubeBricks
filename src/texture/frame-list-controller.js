import { createListDragAutoScroll } from '../screen/list-drag-scroll.js';
import { verticalDropTarget } from '../screen/vertical-drop.js';
import { createTextureFrameElement, insertTextureFrameElement, moveTextureFrameElement, textureFrameElements } from './frame-elements.js';
import { activeTextureFrame, selectTextureFrame } from '../common/core/frame-links.js';

export function createTextureFrameList({$,activeTextureAsset,noteJournalOperation,markDirty,showContextMenu,onSelect,onChange}) {
  const panel=$('#textureFrameEditor'),list=$('#textureFrameList'),add=$('#addTextureFrame');
  let clipboard=null,drag=null;
  const frames=()=>textureFrameElements(activeTextureAsset());
  const selectedFrame=()=>activeTextureFrame(activeTextureAsset());
  const scroll=createListDragAutoScroll(list,()=>Boolean(drag?.active),pointer=>{if(pointer)updateDrop(pointer.y);});

  function render(){
    if(!$('#layerEditorDialog').open)return;
    const asset=activeTextureAsset();add.disabled=!asset;
    const entries=frames(),chosen=selectedFrame()?.uid;
    list.replaceChildren();
    if(!entries.length){const empty=document.createElement('p');empty.className='texture-frame-empty';empty.textContent='尚無幀元素';list.append(empty);}
    entries.forEach((frame,index)=>{
      const row=document.createElement('div');row.className=`texture-frame-row${frame.uid===chosen?' active':''}`;row.dataset.textureFrame=frame.uid;
      const grip=document.createElement('span');grip.className='texture-layer-grip';grip.textContent='⠿';grip.setAttribute('aria-hidden','true');
      const thumbnail=document.createElement('span');thumbnail.className='texture-frame-index';thumbnail.textContent=String(index+1);
      const name=document.createElement('span');name.className='texture-layer-name';name.textContent=frame.name;name.setAttribute('translate','no');row.title=frame.name;
      row.append(grip,thumbnail,name);list.append(row);
    });
  }
  function commit(asset,next,uid,operation){
    if(!asset)return;
    noteJournalOperation(operation);asset.animation={...asset.animation,frames:next};
    selectTextureFrame(asset,uid);
    markDirty();onSelect?.(uid);onChange?.();render();list.focus({preventScroll:true});
  }
  function create(){
    const asset=activeTextureAsset();if(!asset)return;
    const frame=createTextureFrameElement(frames());commit(asset,insertTextureFrameElement(frames(),frame,selectedFrame()?.uid),frame.uid,'core.texture.frame.create');
  }
  function copy(){const frame=selectedFrame();if(frame)clipboard=structuredClone(frame);}
  function remove(cut=false){
    const asset=activeTextureAsset(),frame=selectedFrame();if(!asset||!frame)return;
    if(cut)copy();const entries=frames(),index=entries.indexOf(frame),next=entries.filter(entry=>entry!==frame);
    commit(asset,next,next[Math.min(index,next.length-1)]?.uid,cut?'core.texture.frame.cut':'core.texture.frame.delete');
  }
  function paste(duplicate=false){
    const asset=activeTextureAsset(),original=duplicate?selectedFrame():clipboard;if(!asset||!original)return;
    const frame=createTextureFrameElement(frames(),original);
    commit(asset,insertTextureFrameElement(frames(),frame,selectedFrame()?.uid),frame.uid,duplicate?'core.texture.frame.duplicate':'core.texture.frame.paste');
  }
  function select(uid){
    const asset=activeTextureAsset();if(!asset)return;
    const changed=selectedFrame()?.uid!==uid;
    selectTextureFrame(asset,uid);onSelect?.(uid);render();if(changed)onChange?.();
  }
  list.addEventListener('click',event=>{
    const row=event.target.closest('[data-texture-frame]'),asset=activeTextureAsset();if(!row||!asset)return;
    select(row.dataset.textureFrame);list.focus({preventScroll:true});
  });
  add.addEventListener('click',create);
  list.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase(),modified=event.ctrlKey||event.metaKey;
    if(!(modified&&['c','x','v','d'].includes(key))&&key!=='delete')return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.repeat)return;
    if(key==='delete')remove();else if(key==='c')copy();else if(key==='x')remove(true);else paste(key==='d');
  });
  list.addEventListener('contextmenu',event=>{
    const row=event.target.closest('[data-texture-frame]'),asset=activeTextureAsset();if(!asset)return;
    if(row)select(row.dataset.textureFrame);
    list.focus({preventScroll:true});
    const source=list.querySelector(`[data-texture-frame="${CSS.escape(selectedFrame()?.uid||'')}"]`)||list.querySelector('.texture-frame-empty')||list;
    showContextMenu(event,{source,items:[
      {label:'新增幀元素',action:create},
      {label:'複製',disabled:!selectedFrame(),action:copy},
      {label:'貼上',disabled:!clipboard,action:()=>paste()},
      {label:'剪切',disabled:!selectedFrame(),action:()=>remove(true)},
      {label:'原地複製',disabled:!selectedFrame(),action:()=>paste(true)},
      {separator:true},{label:'刪除',danger:true,disabled:!selectedFrame(),action:()=>remove()}
    ]});
  });
  function updateDrop(y){
    if(!drag?.active)return;
    const rows=[...list.querySelectorAll('[data-texture-frame]')].filter(row=>row.dataset.textureFrame!==drag.uid);
    const picked=verticalDropTarget(rows,y);drag.index=picked?picked.index+(picked.position==='after'?1:0):0;
    for(const row of list.querySelectorAll('.drop-before,.drop-after'))row.classList.remove('drop-before','drop-after');
    picked?.entry.classList.add(picked.position==='after'?'drop-after':'drop-before');
  }
  list.addEventListener('pointerdown',event=>{
    const row=event.target.closest('[data-texture-frame]');if(event.button!==0||!row)return;
    drag={uid:row.dataset.textureFrame,asset:activeTextureAsset(),pointerId:event.pointerId,x:event.clientX,y:event.clientY,active:false,index:0};
  });
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(!drag.active){
      if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
      const row=list.querySelector(`[data-texture-frame="${CSS.escape(drag.uid)}"]`);if(!row)return;
      drag.active=true;row.classList.add('is-dragging');drag.ghost=row.cloneNode(true);drag.ghost.className='texture-frame-row texture-layer-drag-ghost';
      drag.ghost.style.width=`${row.getBoundingClientRect().width}px`;(list.closest('dialog[open]')||document.body).append(drag.ghost);scroll.start();
    }
    event.preventDefault();drag.ghost.style.left=`${event.clientX+13}px`;drag.ghost.style.top=`${event.clientY+9}px`;updateDrop(event.clientY);
  });
  function finish(event,apply){
    if(!drag||event?.pointerId!==undefined&&event.pointerId!==drag.pointerId)return;
    if(apply&&drag.active)updateDrop(event.clientY);
    const previous=drag;drag=null;scroll.stop();previous.ghost?.remove();
    for(const row of list.querySelectorAll('.is-dragging,.drop-before,.drop-after'))row.classList.remove('is-dragging','drop-before','drop-after');
    if(!apply||!previous.active||previous.asset!==activeTextureAsset())return;
    const next=moveTextureFrameElement(frames(),previous.uid,previous.index);
    if(next!==frames())commit(previous.asset,next,previous.uid,'core.texture.frame.reorder');
  }
  document.addEventListener('pointerup',event=>finish(event,true));document.addEventListener('pointercancel',event=>finish(event,false));
  window.addEventListener('blur',()=>finish(null,false));$('#layerEditorDialog').addEventListener('close',()=>finish(null,false));
  panel.addEventListener('dragstart',event=>event.preventDefault());
  return {render,select};
}
