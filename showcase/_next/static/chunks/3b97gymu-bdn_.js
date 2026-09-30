(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,28688,e=>{e.v({controls:"lens-module__4i-6ya__controls",failure:"lens-module__4i-6ya__failure",group:"lens-module__4i-6ya__group",root:"lens-module__4i-6ya__root",sr:"lens-module__4i-6ya__sr",still:"lens-module__4i-6ya__still",surface:"lens-module__4i-6ya__surface",title:"lens-module__4i-6ya__title",top:"lens-module__4i-6ya__top"})},7019,e=>{"use strict";var t=e.i(43476),r=e.i(71645),i=e.i(4046);let o=`
precision highp float;
uniform vec2 resolution, center;
uniform float time, mass, inclination, spectrum;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p), f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float turbulence(vec2 p){return .53*noise(p)+.27*noise(p*2.07+19.)+.13*noise(p*4.13)+.07*noise(p*8.31);}
vec3 sky(vec3 ray){
  vec2 uv=vec2(atan(ray.x,ray.z),asin(clamp(ray.y,-1.,1.)));
  float cloud=turbulence(uv*7.);
  float band=exp(-abs(uv.y+.22*sin(uv.x*2.))*8.);
  vec3 col=vec3(.003,.006,.014)+mix(vec3(.12,.055,.08),vec3(.035,.09,.19),cloud)*band*cloud;
  for(int j=0;j<3;j++){
    float scale=100.+float(j)*97.;vec2 grid=uv*scale, cell=floor(grid), f=fract(grid)-.5;
    float h=hash(cell+float(j)*17.);float star=exp(-dot(f,f)*(160.+float(j)*100.))*step(.965,h);
    col+=star*mix(vec3(.35,.55,1.),vec3(1.,.72,.43),h)*(.6+float(j)*.2);
  }
  return col;
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
  float framing=1.35*max(1.,1.65/(resolution.x/resolution.y));
  uv*=framing;
  float tilt=.09+inclination*.65;
  vec3 ro=vec3(0.,sin(tilt)*7.8,cos(tilt)*7.8);
  vec3 forward=normalize(-ro), right=vec3(1.,0.,0.), up=cross(right,forward);
  vec3 rd=normalize(forward*1.8+uv.x*right+uv.y*up);
  ro-=(right*center.x*(resolution.x/resolution.y)+up*center.y)*framing*2.08;
  vec3 pos=ro;
  vec3 light=vec3(0.);float absorbed=0.;float nearest=10.;
  for(int i=0;i<112;i++){
    float r=length(pos);nearest=min(nearest,r);
    if(r<mass*.38){absorbed=1.;break;}
    float stepSize=clamp(r*.085,.045,.23);
    vec3 attraction=-pos/(r*r*r)*mass*.68;
    rd=normalize(rd+(attraction-rd*dot(attraction,rd))*stepSize);
    vec3 next=pos+rd*stepSize;
    if(pos.y*next.y<0.){
      vec3 hit=mix(pos,next,abs(pos.y)/(abs(pos.y)+abs(next.y)));
      float ring=length(hit.xz), inner=mass*.78;
      float angle=atan(hit.z,hit.x), orbit=angle-time*.36/pow(max(.4,ring),1.5);
      vec2 flow=vec2(log(max(.1,ring))*14.,0.)+vec2(cos(orbit),sin(orbit))*3.;
      float grain=turbulence(flow+vec2(turbulence(flow*.47)*2.5,0.));
      float filament=turbulence(vec2(ring*82.+grain*5.,sin(orbit)*6.+cos(orbit)*3.));
      float disc=smoothstep(inner,inner+.075,ring)*(1.-smoothstep(2.05,3.3+grain*.3,ring));
      float density=(.15+grain*1.3)*(.55+filament*.65);
      float beaming=.42+1.85*pow(.5+.5*cos(angle),3.);
      vec3 hot=mix(vec3(1.,.16,.016),vec3(.055,.25,1.),spectrum);
      vec3 color=mix(hot,vec3(1.,.89,.66),exp(-max(0.,ring-inner)*2.6));
      light+=color*disc*density*beaming*2.2;
    }
    pos=next;if(length(pos)>13.)break;
  }
  vec3 color=sky(rd)*(1.-absorbed)+light;
  float photon=exp(-pow((nearest-mass*.43)*23.,2.));
  color+=mix(vec3(1.,.54,.18),vec3(.3,.6,1.),spectrum)*photon*.75*(1.-absorbed);
  color=1.-exp(-color*1.35);color=pow(color,vec3(.87));
  color*=max(.45,1.-.12*dot(uv,uv));
  gl_FragColor=vec4(color,1.);
}`;var a=e.i(28688);e.s(["default",0,function({paused:e,reducedMotion:n}){let l=(0,r.useRef)(null),s=(0,r.useRef)(null),[c,d]=(0,r.useState)(1.25),[u,h]=(0,r.useState)(.28),[f,m]=(0,r.useState)(0),[p,v]=(0,r.useState)([0,0]),[x,g]=(0,r.useState)(!1),b=(0,r.useRef)({paused:e,reducedMotion:n,values:{mass:c,inclination:u,spectrum:f,center:p}}),y=(0,r.useRef)(null);(0,r.useEffect)(()=>{b.current={paused:e,reducedMotion:n,values:{mass:c,inclination:u,spectrum:f,center:p}},e&&(y.current=null),s.current?.paint(),s.current?.sync()},[e,n,c,u,f,p]),(0,r.useEffect)(()=>{let e=!0;s.current=(0,i.createShaderSurface)(l.current,o,()=>b.current,()=>queueMicrotask(()=>{e&&g(!0)}));let t=()=>{y.current=null};return window.addEventListener("blur",t),document.addEventListener("visibilitychange",t),()=>{e=!1,s.current?.destroy(),s.current=null,window.removeEventListener("blur",t),document.removeEventListener("visibilitychange",t)}},[]);let j=(e,t)=>{let r=l.current.getBoundingClientRect();v([Math.max(-.7,Math.min(.7,(e-r.left)/r.width*2-1)),Math.max(-.65,Math.min(.65,1-(t-r.top)/r.height*2))])};return(0,t.jsxs)("div",{className:a.default.root,"data-playground":"lens","data-mass":c,"data-center":p.join(","),children:[(0,t.jsxs)("div",{className:a.default.surface,children:[(0,t.jsx)("canvas",{ref:l,tabIndex:x?-1:0,"aria-hidden":x,role:"img","aria-label":"Gravitational lens. Drag to move the black hole; arrow keys move it in steps.",onPointerDown:t=>{e||x||(y.current=t.pointerId,t.currentTarget.setPointerCapture(t.pointerId),j(t.clientX,t.clientY))},onPointerMove:t=>{y.current!==t.pointerId||e||j(t.clientX,t.clientY)},onPointerUp:()=>{y.current=null},onPointerCancel:()=>{y.current=null},onLostPointerCapture:()=>{y.current=null},onKeyDown:t=>{!e&&!x&&t.key.startsWith("Arrow")&&(t.preventDefault(),v(([e,r])=>[Math.max(-.7,Math.min(.7,e+("ArrowRight"===t.key?.08:"ArrowLeft"===t.key?-.08:0))),Math.max(-.65,Math.min(.65,r+("ArrowUp"===t.key?.08:"ArrowDown"===t.key?-.08:0)))]))}}),(0,t.jsxs)("div",{className:a.default.top,children:[(0,t.jsx)("span",{children:"OBSERVATORY / 001"}),(0,t.jsx)("span",{children:"LIGHT TAKES THE LONG WAY HOME"})]}),(0,t.jsxs)("div",{className:a.default.title,children:[(0,t.jsxs)("span",{children:["Even light",(0,t.jsx)("br",{}),(0,t.jsx)("em",{children:"takes a detour."})]}),(0,t.jsxs)("p",{children:["DRAG THE SINGULARITY",(0,t.jsx)("br",{}),"BEND WHAT YOU SEE"]})]}),x&&(0,t.jsxs)(t.Fragment,{children:[(0,t.jsxs)("svg",{className:a.default.still,viewBox:"0 0 1000 600",role:"img","aria-label":"Static study of an amber accretion disc bent around a dark singularity",children:[(0,t.jsxs)("defs",{children:[(0,t.jsxs)("radialGradient",{id:"lens-still-glow",children:[(0,t.jsx)("stop",{stopColor:"#f8ca8a",stopOpacity:".6"}),(0,t.jsx)("stop",{offset:".35",stopColor:"#db7658",stopOpacity:".12"}),(0,t.jsx)("stop",{offset:"1",stopColor:"#05080e",stopOpacity:"0"})]}),(0,t.jsxs)("linearGradient",{id:"lens-still-ring",children:[(0,t.jsx)("stop",{stopColor:"#ac604d"}),(0,t.jsx)("stop",{offset:".5",stopColor:"#ffe1a0"}),(0,t.jsx)("stop",{offset:"1",stopColor:"#9d524a"})]})]}),(0,t.jsx)("rect",{width:"1000",height:"600",fill:"#05080e"}),Array.from({length:54},(e,r)=>(0,t.jsx)("circle",{cx:(193*r+87)%1e3,cy:(127*r+33)%600,r:r%4==0?1.5:.7,fill:"#ccdaee",opacity:.25+r%5*.12},r)),(0,t.jsx)("ellipse",{cx:"520",cy:"276",rx:"340",ry:"225",fill:"url(#lens-still-glow)"}),(0,t.jsxs)("g",{transform:"rotate(-13 520 276)",fill:"none",stroke:"url(#lens-still-ring)",children:[(0,t.jsx)("ellipse",{cx:"520",cy:"276",rx:"290",ry:"54",strokeWidth:"5"}),(0,t.jsx)("ellipse",{cx:"520",cy:"276",rx:"278",ry:"43",strokeWidth:"2"}),(0,t.jsx)("ellipse",{cx:"520",cy:"276",rx:"268",ry:"34",strokeWidth:"1"})]}),(0,t.jsx)("circle",{cx:"520",cy:"276",r:"94",fill:"#05080e",stroke:"#fac889",strokeWidth:"3"}),(0,t.jsx)("path",{d:"M424 276a96 96 0 0 1 192 0",fill:"none",stroke:"#ffe8b4",strokeWidth:"7",opacity:".85"})]}),(0,t.jsxs)("div",{className:a.default.failure,role:"status",children:[(0,t.jsx)("strong",{children:"Live rendering needs WebGL."}),(0,t.jsx)("p",{children:"This still keeps the light study available."}),(0,t.jsxs)("a",{href:"/showcase/motion-lab/archive?experiment=optics#experiment",children:["Explore Prism bench ",(0,t.jsx)("span",{"aria-hidden":"true",children:"↗"})]})]})]})]}),(0,t.jsxs)("fieldset",{className:a.default.controls,disabled:e||x,children:[(0,t.jsx)("legend",{className:a.default.sr,children:"Observatory controls"}),(0,t.jsxs)("label",{children:["Mass ",(0,t.jsx)("input",{type:"range",min:".65",max:"1.9",step:".01",value:c,onChange:e=>d(+e.target.value)}),(0,t.jsx)("output",{children:c.toFixed(2)})]}),(0,t.jsxs)("label",{children:["View angle ",(0,t.jsx)("input",{type:"range",min:"0",max:"1",step:".01",value:u,onChange:e=>h(+e.target.value)})]}),(0,t.jsx)("div",{className:a.default.group,children:["Solar","Ion"].map((e,r)=>(0,t.jsx)("button",{type:"button","aria-pressed":f===r,onClick:()=>m(r),children:e},e))}),(0,t.jsx)("button",{type:"button",onClick:()=>v([0,0]),children:"Center the lens"}),(0,t.jsxs)("p",{children:["Change the mass. Watch the disc fold around it. ",n?"Direct mode: light changes only with your controls.":"An artistic light-bending model, not a scientific measurement."]})]})]})}],7019)},69900,function(e){e.n(e.i(7019))},4046,e=>{"use strict";e.s(["createShaderSurface",0,function(e,t,r,i){let o=e.getContext("webgl",{alpha:!1,antialias:!1,preserveDrawingBuffer:!0});if(!o)return i(),null;let a=[],n=null,l=null;try{if(!(n=o.createProgram()))throw Error("Shader program unavailable");for(let[e,r]of[[o.VERTEX_SHADER,"attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}"],[o.FRAGMENT_SHADER,t]]){let t=o.createShader(e);if(!t)throw Error("Shader unavailable");if(a.push(t),o.shaderSource(t,r),o.compileShader(t),!o.getShaderParameter(t,o.COMPILE_STATUS))throw Error(o.getShaderInfoLog(t)||"Shader compilation failed");o.attachShader(n,t)}if(o.linkProgram(n),!o.getProgramParameter(n,o.LINK_STATUS))throw Error("Shader link failed");o.useProgram(n),l=o.createBuffer(),o.bindBuffer(o.ARRAY_BUFFER,l),o.bufferData(o.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),o.STATIC_DRAW);let e=o.getAttribLocation(n,"position");o.enableVertexAttribArray(e),o.vertexAttribPointer(e,2,o.FLOAT,!1,0,0)}catch(t){return e.dataset.rendererError=t instanceof Error?t.message:"Renderer unavailable",o.deleteProgram(n),o.deleteBuffer(l),a.forEach(e=>o.deleteShader(e)),i(),null}let s=Object.fromEntries(["resolution","time",...Object.keys(r().values)].map(e=>[e,o.getUniformLocation(n,e)])),c=!1,d=!0,u=0,h=0,f=0,m=0,p=()=>{c||o.isContextLost()||(o.uniform2f(s.resolution,e.width,e.height),o.uniform1f(s.time,f),Object.entries(r().values).forEach(([e,t])=>{Array.isArray(t)?o.uniform2f(s[e],t[0],t[1]):o.uniform1f(s[e],t)}),o.drawArrays(o.TRIANGLES,0,6),e.dataset.frame=String(++m),e.dataset.time=f.toFixed(3))},v=e=>{c||((!h||e-h>=33)&&(f+=h?Math.min((e-h)/1e3,.06):0,h=e,p()),u=requestAnimationFrame(v))},x=()=>{cancelAnimationFrame(u),h=0,c||o.isContextLost()||!d||document.hidden||r().paused||r().reducedMotion||(u=requestAnimationFrame(v))},g=()=>{let t=e.getBoundingClientRect(),r=Math.min(devicePixelRatio,1.5,1400/Math.max(1,t.width));e.width=Math.max(1,Math.round(t.width*r)),e.height=Math.max(1,Math.round(t.height*r)),o.viewport(0,0,e.width,e.height),p()},b=new ResizeObserver(g);b.observe(e);let y=new IntersectionObserver(e=>{d=e[0].isIntersecting,x()});y.observe(e);let j=e=>{e.preventDefault(),cancelAnimationFrame(u),i()};return e.addEventListener("webglcontextlost",j),document.addEventListener("visibilitychange",x),g(),x(),{paint:p,sync:x,destroy:()=>{c=!0,cancelAnimationFrame(u),b.disconnect(),y.disconnect(),e.removeEventListener("webglcontextlost",j),document.removeEventListener("visibilitychange",x),o.deleteProgram(n),o.deleteBuffer(l),a.forEach(e=>o.deleteShader(e))}}}])}]);