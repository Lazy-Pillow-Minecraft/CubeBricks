export const HISTORY_MARK_SHAPES=Object.freeze([
  {id:'square',label:'方形'},{id:'diamond',label:'正菱形'},{id:'circle',label:'圓形'},
  {id:'hexagon',label:'六邊形'},{id:'star',label:'五角星'},{id:'triangle',label:'三角形'}
]);

export function historyMarkPath(shape,radius=7) {
  if(shape==='circle')return `M${-radius},0A${radius},${radius} 0 1 0 ${radius},0A${radius},${radius} 0 1 0 ${-radius},0Z`;
  let points;
  if(shape==='square')points=[[-.75,-.75],[.75,-.75],[.75,.75],[-.75,.75]];
  else if(shape==='diamond')points=[[0,-1],[1,0],[0,1],[-1,0]];
  else{
    const count=shape==='star'?10:shape==='hexagon'?6:3;
    points=Array.from({length:count},(_,index)=>{
      const angle=-Math.PI/2+index*Math.PI*2/count,scale=shape==='star'&&index%2?.44:1;
      return [Math.cos(angle)*scale,Math.sin(angle)*scale];
    });
  }
  return points.map(([x,y],index)=>`${index?'L':'M'}${+(x*radius).toFixed(4)},${+(y*radius).toFixed(4)}`).join('')+'Z';
}
