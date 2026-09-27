(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,15972,e=>{e.v({group:"morph-module__4Yv88q__group",help:"morph-module__4Yv88q__help",root:"morph-module__4Yv88q__root",signature:"morph-module__4Yv88q__signature",srOnly:"morph-module__4Yv88q__srOnly",surface:"morph-module__4Yv88q__surface",toolbar:"morph-module__4Yv88q__toolbar",topline:"morph-module__4Yv88q__topline",unavailable:"morph-module__4Yv88q__unavailable"})},82583,e=>{"use strict";var t=e.i(43476),r=e.i(71645);let o=`
attribute vec2 position;
void main(){ gl_Position=vec4(position,0.,1.); }
`,n=`
precision highp float;
uniform vec2 resolution;
uniform vec2 rotation;
uniform float form;
uniform float twist;
uniform float finish;
mat2 turn(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float smoothUnion(float a,float b,float k){float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25;}
float torus(vec3 p,float r,float tube){return length(vec2(length(p.xy)-r,p.z))-tube;}
float sculpture(vec3 p){
  p.xz=turn(rotation.x)*p.xz;
  p.yz=turn(rotation.y)*p.yz;
  p.xz=turn(p.y*twist)*p.xz;
  float ring=torus(p,.91,.29);
  vec3 q=p; q.yz=turn(1.5708)*q.yz;
  float link=smoothUnion(torus(p,.75,.23),torus(q,.75,.23),.2);
  q=p; q.xy=turn(.48)*q.xy;
  vec3 b=abs(q)-vec3(.67);
  float block=length(max(b,0.))+min(max(b.x,max(b.y,b.z)),0.)-.19;
  float hollow=max(block,-(length(p)-.77));
  return form<1.?mix(ring,link,form):mix(link,hollow,form-1.);
}
vec3 normalAt(vec3 p){vec2 e=vec2(.0015,-.0015);return normalize(e.xyy*sculpture(p+e.xyy)+e.yyx*sculpture(p+e.yyx)+e.yxy*sculpture(p+e.yxy)+e.xxx*sculpture(p+e.xxx));}
vec3 studio(vec3 r){
  vec3 low=vec3(.018,.027,.04),high=vec3(.46,.57,.65);
  vec3 c=mix(low,high,smoothstep(-.6,.9,r.y));
  float panel=smoothstep(.15,.42,r.y)*(1.-smoothstep(.75,.99,r.y))*smoothstep(-1.,-.7,r.x)*(1.-smoothstep(.02,.34,r.x));
  float strip=exp(-pow((r.x-.78)*15.,2.))*smoothstep(-.4,.2,r.y);
  c+=panel*vec3(1.75,1.65,1.5)+strip*vec3(.7,1.1,1.6);
  c+=vec3(.3,.11,.035)*pow(max(0.,dot(r,normalize(vec3(-1.,-.3,0.)))),8.);
  return c;
}
void main(){
  vec2 uv=(gl_FragCoord.xy*2.-resolution)/min(resolution.x,resolution.y);
  vec3 origin=vec3(0.,0.,4.8),ray=normalize(vec3(uv,-3.35));
  vec3 color=mix(vec3(.69,.76,.80),vec3(.88,.89,.84),smoothstep(-1.4,1.7,uv.y));
  float shadow=exp(-pow(uv.x/1.05,2.)-pow((uv.y+1.02)/.13,2.));
  color*=1.-shadow*.22;
  float travel=0.; bool hit=false;
  for(int i=0;i<110;i++){
    vec3 p=origin+ray*travel;float distance=sculpture(p);
    if(distance<.0012){hit=true;break;}
    travel+=distance*(.7/(1.+twist*.25));
    if(travel>8.)break;
  }
  if(hit){
    vec3 p=origin+ray*travel,n=normalAt(p),ref=reflect(ray,n);
    float diffuse=max(0.,dot(n,normalize(vec3(-.6,1.,1.5))));
    float fresnel=pow(1.-max(0.,dot(n,-ray)),3.);
    float spec=pow(max(0.,dot(ref,normalize(vec3(-.6,1.,1.5)))),35.);
    float ao=0.,weight=1.;
    for(int j=1;j<=4;j++){float h=.06*float(j);ao+=(h-sculpture(p+n*h))*weight;weight*=.6;}
    ao=clamp(1.-ao*3.,.2,1.);
    float shadow=1.,t=.03;vec3 light=normalize(vec3(-.6,1.,1.5));
    for(int j=0;j<12;j++){float h=sculpture(p+n*.01+light*t);shadow=min(shadow,10.*h/t);t+=clamp(h,.03,.18);}
    diffuse*=clamp(shadow,.2,1.);
    vec3 chrome=studio(ref)*(.76+fresnel*.22);
    float grain=fract(sin(dot(p,vec3(171.1,271.7,96.3)))*43758.5453);
    vec3 clay=vec3(.68,.22,.095)*(.25+diffuse*.75)*( .97+grain*.06)+spec*.12+fresnel*.07;
    vec3 iridescent=.6+.26*cos(vec3(.2,2.3,4.4)+(1.-dot(n,-ray))*8.5+n.y*1.4);
    vec3 pearl=iridescent*(.4+diffuse*.38)+studio(ref)*(.25+fresnel*.3)+spec*.26;
    color=(finish<.5?chrome:finish<1.5?pearl:clay)*(.3+.7*ao);
    color=1.-exp(-max(color,0.)*1.25);color=pow(color,vec3(.82));
  }
  color*=1.-.06*dot(uv,uv);
  gl_FragColor=vec4(color,1.);
}
`;var a=e.i(15972);e.s(["default",0,function({paused:e,reducedMotion:i}){let l=(0,r.useRef)(null),c=(0,r.useRef)(null),[s,u]=(0,r.useState)(1),[h,d]=(0,r.useState)(.4),[m,p]=(0,r.useState)(0),[f,v]=(0,r.useState)(!0),[x,y]=(0,r.useState)(!1),g=(0,r.useRef)({paused:e,reducedMotion:i,form:s,twist:h,finish:m,turning:f}),b=(0,r.useRef)(null);return(0,r.useEffect)(()=>{g.current={paused:e,reducedMotion:i,form:s,twist:h,finish:m,turning:f},(e||i)&&(b.current=null,c.current&&(c.current.velocity=[0,0])),c.current?.paint(),c.current?.sync()},[e,i,s,h,m,f]),(0,r.useEffect)(()=>{let e=l.current,t=e.getContext("webgl",{alpha:!1,antialias:!1,preserveDrawingBuffer:!0}),r=!1,a=0,i=!0,s=0,u=0,h=[],d=null,m=null,p=()=>{r||queueMicrotask(()=>{r||y(!0)})};if(!t)return p(),()=>{r=!0};try{if(!(d=t.createProgram()))throw Error("Program unavailable");for(let[e,r]of[[t.VERTEX_SHADER,o],[t.FRAGMENT_SHADER,n]]){let o=t.createShader(e);if(!o)throw Error("Shader unavailable");if(h.push(o),t.shaderSource(o,r),t.compileShader(o),!t.getShaderParameter(o,t.COMPILE_STATUS))throw Error("Shader not supported");t.attachShader(d,o)}if(t.linkProgram(d),!t.getProgramParameter(d,t.LINK_STATUS))throw Error("Link unavailable");t.useProgram(d),m=t.createBuffer(),t.bindBuffer(t.ARRAY_BUFFER,m),t.bufferData(t.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),t.STATIC_DRAW);let e=t.getAttribLocation(d,"position");t.enableVertexAttribArray(e),t.vertexAttribPointer(e,2,t.FLOAT,!1,0,0)}catch{return p(),h.forEach(e=>t.deleteShader(e)),t.deleteProgram(d),t.deleteBuffer(m),()=>{r=!0}}let f=Object.fromEntries(["resolution","rotation","form","twist","finish"].map(e=>[e,t.getUniformLocation(d,e)])),v={rotation:[-.42,.26],velocity:[0,0],paint:()=>{r||t.isContextLost()||(t.uniform2f(f.resolution,e.width,e.height),t.uniform2f(f.rotation,...v.rotation),t.uniform1f(f.form,g.current.form),t.uniform1f(f.twist,g.current.twist),t.uniform1f(f.finish,g.current.finish),t.drawArrays(t.TRIANGLES,0,6),e.dataset.frame=String(++u),e.dataset.rotation=v.rotation.map(e=>e.toFixed(3)).join(","))},sync:()=>{cancelAnimationFrame(a),a=0,s=0,!r&&!t.isContextLost()&&i&&!document.hidden&&!g.current.paused&&!g.current.reducedMotion&&(g.current.turning||Math.hypot(...v.velocity)>.005)&&(a=requestAnimationFrame(x))}};function x(e){if(!r){if(!s||e-s>=30){let t=s?Math.min((e-s)/1e3,.05):0;s=e,b.current||(v.rotation[0]+=t*(v.velocity[0]+.16*!!g.current.turning),v.rotation[1]+=t*v.velocity[1],v.velocity=v.velocity.map(e=>e*Math.exp(-(4.5*t)))),v.paint()}a=g.current.turning||Math.hypot(...v.velocity)>.005?requestAnimationFrame(x):0}}let w=()=>{let r=e.getBoundingClientRect(),o=Math.min(devicePixelRatio,1.5,1200/r.width);e.width=Math.max(1,Math.round(r.width*o)),e.height=Math.max(1,Math.round(r.height*o)),t.viewport(0,0,e.width,e.height),v.paint()},_=new ResizeObserver(w);_.observe(e);let A=new IntersectionObserver(e=>{(i=e[0].isIntersecting)||(b.current=null),v.sync()});A.observe(e);let j=()=>{document.hidden&&(b.current=null),v.sync()},S=()=>{b.current=null},T=e=>{e.preventDefault(),cancelAnimationFrame(a),p()};return e.addEventListener("webglcontextlost",T),document.addEventListener("visibilitychange",j),window.addEventListener("blur",S),c.current=v,w(),v.sync(),()=>{r=!0,c.current=null,b.current=null,cancelAnimationFrame(a),_.disconnect(),A.disconnect(),document.removeEventListener("visibilitychange",j),e.removeEventListener("webglcontextlost",T),window.removeEventListener("blur",S),t.deleteBuffer(m),t.deleteProgram(d),h.forEach(e=>t.deleteShader(e))}},[]),(0,t.jsxs)("div",{className:a.default.root,"data-playground":"morph","data-form":s,"data-finish":m,children:[(0,t.jsxs)("div",{className:a.default.surface,children:[(0,t.jsx)("canvas",{ref:l,role:"img",tabIndex:0,"aria-label":"Three-dimensional morph sculpture. Drag to rotate; arrow keys rotate in steps. Shape and material controls follow.",onPointerDown:t=>{e||x||(t.currentTarget.setPointerCapture(t.pointerId),c.current&&(c.current.velocity=[0,0]),b.current={id:t.pointerId,x:t.clientX,y:t.clientY,time:t.timeStamp})},onPointerMove:t=>{let r=b.current,o=c.current;if(!r||r.id!==t.pointerId||e||!o)return;let n=(t.clientX-r.x)*.009,a=(t.clientY-r.y)*.009,l=Math.max(8,t.timeStamp-r.time)/1e3;o.rotation[0]+=n,o.rotation[1]+=a,o.velocity=i?[0,0]:[Math.max(-4,Math.min(4,n/l)),Math.max(-4,Math.min(4,a/l))],r.x=t.clientX,r.y=t.clientY,r.time=t.timeStamp,o.paint()},onPointerUp:e=>{c.current&&b.current&&e.timeStamp-b.current.time>100&&(c.current.velocity=[0,0]),b.current=null,c.current?.sync()},onPointerCancel:()=>{b.current=null,c.current&&(c.current.velocity=[0,0])},onLostPointerCapture:()=>{b.current&&c.current&&(c.current.velocity=[0,0]),b.current=null},onKeyDown:t=>{let r=c.current;!e&&r&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(t.key)&&(t.preventDefault(),r.rotation[+("ArrowLeft"!==t.key&&"ArrowRight"!==t.key)]+="ArrowLeft"===t.key||"ArrowUp"===t.key?-.18:.18,r.paint())}}),(0,t.jsxs)("div",{className:a.default.topline,children:[(0,t.jsx)("span",{children:"FORM STUDIES / VOL. 01"}),(0,t.jsx)("span",{children:"AN OBJECT THAT REFUSES TO STAY STILL"})]}),(0,t.jsxs)("div",{className:a.default.signature,children:[(0,t.jsxs)("div",{children:["Between",(0,t.jsx)("br",{}),(0,t.jsx)("em",{children:"one thing & another."})]}),(0,t.jsxs)("span",{children:["DRAG TO ROTATE",(0,t.jsx)("br",{}),"CHANGE WHAT IT BECOMES"]})]}),x&&(0,t.jsxs)("div",{className:a.default.unavailable,role:"status",children:[(0,t.jsx)("strong",{children:"This sculpture needs WebGL."}),(0,t.jsx)("p",{children:"Your browser could not start the renderer. Try resetting this scene or explore Sand garden, which uses a different renderer."})]})]}),(0,t.jsxs)("fieldset",{className:a.default.toolbar,disabled:x||e,children:[(0,t.jsx)("legend",{className:a.default.srOnly,children:"Sculpture controls"}),(0,t.jsx)("div",{className:a.default.group,children:["Loop","Interlock","Hollow"].map((e,r)=>(0,t.jsx)("button",{type:"button","aria-pressed":s===r,onClick:()=>u(r),children:e},e))}),(0,t.jsxs)("label",{children:["Morph",(0,t.jsx)("input",{type:"range",min:"0",max:"2",step:".01",value:s,onChange:e=>u(Number(e.target.value))})]}),(0,t.jsxs)("label",{children:["Twist",(0,t.jsx)("input",{type:"range",min:"0",max:"1.5",step:".01",value:h,onChange:e=>d(Number(e.target.value))})]}),(0,t.jsxs)("label",{children:["Finish",(0,t.jsxs)("select",{value:m,onChange:e=>p(Number(e.target.value)),children:[(0,t.jsx)("option",{value:"0",children:"Chrome"}),(0,t.jsx)("option",{value:"1",children:"Opal"}),(0,t.jsx)("option",{value:"2",children:"Terracotta"})]})]}),(0,t.jsx)("button",{type:"button",disabled:i,"aria-pressed":f&&!i,onClick:()=>v(!f),children:f&&!i?"Stop turning":"Auto turn"}),(0,t.jsx)("p",{className:a.default.help,children:i?"Direct mode: rotate and sculpt by hand. No automatic movement.":"Drag the object. Slide between shapes. The material follows every curve."})]})]})}],82583)},52097,function(e){e.n(e.i(82583))}]);