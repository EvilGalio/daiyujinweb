(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,28688,e=>{e.v({controls:"lens-module__4i-6ya__controls",failure:"lens-module__4i-6ya__failure",group:"lens-module__4i-6ya__group",root:"lens-module__4i-6ya__root",sr:"lens-module__4i-6ya__sr",surface:"lens-module__4i-6ya__surface",title:"lens-module__4i-6ya__title",top:"lens-module__4i-6ya__top"})},7019,e=>{"use strict";var t=e.i(43476),r=e.i(71645),n=e.i(4046);let a=`
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
}`;var o=e.i(28688);e.s(["default",0,function({paused:e,reducedMotion:i}){let l=(0,r.useRef)(null),s=(0,r.useRef)(null),[c,u]=(0,r.useState)(1.25),[d,h]=(0,r.useState)(.28),[f,m]=(0,r.useState)(0),[v,g]=(0,r.useState)([0,0]),[p,x]=(0,r.useState)(!1),b=(0,r.useRef)({paused:e,reducedMotion:i,values:{mass:c,inclination:d,spectrum:f,center:v}}),y=(0,r.useRef)(null);(0,r.useEffect)(()=>{b.current={paused:e,reducedMotion:i,values:{mass:c,inclination:d,spectrum:f,center:v}},e&&(y.current=null),s.current?.paint(),s.current?.sync()},[e,i,c,d,f,v]),(0,r.useEffect)(()=>{let e=!0;s.current=(0,n.createShaderSurface)(l.current,a,()=>b.current,()=>queueMicrotask(()=>{e&&x(!0)}));let t=()=>{y.current=null};return window.addEventListener("blur",t),document.addEventListener("visibilitychange",t),()=>{e=!1,s.current?.destroy(),s.current=null,window.removeEventListener("blur",t),document.removeEventListener("visibilitychange",t)}},[]);let w=(e,t)=>{let r=l.current.getBoundingClientRect();g([Math.max(-.7,Math.min(.7,(e-r.left)/r.width*2-1)),Math.max(-.65,Math.min(.65,1-(t-r.top)/r.height*2))])};return(0,t.jsxs)("div",{className:o.default.root,"data-playground":"lens","data-mass":c,"data-center":v.join(","),children:[(0,t.jsxs)("div",{className:o.default.surface,children:[(0,t.jsx)("canvas",{ref:l,tabIndex:0,role:"img","aria-label":"Gravitational lens. Drag to move the black hole; arrow keys move it in steps.",onPointerDown:t=>{e||p||(y.current=t.pointerId,t.currentTarget.setPointerCapture(t.pointerId),w(t.clientX,t.clientY))},onPointerMove:t=>{y.current!==t.pointerId||e||w(t.clientX,t.clientY)},onPointerUp:()=>{y.current=null},onPointerCancel:()=>{y.current=null},onLostPointerCapture:()=>{y.current=null},onKeyDown:t=>{!e&&!p&&t.key.startsWith("Arrow")&&(t.preventDefault(),g(([e,r])=>[Math.max(-.7,Math.min(.7,e+("ArrowRight"===t.key?.08:"ArrowLeft"===t.key?-.08:0))),Math.max(-.65,Math.min(.65,r+("ArrowUp"===t.key?.08:"ArrowDown"===t.key?-.08:0)))]))}}),(0,t.jsxs)("div",{className:o.default.top,children:[(0,t.jsx)("span",{children:"OBSERVATORY / 001"}),(0,t.jsx)("span",{children:"LIGHT TAKES THE LONG WAY HOME"})]}),(0,t.jsxs)("div",{className:o.default.title,children:[(0,t.jsxs)("span",{children:["Even light",(0,t.jsx)("br",{}),(0,t.jsx)("em",{children:"takes a detour."})]}),(0,t.jsxs)("p",{children:["DRAG THE SINGULARITY",(0,t.jsx)("br",{}),"BEND WHAT YOU SEE"]})]}),p&&(0,t.jsxs)("div",{className:o.default.failure,role:"status",children:[(0,t.jsx)("strong",{children:"This observatory needs WebGL."}),(0,t.jsx)("p",{children:"Reset to try again, or explore Prism bench with its canvas renderer."})]})]}),(0,t.jsxs)("fieldset",{className:o.default.controls,disabled:e||p,children:[(0,t.jsx)("legend",{className:o.default.sr,children:"Observatory controls"}),(0,t.jsxs)("label",{children:["Mass ",(0,t.jsx)("input",{type:"range",min:".65",max:"1.9",step:".01",value:c,onChange:e=>u(+e.target.value)}),(0,t.jsx)("output",{children:c.toFixed(2)})]}),(0,t.jsxs)("label",{children:["View angle ",(0,t.jsx)("input",{type:"range",min:"0",max:"1",step:".01",value:d,onChange:e=>h(+e.target.value)})]}),(0,t.jsx)("div",{className:o.default.group,children:["Solar","Ion"].map((e,r)=>(0,t.jsx)("button",{type:"button","aria-pressed":f===r,onClick:()=>m(r),children:e},e))}),(0,t.jsx)("button",{type:"button",onClick:()=>g([0,0]),children:"Center the lens"}),(0,t.jsxs)("p",{children:["Change the mass. Watch the disc fold around it. ",i?"Direct mode: light changes only with your controls.":"An artistic light-bending model, not a scientific measurement."]})]})]})}],7019)},69900,function(e){e.n(e.i(7019))},4046,e=>{"use strict";e.s(["createShaderSurface",0,function(e,t,r,n){let a=e.getContext("webgl",{alpha:!1,antialias:!1,preserveDrawingBuffer:!0});if(!a)return n(),null;let o=[],i=null,l=null;try{if(!(i=a.createProgram()))throw Error("Shader program unavailable");for(let[e,r]of[[a.VERTEX_SHADER,"attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}"],[a.FRAGMENT_SHADER,t]]){let t=a.createShader(e);if(!t)throw Error("Shader unavailable");if(o.push(t),a.shaderSource(t,r),a.compileShader(t),!a.getShaderParameter(t,a.COMPILE_STATUS))throw Error(a.getShaderInfoLog(t)||"Shader compilation failed");a.attachShader(i,t)}if(a.linkProgram(i),!a.getProgramParameter(i,a.LINK_STATUS))throw Error("Shader link failed");a.useProgram(i),l=a.createBuffer(),a.bindBuffer(a.ARRAY_BUFFER,l),a.bufferData(a.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),a.STATIC_DRAW);let e=a.getAttribLocation(i,"position");a.enableVertexAttribArray(e),a.vertexAttribPointer(e,2,a.FLOAT,!1,0,0)}catch(t){return e.dataset.rendererError=t instanceof Error?t.message:"Renderer unavailable",a.deleteProgram(i),a.deleteBuffer(l),o.forEach(e=>a.deleteShader(e)),n(),null}let s=Object.fromEntries(["resolution","time",...Object.keys(r().values)].map(e=>[e,a.getUniformLocation(i,e)])),c=!1,u=!0,d=0,h=0,f=0,m=0,v=()=>{c||a.isContextLost()||(a.uniform2f(s.resolution,e.width,e.height),a.uniform1f(s.time,f),Object.entries(r().values).forEach(([e,t])=>{Array.isArray(t)?a.uniform2f(s[e],t[0],t[1]):a.uniform1f(s[e],t)}),a.drawArrays(a.TRIANGLES,0,6),e.dataset.frame=String(++m),e.dataset.time=f.toFixed(3))},g=e=>{c||((!h||e-h>=33)&&(f+=h?Math.min((e-h)/1e3,.06):0,h=e,v()),d=requestAnimationFrame(g))},p=()=>{cancelAnimationFrame(d),h=0,c||a.isContextLost()||!u||document.hidden||r().paused||r().reducedMotion||(d=requestAnimationFrame(g))},x=()=>{let t=e.getBoundingClientRect(),r=Math.min(devicePixelRatio,1.5,1400/Math.max(1,t.width));e.width=Math.max(1,Math.round(t.width*r)),e.height=Math.max(1,Math.round(t.height*r)),a.viewport(0,0,e.width,e.height),v()},b=new ResizeObserver(x);b.observe(e);let y=new IntersectionObserver(e=>{u=e[0].isIntersecting,p()});y.observe(e);let w=e=>{e.preventDefault(),cancelAnimationFrame(d),n()};return e.addEventListener("webglcontextlost",w),document.addEventListener("visibilitychange",p),x(),p(),{paint:v,sync:p,destroy:()=>{c=!0,cancelAnimationFrame(d),b.disconnect(),y.disconnect(),e.removeEventListener("webglcontextlost",w),document.removeEventListener("visibilitychange",p),a.deleteProgram(i),a.deleteBuffer(l),o.forEach(e=>a.deleteShader(e))}}}])}]);