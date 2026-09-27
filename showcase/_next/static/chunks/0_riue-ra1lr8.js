(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,81566,e=>{e.v({controls:"ferro-module__ICDd_a__controls",failure:"ferro-module__ICDd_a__failure",header:"ferro-module__ICDd_a__header",hint:"ferro-module__ICDd_a__hint",root:"ferro-module__ICDd_a__root",sr:"ferro-module__ICDd_a__sr",surface:"ferro-module__ICDd_a__surface",title:"ferro-module__ICDd_a__title"})},53939,e=>{"use strict";var t=e.i(43476),r=e.i(71645),a=e.i(4046);let o=`
precision highp float;
uniform vec2 resolution, magnet;
uniform float time, strength, spacing, finish, pair;
float field(vec2 p){
  float d=length(p-magnet);float f=exp(-d*d*.27);
  if(pair>.5){d=length(p+magnet+vec2(1.4,.3));f=max(f,exp(-d*d*.4));}
  return f;
}
float heightAt(vec2 p){
  float cell=.4+spacing*.4;
  vec2 q=p/cell;vec2 a=mod(q,vec2(1.,1.732))-.5*vec2(1.,1.732);
  vec2 b=mod(q-vec2(.5,.866),vec2(1.,1.732))-.5*vec2(1.,1.732);
  float d=min(length(a),length(b));float tip=exp(-sqrt(d*d+.004)*6.1);
  float edge=1.-smoothstep(3.1,3.6,length(p));
  return edge*(.13+strength*field(p)*(.07+2.1*tip)+.007*sin(length(p-magnet)*9.-time*1.5)*strength);
}
vec3 environment(vec3 r){
  vec3 col=mix(vec3(.018,.026,.033),vec3(.39,.48,.5),smoothstep(-.25,1.,r.y));
  float panel=smoothstep(.22,.42,r.y)*(1.-smoothstep(.66,.88,r.y))*smoothstep(-.98,-.7,r.x)*(1.-smoothstep(-.02,.19,r.x));
  float strip=exp(-pow((r.x-.63)*23.,2.))*smoothstep(-.2,.6,r.y);
  col+=vec3(1.35,1.5,1.65)*panel+vec3(.7,1.,1.3)*strip;
  col+=vec3(.75,.42,.18)*pow(max(0.,dot(r,normalize(vec3(-1.,.25,-1.)))),18.);
  return col;
}
void main(){
  vec2 uv=(gl_FragCoord.xy-resolution*.5)/resolution.y;
  uv*=1.13*max(1.,1.65/(resolution.x/resolution.y));
  vec3 ro=vec3(0.,5.8,7.2), target=vec3(0.,.15,0.);
  vec3 fw=normalize(target-ro), rt=vec3(1.,0.,0.), up=cross(rt,fw), rd=normalize(fw*1.55+uv.x*rt+uv.y*up);
  float t=0.;vec3 pos=ro;float hit=0.;
  for(int i=0;i<220;i++){
    pos=ro+rd*t;float h=heightAt(pos.xz), d=pos.y-h;
    if(d<.003){hit=1.;break;}
    t+=clamp(d*.115,.004,.25);if(t>20.)break;
  }
  vec3 color=vec3(.74,.78,.72);
  if(hit>.5){
    float radius=length(pos.xz);
    if(radius<3.58){
      float e=.012;vec3 n=normalize(vec3(heightAt(pos.xz-vec2(e,0))-heightAt(pos.xz+vec2(e,0)),e*2.,heightAt(pos.xz-vec2(0,e))-heightAt(pos.xz+vec2(0,e))));
      vec3 reflected=environment(reflect(rd,n));
      float fresnel=pow(1.-max(0.,dot(-rd,n)),3.);
      vec3 base=mix(vec3(.016,.026,.026),vec3(.21,.12,.04),finish);
      float occlusion=1.;
      for(int j=1;j<5;j++){float f=float(j)*.12;float h=heightAt(pos.xz+vec2(-.6,-.5)*f);occlusion-=max(0.,h-pos.y-f*.85)*.4;}
      color=base+reflected*(.52+.42*fresnel);
      color+=pow(max(0.,dot(reflect(rd,n),normalize(vec3(-.6,1.,.6)))),100.)*vec3(.5,.65,.75);
      color*=clamp(occlusion,.4,1.)*(.6+.4*smoothstep(0.,.7,pos.y));
      if(finish>.5)color*=vec3(1.5,1.1,.58);
    }else{
      float shadow=exp(-pow(radius-3.5,2.)*3.)*.27;
      color*=1.-shadow;
      float grid=step(.985,fract(pos.x*.65))+step(.985,fract(pos.z*.65));color-=grid*.035;
    }
  }
  color=1.-exp(-max(color,0.)*1.25);color=pow(color,vec3(.78));color*=max(.6,1.-.045*dot(uv,uv));
  gl_FragColor=vec4(color,1.);
}`;var n=e.i(81566);e.s(["default",0,function({paused:e,reducedMotion:i}){let l=(0,r.useRef)(null),s=(0,r.useRef)(null),c=(0,r.useRef)(null),[d,u]=(0,r.useState)(1.25),[h,f]=(0,r.useState)(.7),[m,v]=(0,r.useState)(0),[p,g]=(0,r.useState)(0),[x,b]=(0,r.useState)([.6,.1]),[_,A]=(0,r.useState)(!1),w=(0,r.useRef)({paused:e,reducedMotion:i,values:{strength:d,spacing:h,finish:m,pair:p,magnet:x}});(0,r.useEffect)(()=>{w.current={paused:e,reducedMotion:i,values:{strength:d,spacing:h,finish:m,pair:p,magnet:x}},e&&(c.current=null),s.current?.paint(),s.current?.sync()},[e,i,d,h,m,p,x]),(0,r.useEffect)(()=>{let e=!0;s.current=(0,a.createShaderSurface)(l.current,o,()=>w.current,()=>queueMicrotask(()=>{e&&A(!0)}));let t=()=>{c.current=null};return window.addEventListener("blur",t),document.addEventListener("visibilitychange",t),()=>{e=!1,s.current?.destroy(),s.current=null,window.removeEventListener("blur",t),document.removeEventListener("visibilitychange",t)}},[]);let y=(e,t)=>{let r=l.current.getBoundingClientRect(),a=r.width/r.height,o=1.13*Math.max(1,1.65/a),n=((e-r.left)/r.width-.5)*a*o,i=(.5-(t-r.top)/r.height)*o,s=Math.hypot(5.65,7.2),c=-5.65/s,d=-7.2/s,u=(.15-5.8)/Math.min(-.1,1.55*c-d*i);b([Math.max(-2.5,Math.min(2.5,n*u)),Math.max(-2,Math.min(2,7.2+(1.55*d+c*i)*u))])};return(0,t.jsxs)("div",{className:n.default.root,"data-playground":"ferro","data-magnet":x.join(","),"data-strength":d,"data-pair":p,children:[(0,t.jsxs)("div",{className:n.default.surface,children:[(0,t.jsx)("canvas",{ref:l,role:"img",tabIndex:0,"aria-label":"Magnetic sculpture. Drag the magnet to raise spikes; arrow keys move the field.",onPointerDown:t=>{e||_||(c.current=t.pointerId,t.currentTarget.setPointerCapture(t.pointerId),y(t.clientX,t.clientY))},onPointerMove:t=>{c.current!==t.pointerId||e||y(t.clientX,t.clientY)},onPointerUp:()=>{c.current=null},onPointerCancel:()=>{c.current=null},onLostPointerCapture:()=>{c.current=null},onKeyDown:t=>{!e&&!_&&t.key.startsWith("Arrow")&&(t.preventDefault(),b(([e,r])=>[Math.max(-2.5,Math.min(2.5,e+("ArrowRight"===t.key?.25:"ArrowLeft"===t.key?-.25:0))),Math.max(-2,Math.min(2,r+("ArrowDown"===t.key?.25:"ArrowUp"===t.key?-.25:0)))]))}}),(0,t.jsxs)("div",{className:n.default.header,children:[(0,t.jsx)("span",{children:"MATTER / UNDER THE INFLUENCE"}),(0,t.jsxs)("span",{children:["FIELD ",d.toFixed(2)]})]}),(0,t.jsxs)("div",{className:n.default.title,children:["Soft.",(0,t.jsx)("br",{}),(0,t.jsx)("em",{children:"Until it isn’t."})]}),(0,t.jsxs)("span",{className:n.default.hint,children:["DRAG AN INVISIBLE MAGNET",(0,t.jsx)("br",{}),"MAKE THE SURFACE STAND UP"]}),_&&(0,t.jsxs)("div",{className:n.default.failure,role:"status",children:[(0,t.jsx)("strong",{children:"This material needs WebGL."}),(0,t.jsx)("p",{children:"Reset to try again, or try Pattern reactor."})]})]}),(0,t.jsxs)("fieldset",{className:n.default.controls,disabled:e||_,children:[(0,t.jsx)("legend",{className:n.default.sr,children:"Magnetic material controls"}),(0,t.jsxs)("label",{children:["Field strength",(0,t.jsx)("input",{type:"range",min:"0",max:"2",step:".01",value:d,onChange:e=>u(+e.target.value)})]}),(0,t.jsxs)("label",{children:["Spike spacing",(0,t.jsx)("input",{type:"range",min:"0",max:"1",step:".01",value:h,onChange:e=>f(+e.target.value)})]}),(0,t.jsx)("button",{type:"button","aria-pressed":1===p,onClick:()=>g(1-p),children:p?"Two magnets":"Add second magnet"}),(0,t.jsxs)("label",{children:["Material",(0,t.jsxs)("select",{value:m,onChange:e=>v(+e.target.value),children:[(0,t.jsx)("option",{value:"0",children:"Obsidian"}),(0,t.jsx)("option",{value:"1",children:"Liquid brass"})]})]}),(0,t.jsx)("button",{type:"button",onClick:()=>b([0,0]),children:"Center magnet"}),(0,t.jsxs)("p",{children:["A magnetic material study: fields reshape a reflective height surface. ",i?"Direct mode: no idle motion.":"Slide the field strength to zero and let it settle."]})]})]})}],53939)},36305,function(e){e.n(e.i(53939))},4046,e=>{"use strict";e.s(["createShaderSurface",0,function(e,t,r,a){let o=e.getContext("webgl",{alpha:!1,antialias:!1,preserveDrawingBuffer:!0});if(!o)return a(),null;let n=[],i=null,l=null;try{if(!(i=o.createProgram()))throw Error("Shader program unavailable");for(let[e,r]of[[o.VERTEX_SHADER,"attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}"],[o.FRAGMENT_SHADER,t]]){let t=o.createShader(e);if(!t)throw Error("Shader unavailable");if(n.push(t),o.shaderSource(t,r),o.compileShader(t),!o.getShaderParameter(t,o.COMPILE_STATUS))throw Error(o.getShaderInfoLog(t)||"Shader compilation failed");o.attachShader(i,t)}if(o.linkProgram(i),!o.getProgramParameter(i,o.LINK_STATUS))throw Error("Shader link failed");o.useProgram(i),l=o.createBuffer(),o.bindBuffer(o.ARRAY_BUFFER,l),o.bufferData(o.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),o.STATIC_DRAW);let e=o.getAttribLocation(i,"position");o.enableVertexAttribArray(e),o.vertexAttribPointer(e,2,o.FLOAT,!1,0,0)}catch(t){return e.dataset.rendererError=t instanceof Error?t.message:"Renderer unavailable",o.deleteProgram(i),o.deleteBuffer(l),n.forEach(e=>o.deleteShader(e)),a(),null}let s=Object.fromEntries(["resolution","time",...Object.keys(r().values)].map(e=>[e,o.getUniformLocation(i,e)])),c=!1,d=!0,u=0,h=0,f=0,m=0,v=()=>{c||o.isContextLost()||(o.uniform2f(s.resolution,e.width,e.height),o.uniform1f(s.time,f),Object.entries(r().values).forEach(([e,t])=>{Array.isArray(t)?o.uniform2f(s[e],t[0],t[1]):o.uniform1f(s[e],t)}),o.drawArrays(o.TRIANGLES,0,6),e.dataset.frame=String(++m),e.dataset.time=f.toFixed(3))},p=e=>{c||((!h||e-h>=33)&&(f+=h?Math.min((e-h)/1e3,.06):0,h=e,v()),u=requestAnimationFrame(p))},g=()=>{cancelAnimationFrame(u),h=0,c||o.isContextLost()||!d||document.hidden||r().paused||r().reducedMotion||(u=requestAnimationFrame(p))},x=()=>{let t=e.getBoundingClientRect(),r=Math.min(devicePixelRatio,1.5,1400/Math.max(1,t.width));e.width=Math.max(1,Math.round(t.width*r)),e.height=Math.max(1,Math.round(t.height*r)),o.viewport(0,0,e.width,e.height),v()},b=new ResizeObserver(x);b.observe(e);let _=new IntersectionObserver(e=>{d=e[0].isIntersecting,g()});_.observe(e);let A=e=>{e.preventDefault(),cancelAnimationFrame(u),a()};return e.addEventListener("webglcontextlost",A),document.addEventListener("visibilitychange",g),x(),g(),{paint:v,sync:g,destroy:()=>{c=!0,cancelAnimationFrame(u),b.disconnect(),_.disconnect(),e.removeEventListener("webglcontextlost",A),document.removeEventListener("visibilitychange",g),o.deleteProgram(i),o.deleteBuffer(l),n.forEach(e=>o.deleteShader(e))}}}])}]);