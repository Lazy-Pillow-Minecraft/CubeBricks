import { translateUiText } from '../common/config/app-config.js';
import { operationDefinition } from '../common/core/operation-registry.js';
import { bindDialogDrag } from '../utils/dom/dialog-drag.js';
import { showAppConfirm } from '../screen/prompt-dialog.js';
import { layoutProjectHistory, nearestHistoryNode } from './history-layout.js';
import { editHistoryNodeMark } from './history-mark-editor.js';
import { historyMarkPath } from './history-mark-shapes.js';

export function createProjectHistoryDialog({$,state,projectTabsController,journalController,showContextMenu,closeContextMenu,openColorPickerPopup,toast}) {
  const dialog=$('#projectHistoryDialog'),svg=$('#projectHistoryGraph'),viewport=$('#projectHistoryViewport'),status=$('#projectHistoryStatus');
  const ns='http://www.w3.org/2000/svg';
  let graph=null,layout=null,tabId=null,hover=null,revision=0,frame=null,busy=false,drag=null;
  let zoom=1,center=[0,0],selectedSequence=null,viewFrame=null;
  const elements=new Map(),decorations=[];
  const make=(tag,attributes)=>{
    const element=document.createElementNS(ns,tag);
    for(const [key,value]of Object.entries(attributes))element.setAttribute(key,String(value));
    return element;
  };
  function tooltip(node) {
    const label=operationDefinition(node.operationId)?.label||node.label||node.operationId;
    return [node.mark?.name,`#${node.sequence}`,translateUiText(label),node.timestamp?new Date(node.timestamp).toLocaleString():'',
      node.current?translateUiText('目前狀態'):''].filter(Boolean).join(' · ');
  }
  function setHover(node) {
    if(hover?.sequence===node?.sequence)return;
    elements.get(hover?.sequence)?.classList.remove('is-hover');hover=node;
    elements.get(node?.sequence)?.classList.add('is-hover');
    viewport.title=node?tooltip(node):'';
    viewport.classList.toggle('over-history-node',Boolean(node));
  }
  function updateView() {
    const side=1000/zoom;
    svg.setAttribute('viewBox',`${center[0]-side/2} ${center[1]-side/2} ${side} ${side}`);
    const matrix=svg.getScreenCTM(),scale=matrix?Math.hypot(matrix.a,matrix.b):1;
    const unit=1/Math.max(.0001,scale);
    svg.style.setProperty('--history-node-unit',String(unit));
    for(const decoration of decorations)decoration.setAttribute('transform',`scale(${unit})`);
  }
  function stopViewAnimation(){if(viewFrame!==null)cancelAnimationFrame(viewFrame);viewFrame=null;}
  function focusView(position,nextZoom){
    stopViewAnimation();setHover(null);
    const start=performance.now(),from=[...center],fromZoom=zoom;
    const tick=now=>{
      const progress=Math.min(1,(now-start)/200),amount=1-(1-progress)**3;
      center=from.map((value,axis)=>value+(position[axis]-value)*amount);
      zoom=fromZoom+(nextZoom-fromZoom)*amount;updateView();
      viewFrame=progress<1?requestAnimationFrame(tick):null;
    };
    viewFrame=requestAnimationFrame(tick);
  }
  function selectNode(node){
    elements.get(selectedSequence)?.classList.remove('is-selected');selectedSequence=node?.sequence??null;
    elements.get(selectedSequence)?.classList.add('is-selected');
  }
  function pointAt(event) {
    const matrix=svg.getScreenCTM();
    return matrix?new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()):null;
  }
  function hitAt(event) {
    if(busy||drag)return null;
    const decoration=event.target.closest?.('.history-mark-label,.history-mark-symbol');
    if(decoration)return layout?.byId.get(Number(decoration.closest('[data-history-node]').dataset.historyNode));
    const point=pointAt(event),matrix=svg.getScreenCTM();
    return point&&nearestHistoryNode(layout,point.x,point.y,9/Math.max(.0001,Math.hypot(matrix.a,matrix.b)));
  }
  function draw() {
    stopViewAnimation();layout=layoutProjectHistory(graph);elements.clear();decorations.length=0;setHover(null);
    if(!layout.byId.has(selectedSequence))selectedSequence=graph.current;
    const fragment=document.createDocumentFragment();
    fragment.append(make('path',{d:layout.path,class:'history-tree-lines','data-history-edges':layout.edgeCount,'vector-effect':'non-scaling-stroke'}));
    if(layout.virtualCenter){
      fragment.append(make('path',{d:layout.detachedPath,class:'history-tree-lines history-detached-lines','vector-effect':'non-scaling-stroke'}));
      fragment.append(make('circle',{cx:0,cy:0,r:4,class:'history-virtual-center','vector-effect':'non-scaling-stroke'}));
    }
    for(const node of [...layout.points].sort((a,b)=>Number(a.current)-Number(b.current))){
      const group=make('g',{'data-history-node':node.sequence,class:`history-tree-node${node.tip?' is-tip':''}${node.current?' is-current':''}${node.sequence===selectedSequence?' is-selected':''}${node.mark?' is-marked':''}`,
        transform:`translate(${node.x} ${node.y})`});
      group.append(make('circle',{class:'history-node-marker',r:3}),make('circle',{class:'history-node-hit',r:9}));
      if(node.mark){
        group.style.setProperty('--history-mark-color',node.mark.color);
        const decoration=make('g',{class:'history-mark-decoration'});
        decoration.append(make('path',{class:'history-mark-symbol',d:historyMarkPath(node.mark.shape,node.current?10.5:7),'vector-effect':'non-scaling-stroke'}));
        if(node.mark.name){
          const label=make('g',{class:'history-mark-label',translate:'no'});
          if(node.current)label.setAttribute('transform','translate(0 -4)');
          const background=make('rect',{class:'history-mark-label-background',x:-6,y:-31,width:12,height:20,rx:3});
          const text=make('text',{class:'history-mark-label-text',x:0,y:-17,'text-anchor':'middle'});text.textContent=node.mark.name;
          label.append(background,text);decoration.append(label);
        }
        decorations.push(decoration);group.append(decoration);
      }
      elements.set(node.sequence,group);fragment.append(group);
    }
    svg.replaceChildren(fragment);
    for(const label of svg.querySelectorAll('.history-mark-label')){
      const width=label.querySelector('text').getComputedTextLength()+12;
      label.querySelector('rect').setAttribute('x',String(-width/2));label.querySelector('rect').setAttribute('width',String(width));
    }
    updateView();
  }
  async function refresh({force=false}={}) {
    if(!dialog.open||busy&&!force)return;
    const generation=++revision;
    status.hidden=false;status.textContent='正在讀取歷史記錄';
    try {
      const result=await journalController.getProjectHistoryGraph();
      if(!dialog.open||generation!==revision)return;
      graph=result;
      if(!graph){svg.replaceChildren();status.textContent='歷史記錄僅在桌面版可用';return;}
      draw();status.hidden=true;
    }catch(error){if(generation===revision){status.textContent='歷史記錄讀取失敗';toast(error.message);}}
  }
  function scheduleRefresh() {
    if(!dialog.open||frame!==null)return;
    frame=requestAnimationFrame(()=>{frame=null;void refresh();});
  }
  async function run(action) {
    if(busy)return;
    busy=true;dialog.classList.add('is-busy');setHover(null);closeContextMenu();
    try {await action();}catch(error){toast(error.message);}
    finally {
      try{await refresh({force:true});}
      finally{busy=false;dialog.classList.remove('is-busy');}
    }
  }
  svg.addEventListener('pointermove',event=>{
    if(drag){
      const scale=Math.hypot(svg.getScreenCTM().a,svg.getScreenCTM().b);
      center=[drag.center[0]-(event.clientX-drag.x)/scale,drag.center[1]-(event.clientY-drag.y)/scale];updateView();
    }else setHover(hitAt(event));
  });
  svg.addEventListener('pointerleave',()=>setHover(null));
  svg.addEventListener('pointerdown',event=>{
    if(busy||![0,1].includes(event.button))return;
    viewport.focus({preventScroll:true});
    const node=event.button===0&&hitAt(event);
    if(node){event.preventDefault();selectNode(node);return;}
    stopViewAnimation();
    event.preventDefault();drag={x:event.clientX,y:event.clientY,center:[...center],pointerId:event.pointerId};
    svg.setPointerCapture(event.pointerId);viewport.classList.add('is-panning');setHover(null);
  });
  const stopPan=()=>{
    if(drag&&svg.hasPointerCapture(drag.pointerId))svg.releasePointerCapture(drag.pointerId);
    drag=null;viewport.classList.remove('is-panning');
  };
  svg.addEventListener('pointerup',stopPan);svg.addEventListener('pointercancel',stopPan);
  svg.addEventListener('wheel',event=>{
    event.preventDefault();const point=pointAt(event);if(!point||busy)return;
    stopViewAnimation();
    const next=Math.max(.3,Math.min(40,zoom*Math.exp(-event.deltaY*.0015))),ratio=next/zoom;
    center=[point.x-(point.x-center[0])/ratio,point.y-(point.y-center[1])/ratio];zoom=next;updateView();setHover(null);
  },{passive:false});
  svg.addEventListener('contextmenu',event=>{
    const node=hitAt(event);event.preventDefault();if(!node)return;
    selectNode(node);setHover(node);
    showContextMenu(event,{source:elements.get(node.sequence),items:[
      {label:'切換到此歷史狀態',disabled:node.current,action:()=>run(()=>journalController.checkoutProjectHistory(node.sequence))},
      {label:node.mark?'編輯節點標記':'標記節點',action:async()=>{
        const accent=getComputedStyle(svg).getPropertyValue('--accent').trim();
        const mark=await editHistoryNodeMark({mark:node.mark,defaultColor:/^#[a-f0-9]{6}$/i.test(accent)?accent:'#ebc54c',openColorPickerPopup});
        if(mark!==undefined&&dialog.open)await run(()=>journalController.setProjectHistoryMark(node.sequence,mark));
      }},
      {separator:true},
      {label:'刪除單個節點',danger:true,disabled:!node.canDelete,title:node.canDelete?'':'至少需要保留一個歷史狀態',action:()=>confirmRemoval(node,true)},
      {label:'刪除節點及後續整個分支',danger:true,disabled:!node.canPrune,title:node.canPrune?'':'至少需要保留一個歷史狀態',action:()=>confirmRemoval(node,false)}
    ]});
  });
  window.addEventListener('keydown',event=>{
    if(!dialog.open||event.ctrlKey||event.metaKey||event.altKey||event.key.toLowerCase()!=='r')return;
    if(event.target.closest?.('input,select,textarea,[contenteditable]'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if([...document.querySelectorAll('dialog[open]')].at(-1)!==dialog||busy||event.repeat)return;
    closeContextMenu();
    if(event.shiftKey)focusView([0,0],1);
    else {const node=layout?.byId.get(selectedSequence)??layout?.byId.get(graph?.current);if(node)focusView([node.x,node.y],Math.max(4,zoom));}
  },{capture:true});
  async function confirmRemoval(node,single) {
    const confirmed=await showAppConfirm(single?'只刪除此歷史節點？後續記錄會保留。':'刪除此節點及其全部後續分支？',{
      title:single?'刪除歷史節點':'刪除歷史分支',
      detail:'這項操作無法撤銷。如果目前狀態被刪除，會先還原到仍保留的父節點或鄰近歷史狀態。',
      buttons:[single?'刪除節點':'刪除分支','取消'],defaultIndex:1,cancelIndex:1});
    if(confirmed)await run(()=>journalController.pruneProjectHistoryBranch(node.sequence,{single}));
  }
  $('#closeProjectHistory').addEventListener('click',()=>{closeContextMenu();dialog.close();});
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    revision++;closeContextMenu();setHover(null);stopPan();stopViewAnimation();if(frame!==null)cancelAnimationFrame(frame);frame=null;
  });
  window.addEventListener('cubebricks:history-change',event=>{if(event.detail?.tabId===tabId)scheduleRefresh();});
  window.addEventListener('cubebricks:project-home',()=>{if(dialog.open)dialog.close();});
  window.addEventListener('cubebricks:texture-change',()=>{if(dialog.open&&tabId!==projectTabsController.activeId)dialog.close();});
  new ResizeObserver(updateView).observe(viewport);
  bindDialogDrag(dialog,dialog.querySelector('.dialog-heading'));
  $('[data-action="history"]').addEventListener('click',()=>{
    if(state.projectHomeActive)return;
    closeContextMenu();
    tabId=projectTabsController.activeId;zoom=1;center=[0,0];selectedSequence=null;
    if(!dialog.open)dialog.showModal();void refresh();
  });
  return {refresh,scheduleRefresh};
}
