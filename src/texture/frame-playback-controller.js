import { activeTextureFrame, advanceTextureFrames, setTextureFramePosition, textureFramePosition } from '../common/core/frame-links.js';

export function createFramePlayback({$,state,activeTextureAsset,getAllTextureAssets,texturePlaybackKey=asset=>asset._uid||asset,onChange}) {
  const bar=$('#textureFrameProgress'),play=$('#textureFramePlay'),slider=$('#textureFramePosition'),label=$('#textureFramePositionLabel'),total=$('#textureFrameTotalLabel'),ticks=$('#textureFrameTicks');
  const playing=new Map();let request=null,tickFrames=null,drag=null,suppressClick=false;
  function render(){
    const asset=activeTextureAsset(),frames=asset?.animation?.frames||[],count=frames.length;
    bar.hidden=!asset?.animation?.enabled||!count;
    const running=playing.has(asset);play.textContent=running?'Ⅱ':'▶';play.setAttribute('aria-label',running?'暫停':'播放');play.setAttribute('aria-pressed',String(running));
    slider.max=String(count);slider.value=String(textureFramePosition(asset));label.textContent=String(Math.min(count,Math.floor(textureFramePosition(asset))+1));total.textContent=String(count);
    if(tickFrames!==frames){tickFrames=frames;ticks.replaceChildren();frames.forEach((frame,index)=>{
      const button=document.createElement('button');button.type='button';button.className='texture-frame-tick';button.style.left=`${index/count*100}%`;button.dataset.frameIndex=String(index);
      button.title=`${index+1} · ${frame.name||''}`;button.setAttribute('aria-label',button.title);ticks.append(button);
    });}
    const index=Math.floor(textureFramePosition(asset));for(const button of ticks.children)button.classList.toggle('active',Number(button.dataset.frameIndex)===index);
  }
  function seek(position){const asset=activeTextureAsset();if(!asset)return;
    const previous=activeTextureFrame(asset)?.uid;setTextureFramePosition(asset,position);if(playing.has(asset))playing.get(asset).last=performance.now();onChange({asset,playback:true,frameChanged:previous!==activeTextureFrame(asset)?.uid});render();
  }
  function tick(now){
    request=null;const live=new Set(getAllTextureAssets?.()||state.textureAssets),byKey=new Map();
    for(const asset of live){const key=texturePlaybackKey(asset);if(!byKey.has(key))byKey.set(key,asset);}
    for(let [asset,record]of [...playing]){
      if(!live.has(asset)||byKey.get(record.key)!==asset){
        const replacement=byKey.get(record.key);playing.delete(asset);if(!replacement)continue;
        setTextureFramePosition(replacement,textureFramePosition(asset));asset=replacement;playing.set(asset,record);
      }
      const previousTime=record.last;record.last=now;
      if(!asset.animation?.enabled||!asset.animation.frames?.length)continue;
      const previous=activeTextureFrame(asset)?.uid;
      advanceTextureFrames(asset,Math.max(0,(now-previousTime)/1000));
      const frameChanged=previous!==activeTextureFrame(asset)?.uid;
      if(!state.projectHomeActive&&state.textureAssets.includes(asset)&&(asset.animation.interpolate||frameChanged))onChange({asset,playback:true,frameChanged});
    }
    render();if(playing.size)request=requestAnimationFrame(tick);
  }
  play.addEventListener('click',()=>{
    const asset=activeTextureAsset();if(!asset)return;
    if(playing.has(asset))playing.delete(asset);else playing.set(asset,{last:performance.now(),key:texturePlaybackKey(asset)});
    render();if(playing.size&&request===null)request=requestAnimationFrame(tick);
  });
  slider.addEventListener('input',()=>seek(Number(slider.value)));
  ticks.addEventListener('pointerdown',event=>{
    const button=event.target.closest('[data-frame-index]');if(event.button!==0||!button)return;
    event.preventDefault();drag={id:event.pointerId,x:event.clientX,moved:false};ticks.setPointerCapture(event.pointerId);seek(Number(button.dataset.frameIndex));
  });
  ticks.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;if(Math.abs(event.clientX-drag.x)>2)drag.moved=true;if(!drag.moved)return;
    const rect=ticks.getBoundingClientRect(),count=activeTextureAsset()?.animation?.frames?.length||0;seek((event.clientX-rect.left)/Math.max(1,rect.width)*count);
  });
  const end=event=>{if(!drag||drag.id!==event.pointerId)return;suppressClick=true;drag=null;if(ticks.hasPointerCapture(event.pointerId))ticks.releasePointerCapture(event.pointerId);};
  ticks.addEventListener('pointerup',end);ticks.addEventListener('pointercancel',end);
  ticks.addEventListener('click',event=>{if(suppressClick&&event.detail!==0){suppressClick=false;return;}suppressClick=false;const button=event.target.closest('[data-frame-index]');if(button)seek(Number(button.dataset.frameIndex));});
  return {render,isPlaying:asset=>playing.has(asset)};
}
