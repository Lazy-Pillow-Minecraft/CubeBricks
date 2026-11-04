export function bindDialogDrag(dialog, heading) {
  heading.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button,input,select'))return;
    event.preventDefault();
    const bounds=dialog.getBoundingClientRect(),start=[event.clientX,event.clientY];
    heading.setPointerCapture(event.pointerId);
    Object.assign(dialog.style,{position:'fixed',margin:'0',left:`${bounds.left}px`,top:`${bounds.top}px`});
    const move=next=>{
      dialog.style.left=`${Math.max(0,Math.min(window.innerWidth-80,bounds.left+next.clientX-start[0]))}px`;
      dialog.style.top=`${Math.max(0,Math.min(window.innerHeight-42,bounds.top+next.clientY-start[1]))}px`;
    };
    const stop=()=>{
      heading.removeEventListener('pointermove',move);heading.removeEventListener('pointerup',stop);heading.removeEventListener('pointercancel',stop);
    };
    heading.addEventListener('pointermove',move);heading.addEventListener('pointerup',stop);heading.addEventListener('pointercancel',stop);
  });
}
