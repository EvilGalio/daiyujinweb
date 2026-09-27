(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,63610,e=>{"use strict";var t=e.i(43476),r=e.i(71645);let a=`
attribute vec2 position;
varying vec2 vUv;
void main(){ vUv=position*.5+.5; gl_Position=vec4(position,0.,1.); }
`,n=`
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform float uForce;
uniform float uFinish;
uniform float uIntensity;
uniform vec4 uRipples[16];
float surfaceHeight(vec2 coord){
  vec2 aspect=vec2(uResolution.x/uResolution.y,1.);
  vec2 p=(coord-.5)*aspect*2.;
  float ripple=0.;
  for(int j=0;j<16;j++){
    vec4 r=uRipples[j];
    float age=uTime-r.z;
    if(r.w>0. && age>=0. && age<6.){
      vec2 d=(coord-r.xy)*aspect;
      float dist=length(d);
      float wave=sin(dist*32.-age*6.5)*exp(-pow(dist-age*.23,2.)*35.)*exp(-age*.9)*r.w;
      ripple+=wave*.085*uIntensity;
    }
  }
  vec2 near=(coord-uPointer)*aspect;
  float local=exp(-dot(near,near)*8.)*uForce;
  p+=near*local*.6;
  float phase=.4+uTime*.06;
  for(float i=1.;i<8.;i++){
    p.x+=.29/i*cos(i*2.8*p.y+phase+local*.7);
    p.y+=.29/i*cos(i*2.8*p.x+phase*.8-local*.4);
  }
  return sin(p.x*1.5+p.y*1.2)*.17+cos(p.y*1.8-p.x*.5)*.08+ripple-local*.12;
}
vec3 environment(vec3 ray){
  vec3 color=mix(vec3(.012,.02,.038),vec3(.42,.51,.63),smoothstep(-.65,.7,ray.y));
  float box=smoothstep(-.7,-.4,ray.x)*(1.-smoothstep(.05,.25,ray.x))*smoothstep(-.1,.3,ray.y);
  float strip=exp(-pow((ray.x-.6)*10.,2.))*smoothstep(-.6,.7,ray.y);
  float longlight=exp(-pow((ray.y+.2+ray.x*.3)*12.,2.));
  return color+vec3(1.5,1.7,1.9)*box+vec3(.8,1.1,1.5)*strip+vec3(.7,.54,.4)*longlight;
}
void main(){
  vec2 aspect=vec2(uResolution.x/uResolution.y,1.);
  vec2 e=vec2(.0025)/aspect;
  float height=surfaceHeight(vUv);
  vec3 normal=normalize(vec3((height-surfaceHeight(vUv+vec2(e.x,0.)))/.0025,(height-surfaceHeight(vUv+vec2(0.,e.y)))/.0025,1.));
  vec3 view=normalize(vec3((vUv-.5)*.32,1.));
  float fresnel=pow(1.-max(0.,dot(normal,view)),3.);
  vec3 col=environment(reflect(-view,normal))*(.78+fresnel*.22);
  vec3 tint=vec3(.82,.9,1.);
  if(uFinish>.5&&uFinish<1.5)tint=.7+.3*cos(vec3(0.,2.,4.)+(1.-dot(normal,view))*8.+height*3.);
  if(uFinish>1.5)tint=vec3(1.,.67,.3);
  col*=tint;col+=vec3(.035,.047,.06)*(height+.4);
  col=pow(1.-exp(-max(col,0.)*1.35),vec3(.8));
  col*=1.-.18*dot(vUv-.5,vUv-.5);
  gl_FragColor=vec4(col,1.);
}
`;var i=e.i(78809);e.s(["default",0,function({paused:e,reducedMotion:o,resetKey:l}){let s=(0,r.useRef)(null),u=(0,r.useRef)(null),c=(0,r.useRef)({paused:e,reducedMotion:o,finish:0,intensity:1}),d=(0,r.useRef)({x:.5,y:.5,down:!1}),[p,m]=(0,r.useState)(0),[h,f]=(0,r.useState)(1),[v,y]=(0,r.useState)(!1),[g,_]=(0,r.useState)(0);function x(e,t){let r=e.currentTarget.getBoundingClientRect(),a=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),n=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));d.current={x:a,y:n,down:t},u.current?.point(a,n,t)}function w(){u.current?.pulse(d.current.x,d.current.y),_(e=>e+1)}return(0,r.useEffect)(()=>{c.current={paused:e,reducedMotion:o,finish:p,intensity:h},e&&(d.current.down=!1),u.current?.refresh()},[e,o,p,h]),(0,r.useEffect)(()=>{u.current?.reset()},[l]),(0,r.useEffect)(()=>{let e=s.current;if(!e)return;let t=e.getContext("webgl",{alpha:!1,antialias:!1,preserveDrawingBuffer:!0,powerPreference:"low-power"});if(!t){let e=requestAnimationFrame(()=>y(!0));return()=>cancelAnimationFrame(e)}let r=(e,r)=>{let a=t.createShader(e);return(t.shaderSource(a,r),t.compileShader(a),t.getShaderParameter(a,t.COMPILE_STATUS))?a:(t.deleteShader(a),null)},i=r(t.VERTEX_SHADER,a),o=r(t.FRAGMENT_SHADER,n),l=t.createProgram();if(!i||!o||!l){i&&t.deleteShader(i),o&&t.deleteShader(o),l&&t.deleteProgram(l);let e=requestAnimationFrame(()=>y(!0));return()=>cancelAnimationFrame(e)}if(t.attachShader(l,i),t.attachShader(l,o),t.linkProgram(l),!t.getProgramParameter(l,t.LINK_STATUS)){t.deleteProgram(l),t.deleteShader(i),t.deleteShader(o);let e=requestAnimationFrame(()=>y(!0));return()=>cancelAnimationFrame(e)}t.useProgram(l);let p=t.createBuffer();t.bindBuffer(t.ARRAY_BUFFER,p),t.bufferData(t.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),t.STATIC_DRAW);let m=t.getAttribLocation(l,"position");t.enableVertexAttribArray(m),t.vertexAttribPointer(m,2,t.FLOAT,!1,0,0);let h=Object.fromEntries(["uResolution","uPointer","uTime","uForce","uFinish","uIntensity","uRipples[0]"].map(e=>[e,t.getUniformLocation(l,e)])),f=new Float32Array(64),v=0,g=0,_=0,x=!0,w=0,b=0,A=0,C={x:.5,y:.5},R={x:.5,y:.5},F=()=>{t.uniform2f(h.uResolution,e.width,e.height),t.uniform2f(h.uPointer,C.x,C.y),t.uniform1f(h.uTime,g),t.uniform1f(h.uForce,b),t.uniform1f(h.uFinish,c.current.finish),t.uniform1f(h.uIntensity,c.current.intensity),t.uniform4fv(h["uRipples[0]"],f),t.drawArrays(t.TRIANGLES,0,6),e.dataset.frame=String(Math.round(1e3*g))},S=()=>!c.current.paused&&!c.current.reducedMotion&&x&&!document.hidden,T=e=>{if(v=0,!S()){_=0;return}let t=_?Math.min((e-_)/1e3,.04):.016;_=e,g+=t;let r=1-Math.exp(-(12*t));C.x+=(R.x-C.x)*r,C.y+=(R.y-C.y)*r,b*=Math.exp(-(2.2*t)),A-=t,F(),A>0||b>.005?v=requestAnimationFrame(T):_=0},M=()=>{!v&&S()&&(v=requestAnimationFrame(T))},P=()=>{S()?M():(cancelAnimationFrame(v),v=0,_=0),F()},E=(t,r,a=1)=>{c.current.paused||(f.set([t,1-r,g-.65*!!c.current.reducedMotion,a],4*w),w=(w+1)%16,A=6,b=Math.min(1.6,b+.25),e.dataset.impulses=String(Number(e.dataset.impulses??0)+1),F(),M())};u.current={pulse:E,point(e,t,r){if(c.current.paused)return;let a=Math.hypot(e-R.x,1-t-R.y);R={x:e,y:1-t},b=Math.min(1.5,b+6*a),A=Math.max(A,1.5),c.current.reducedMotion&&(C={...R}),r&&a>.007&&E(e,t,.45),F(),M()},refresh:P,reset(){f.fill(0),C=R={x:.5,y:.5},g=b=A=0,e.dataset.impulses="0",F()}};let j=new ResizeObserver(([r])=>{let a=Math.min(devicePixelRatio||1,1.5);e.width=Math.max(1,Math.round(r.contentRect.width*a)),e.height=Math.max(1,Math.round(r.contentRect.height*a)),t.viewport(0,0,e.width,e.height),F()}),I=new IntersectionObserver(([e])=>{x=e.isIntersecting,P()},{threshold:.05}),L=()=>{d.current.down=!1,P()},U=()=>{d.current.down=!1};j.observe(e),I.observe(e),document.addEventListener("visibilitychange",L),window.addEventListener("blur",U);let Q=e=>{e.preventDefault(),cancelAnimationFrame(v),y(!0)};return e.addEventListener("webglcontextlost",Q),()=>{u.current=null,cancelAnimationFrame(v),j.disconnect(),I.disconnect(),document.removeEventListener("visibilitychange",L),window.removeEventListener("blur",U),e.removeEventListener("webglcontextlost",Q),t.deleteBuffer(p),t.deleteProgram(l),t.deleteShader(i),t.deleteShader(o)}},[]),(0,t.jsxs)("div",{className:i.default.liquid,"data-playground":"liquid",children:[(0,t.jsxs)("div",{className:i.default.surface,children:[(0,t.jsx)("canvas",{ref:s,className:i.default.liquidCanvas,tabIndex:0,role:"img","aria-label":"Interactive liquid metal. Drag to stir, tap to make ripples. Arrow keys move the contact point; Space makes a ripple.","aria-describedby":"liquid-help",onPointerDown:t=>{e||(t.currentTarget.setPointerCapture(t.pointerId),x(t,!0),w())},onPointerMove:e=>{("touch"!==e.pointerType||d.current.down)&&x(e,d.current.down)},onPointerUp:e=>{d.current.down=!1,e.currentTarget.hasPointerCapture(e.pointerId)&&e.currentTarget.releasePointerCapture(e.pointerId)},onPointerCancel:()=>{d.current.down=!1},onLostPointerCapture:()=>{d.current.down=!1},onKeyDown:t=>{if(!e){if(" "===t.key||"Enter"===t.key)t.preventDefault(),w();else if(t.key.startsWith("Arrow")){t.preventDefault();let e=d.current;e.x=Math.max(.05,Math.min(.95,e.x+("ArrowRight"===t.key?.07:"ArrowLeft"===t.key?-.07:0))),e.y=Math.max(.05,Math.min(.95,e.y+("ArrowDown"===t.key?.07:"ArrowUp"===t.key?-.07:0))),u.current?.point(e.x,e.y,!0)}}}}),(0,t.jsxs)("div",{className:i.default.surfaceTop,"aria-hidden":"true",children:[(0,t.jsxs)("span",{children:["LIQUID / ",["CHROME","IRIDESCENT","GOLD"][p]]}),(0,t.jsx)("span",{children:"MAKE YOUR MARK ↙"})]}),(0,t.jsxs)("div",{className:i.default.surfaceHint,id:"liquid-help",children:[(0,t.jsx)("span",{children:"Touch the surface."}),(0,t.jsx)("small",{children:"Drag to stir. Tap to ripple. Every gesture leaves a wake."})]}),v&&(0,t.jsxs)("div",{className:i.default.unavailable,role:"status",children:[(0,t.jsx)("strong",{children:"This material needs WebGL."}),(0,t.jsx)("p",{children:"Your browser cannot render it here. The Gravity and Elastic type experiments are available without WebGL."})]})]}),(0,t.jsxs)("div",{className:i.default.toolbar,children:[(0,t.jsx)("div",{className:i.default.choices,"aria-label":"Material finish",children:["Chrome","Iridescent","Gold"].map((e,r)=>(0,t.jsx)("button",{type:"button","aria-pressed":p===r,onClick:()=>m(r),children:e},e))}),(0,t.jsxs)("label",{className:i.default.slider,children:["Ripple strength",(0,t.jsx)("input",{type:"range",min:".4",max:"2",step:".1",value:h,onChange:e=>f(Number(e.target.value))})]}),(0,t.jsx)("button",{type:"button",onClick:w,disabled:e||v,children:"Drop a ripple"}),(0,t.jsxs)("output",{className:i.default.counter,"aria-live":"polite",children:[g," drops"]})]})]})}],63610)},31949,function(e){e.n(e.i(63610))},78809,e=>{e.v({choices:"playgrounds-module__8C49Qa__choices",counter:"playgrounds-module__8C49Qa__counter",elastic:"playgrounds-module__8C49Qa__elastic",keyHint:"playgrounds-module__8C49Qa__keyHint",liquid:"playgrounds-module__8C49Qa__liquid",liquidCanvas:"playgrounds-module__8C49Qa__liquidCanvas",slider:"playgrounds-module__8C49Qa__slider",surface:"playgrounds-module__8C49Qa__surface",surfaceHint:"playgrounds-module__8C49Qa__surfaceHint",surfaceTop:"playgrounds-module__8C49Qa__surfaceTop",toolbar:"playgrounds-module__8C49Qa__toolbar",typeCanvas:"playgrounds-module__8C49Qa__typeCanvas",typeFoot:"playgrounds-module__8C49Qa__typeFoot",typeLabel:"playgrounds-module__8C49Qa__typeLabel",typeSurface:"playgrounds-module__8C49Qa__typeSurface",unavailable:"playgrounds-module__8C49Qa__unavailable",wordForm:"playgrounds-module__8C49Qa__wordForm"})}]);