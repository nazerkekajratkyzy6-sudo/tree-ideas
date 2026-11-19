export const SWAY = /* glsl */ `
uniform float uTime;
vec3 sway(vec3 p){
  float a = 0.016 * max(0.0, p.y - 4.4);
  p.x += sin(uTime * .46 + p.y * .55 + p.z * .3) * a;
  p.z += cos(uTime * .37 + p.y * .42 + p.x * .3) * a;
  return p;
}`;

export const POINT_VS = /* glsl */ `
${SWAY}
attribute float aBirth; attribute vec3 aData; attribute float aDist;
uniform float uT, uPx, uMirror, uRise, uBreath, uGain;
varying vec3 vColor; varying float vAlpha;
void main(){
  float p = smoothstep(aBirth - .05, aBirth + 1.15, uT);
  float e = 1. - pow(1. - p, 3.);
  vec3 target = position;
  float inv = 1. - e;
  float ang = inv * (5. + aData.x * 5.);
  float s = sin(ang), c = cos(ang);
  vec3 q = target;
  float k = 1. + inv * (.25 + aData.x * .7);
  q.xz = mat2(c, -s, s, c) * (q.xz * k);
  q.y -= inv * (.5 + aData.x * 1.1) * sign(q.y + .001);
  q = sway(q);
  if (uMirror > .5) q.y = -q.y;
  vec4 mv = modelViewMatrix * vec4(q, 1.);
  gl_Position = projectionMatrix * mv;

  float twinkle = .62 + .38 * sin(uTime * (1.2 + aData.x * 3.4) + aData.x * 80.);
  float wave = pow(.5 + .5 * sin(aDist * 1.5 - uTime * 2.1), 9.) * uBreath;
  float head = smoothstep(1.3, 0., uT - aBirth) * p;
  float rise = smoothstep(.75, 0., abs(position.y - uRise)) ;
  vec3 blue = mix(vec3(.30,.66,1.), vec3(.76,.93,1.), aData.x);
  vec3 gold = vec3(1.,.70,.28);
  vColor = mix(blue, gold, aData.y) * (twinkle + wave * 1.5) + gold * (head * 3.2 + rise * 4.);
  vAlpha = uGain * p * (uMirror > .5 ? .34 * exp(-max(position.y, 0.) * .52) * step(0., position.y) : 1.);
  gl_PointSize = clamp(uPx * aData.z * (1. + head * 1.3) / -mv.z, .8, 15.);
}`;

