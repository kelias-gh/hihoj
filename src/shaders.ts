export const quadVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const paintFrag = `
uniform sampler2D uTexture;
uniform vec2 uBrushPos;
uniform vec2 uPrevBrushPos;
uniform vec3 uBrushColor;
uniform float uBrushSize;
uniform vec2 uResolution;
varying vec2 vUv;

float distToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec4 current = texture2D(uTexture, vUv);
  float dist = distToSegment(vUv * uResolution, uPrevBrushPos, uBrushPos);
  gl_FragColor = dist < uBrushSize ? vec4(uBrushColor, 1.0) : current;
}`;

export const borderDetectFrag = `
varying vec2 vUv;
uniform sampler2D u_lookUpTex;
uniform vec2 u_pixelSize;

void main() {
  vec3 c = texture2D(u_lookUpTex, vUv).rgb;
  vec3 l = texture2D(u_lookUpTex, vUv + vec2(-u_pixelSize.x, 0.0)).rgb;
  vec3 r = texture2D(u_lookUpTex, vUv + vec2(u_pixelSize.x, 0.0)).rgb;
  vec3 u = texture2D(u_lookUpTex, vUv + vec2(0.0, u_pixelSize.y)).rgb;
  vec3 d = texture2D(u_lookUpTex, vUv + vec2(0.0, -u_pixelSize.y)).rgb;

  vec3 dl = l - c, dr = r - c, du = u - c, dd = d - c;
  float borderTest = dot(dl, dl) + dot(dr, dr) + dot(du, du) + dot(dd, dd);
  gl_FragColor = borderTest > 0.0001 ? vec4(vUv, 0.0, 1.0) : vec4(-1.0, -1.0, 0.0, 1.0);
}`;

export const jfaFrag = `
varying vec2 vUv;
uniform sampler2D u_inputTexture;
uniform vec2 u_stepSize;

void main() {
  vec2 seed = texture2D(u_inputTexture, vUv).xy;
  vec2 toSeed = vUv - seed;
  float minDistSq = seed.x < 0.0 ? 1e10 : dot(toSeed, toSeed);

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      vec2 n = texture2D(u_inputTexture, vUv + vec2(float(dx), float(dy)) * u_stepSize).xy;
      if (n.x >= 0.0) {
        vec2 d = vUv - n;
        float distSq = dot(d, d);
        if (distSq < minDistSq) { minDistSq = distSq; seed = n; }
      }
    }
  }
  gl_FragColor = vec4(seed, 0.0, 1.0);
}`;

export const distanceFieldFrag = `
varying vec2 vUv;
uniform sampler2D u_coordTexture;
uniform float maxDistance;

void main() {
  vec2 nearest = texture2D(u_coordTexture, vUv).xy;
  float dist = clamp(distance(vUv, nearest) / maxDistance, 0.0, 1.0);
  gl_FragColor = vec4(dist, 0.0, 0.0, 1.0);
}`;

export const finalDisplayFrag = `
varying vec2 vUv;
uniform sampler2D u_distanceField;
uniform sampler2D u_colorMap;
uniform vec2 u_pixelSize;
uniform vec3 u_borderColor;

void main() {
  vec2 hp = u_pixelSize * 0.5;
  float dist = texture2D(u_distanceField, vUv + vec2(-hp.x, -hp.y)).r;
  dist += texture2D(u_distanceField, vUv + vec2(hp.x, -hp.y)).r;
  dist += texture2D(u_distanceField, vUv + vec2(-hp.x, hp.y)).r;
  dist += texture2D(u_distanceField, vUv + vec2(hp.x, hp.y)).r;
  dist *= 0.1;

  vec4 color = texture2D(u_colorMap, vUv);
  float borderMask = smoothstep(0.05, 0.045, dist);
  gl_FragColor = vec4(mix(color.rgb, u_borderColor, borderMask), color.a);
}`;

export const copyFrag = `
uniform sampler2D uTexture;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uTexture, vUv); }`;

export const referenceOverlayFrag = `
uniform sampler2D uReference;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 ref = texture2D(uReference, vUv);
  gl_FragColor = vec4(ref.rgb, ref.a * uOpacity);
}`;