export const POINT_FS = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - .5; float d = dot(c, c);
  if (d > .25) discard;
  gl_FragColor = vec4(vColor, vAlpha * smoothstep(.25, .02, d));
}`;

export const LINE_VS = /* glsl */ `
${SWAY}
attribute float aBirth; attribute float aDist; attribute float aAlpha;
uniform float uMirror;
varying float vBirth, vDist, vAlpha, vY;
void main(){
  vBirth = aBirth; vDist = aDist; vAlpha = aAlpha; vY = position.y;
  vec3 q = sway(position);
  if (uMirror > .5) q.y = -q.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.);
}`;

export const LINE_FS = /* glsl */ `
uniform float uT, uTime, uOpacity, uRise, uBreath, uMirror; uniform vec3 uColor;
varying float vBirth, vDist, vAlpha, vY;
void main(){
  if (uT < vBirth) discard;
  float head = smoothstep(.8, 0., uT - vBirth);
  float wave = pow(.5 + .5 * sin(vDist * 1.5 - uTime * 2.1), 10.) * uBreath;
  float rise = smoothstep(.8, 0., abs(vY - uRise));
  float m = uMirror > .5 ? .3 * exp(-max(vY, 0.) * .55) * step(0., vY) : 1.;
  gl_FragColor = vec4(uColor * (1. + wave * 2.6 + head * 3. + rise * 2.6), vAlpha * uOpacity * m);
}`;

export const FLOOR_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export const FLOOR_FS = /* glsl */ `
uniform sampler2D uMap; uniform float uRoom, uTime, uContact, uRipple, uRepeat; uniform float uBase;
varying vec2 vUv; varying vec3 vW;
void main(){
  float r = length(vW.xz);
  vec3 tex = texture2D(uMap, vUv * uRepeat).rgb;
  float fade = smoothstep(42., 7., r);
  float reveal = smoothstep(uRipple + 1.2, uRipple - 2., r);
  float wave = smoothstep(1.1, 0., abs(r - uRipple)) * step(.01, uRipple) * smoothstep(34., 4., r);
  vec3 col = tex * .62 * (.8 + .25 * sin(uTime * .6 + r * .35)) * fade * max(uRoom, reveal * uContact);
  float ring = smoothstep(.55, 0., abs(r - 1.75)) * .3 + exp(-r * r * .7) * .62;
  col += vec3(1., .69, .3) * ring * uBase;
  col += vec3(.45, .8, 1.) * wave * .75;
  gl_FragColor = vec4(col, 1.);
}`;

export const WALL_FS = /* glsl */ `
uniform sampler2D uMap; uniform float uRoom, uTime;
varying vec2 vUv;
void main(){
  vec3 t = texture2D(uMap, vUv).rgb;
  float edge = smoothstep(0., .14, vUv.y) * smoothstep(1., .72, vUv.y);
  gl_FragColor = vec4(t * uRoom * .2 * (.86 + .14 * sin(uTime * .5 + vUv.x * 30.)), edge);
}`;

export const RING_VS = /* glsl */ `
attribute float aAngle; varying float vA;
void main(){ vA = aAngle; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

export const RING_FS = /* glsl */ `
uniform float uArc, uPulse, uPulseAmp, uGlow, uAlpha;
varying float vA;
const float TAU = 6.2831853;
void main(){
  float half_ = mod(vA, TAU * .5) / (TAU * .5);
  if (half_ > uArc) discard;
  float tip = smoothstep(.06, 0., uArc - half_) * step(uArc, .999);
  float d = abs(mod(vA - uPulse + TAU * .5, TAU) - TAU * .5);
  float pulse = exp(-d * d * 7.) * uPulseAmp;
  vec3 c = vec3(1., .73, .34) * (1.15 + uGlow) + vec3(1., .94, .78) * (pulse * 4. + tip * 3.);
  gl_FragColor = vec4(c, uAlpha);
}`;

export const LEAF_VS = /* glsl */ `
${SWAY}
attribute vec3 aTint; attribute vec3 aLeaf;
uniform float uLeafAlpha;
varying vec2 vP; varying vec3 vTint; varying float vGlow, vAlpha, vFres;
void main(){
  float open = aLeaf.x;
  float u = position.y, v = position.x;
  float w = pow(sin(3.14159 * pow(u, .82)), .85) * .42;
  vec3 p = vec3(v * w * (.45 + .55 * open), u - .5, abs(v) * w * (1. - open) * .85 - .16 * sin(u * 3.14));
  vec4 world = instanceMatrix * vec4(p, 1.);
  vec3 q = sway(world.xyz);
  vec4 mv = viewMatrix * vec4(q, 1.);
  gl_Position = projectionMatrix * mv;
  vP = vec2(v, u); vTint = aTint; vGlow = aLeaf.y; vAlpha = aLeaf.z * uLeafAlpha;
  vec3 n = normalize(mat3(viewMatrix) * mat3(instanceMatrix) * vec3(0., 0., 1.));
  vFres = 1. - abs(n.z);
}`;

export const LEAF_FS = /* glsl */ `
uniform float uTime;
varying vec2 vP; varying vec3 vTint; varying float vGlow, vAlpha, vFres;
// Голографический перелив только в розово-фиолетовой гамме
vec3 holo(float t){
  t = fract(t) * 3.;
  vec3 a = vec3(1., .03, .56), b = vec3(.34, .05, 1.), c = vec3(1., .2, .82);
  if (t < 1.) return mix(a, b, smoothstep(0., 1., t));
  if (t < 2.) return mix(b, c, smoothstep(1., 2., t));
  return mix(c, a, smoothstep(2., 3., t));
}
void main(){
  float e = abs(vP.x);
  float tip = max(smoothstep(.06, .0, vP.y), smoothstep(.92, 1., vP.y));
  float outline = max(smoothstep(.88, .95, e), tip * .9);
  float phase = vP.y * .85 + vP.x * .38 + vFres * .7 + vTint.r * 3. + uTime * .16;
  vec3 c = holo(phase);
  float band = pow(.5 + .5 * sin((vP.y * 1.5 - vP.x * .7 + vTint.r * 5.) * 6.283 - uTime * 1.5), 10.);
  float rib = smoothstep(.07, .015, e);
  float sideV = smoothstep(.09, .0, abs(fract(vP.y * 6. - e * 1.9) - .5)) * (1. - rib);
  float rim = smoothstep(.66, .86, e) * (1. - outline);
  vec3 light = vec3(1., .78, 1.);
  c = mix(c, light, clamp(rib * .85 + sideV * .34 + rim * .72 + band * .62, 0., 1.));
  c = mix(c, vec3(.012, .004, .06), outline);
  c += vec3(1., .5, .95) * vGlow * .85;
  gl_FragColor = vec4(c, vAlpha * .97);
}`;

export const FX_VS = /* glsl */ `
attribute vec3 aVel; attribute vec2 aLife; attribute vec3 aCol;
uniform float uClock, uPx;
varying vec3 vC; varying float vA;
void main(){
  float age = uClock - aLife.x; float k = clamp(age / aLife.y, 0., 1.);
  vec3 p = position + aVel * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  vA = (age >= 0. && age < aLife.y) ? sin(3.14159 * pow(k, .55)) : 0.;
  vC = aCol;
  gl_PointSize = vA > 0. ? clamp(uPx * .95 * (1. - k * .55) / -mv.z, 1., 13.) : 0.;
}`;

export const FX_FS = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){ vec2 c = gl_PointCoord - .5; float d = dot(c, c); if (d > .25 || vA <= 0.) discard; gl_FragColor = vec4(vC, vA * smoothstep(.25, 0., d)); }`;

export const SWIRL_VS = /* glsl */ `
attribute vec3 aRnd;
uniform float uTime, uSparkY, uSwirl, uRiseFlow, uFlowTop, uPx;
varying float vA; varying vec3 vC;
void main(){
  vec3 p;
  if (aRnd.z < .5) {
    float life = fract(aRnd.x + uTime * .16);
    float r = (1. - life) * (1.1 + aRnd.y * 3.4);
    float a = aRnd.x * 44. + life * 13.;
    p = vec3(cos(a) * r, uSparkY + sin(a * 2.) * r * .16, sin(a) * r);
    vA = uSwirl * smoothstep(0., .2, life) * smoothstep(1., .75, life);
    vC = aRnd.y > .55 ? vec3(1., .72, .32) : vec3(.42, .78, 1.);
  } else {
    float life = fract(aRnd.x * 3. + uTime * .42);
    float y = life * uFlowTop;
    float a = aRnd.y * 6.283 + y * 3.1 + uTime * 2.2;
    float r = .5 + .35 * sin(aRnd.x * 40.) + (1. - y / max(uFlowTop, .1)) * .45;
    p = vec3(cos(a) * r, y, sin(a) * r);
    vA = uRiseFlow * smoothstep(1., .82, life);
    vC = aRnd.x > .68 ? vec3(1., .74, .34) : vec3(.5, .84, 1.);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * .5 / -mv.z, 1., 7.);
}`;

export const SWIRL_FS = /* glsl */ `
varying float vA; varying vec3 vC;
void main(){ vec2 c = gl_PointCoord - .5; float d = dot(c, c); if (d > .25) discard; gl_FragColor = vec4(vC, vA * smoothstep(.25, 0., d)); }`;
