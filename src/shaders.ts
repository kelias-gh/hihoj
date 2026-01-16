export const quadVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const paintFrag = `
uniform sampler2D uTexture;
uniform vec2 uBrushPos;
uniform vec2 uPrevBrushPos;
uniform vec3 uBrushColor;
uniform float uBrushSize;
uniform vec2 uResolution;

varying vec2 vUv;

float distToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec4 current = texture2D(uTexture, vUv);
  vec2 pixel = vUv * uResolution;
  float dist = distToSegment(pixel, uPrevBrushPos, uBrushPos);
  gl_FragColor = dist < uBrushSize ? vec4(uBrushColor, 1.0) : current;
}
`;

export const borderDetectFrag = `
varying vec2 vUv;
uniform sampler2D u_lookUpTex;
uniform vec2 u_pixelSize;  // precomputed 1.0/resolution on CPU

void main() {
  vec3 centerColor = texture2D(u_lookUpTex, vUv).rgb;

  // Sample 4 neighbors - offset coordinates computed once
  vec3 leftColor = texture2D(u_lookUpTex, vUv + vec2(-u_pixelSize.x, 0.0)).rgb;
  vec3 rightColor = texture2D(u_lookUpTex, vUv + vec2(u_pixelSize.x, 0.0)).rgb;
  vec3 upColor = texture2D(u_lookUpTex, vUv + vec2(0.0, u_pixelSize.y)).rgb;
  vec3 downColor = texture2D(u_lookUpTex, vUv + vec2(0.0, -u_pixelSize.y)).rgb;

  // Use dot product for fast color comparison (avoids branch-heavy any/notEqual)
  vec3 diffL = leftColor - centerColor;
  vec3 diffR = rightColor - centerColor;
  vec3 diffU = upColor - centerColor;
  vec3 diffD = downColor - centerColor;

  float borderTest = dot(diffL, diffL) + dot(diffR, diffR) + dot(diffU, diffU) + dot(diffD, diffD);

  gl_FragColor = borderTest > 0.0001 ? vec4(vUv, 0.0, 1.0) : vec4(-1.0, -1.0, 0.0, 1.0);
}
`;

export const jfaFrag = `
varying vec2 vUv;
uniform sampler2D u_inputTexture;
uniform vec2 u_stepSize;  // precomputed vec2(step/resolution.x, step/resolution.y) on CPU

void main() {
  vec2 currentSeedPos = texture2D(u_inputTexture, vUv).xy;

  vec2 toSeed = vUv - currentSeedPos;
  float minDistSq = (currentSeedPos.x < 0.0) ? 1e10 : dot(toSeed, toSeed);
  
  vec2 n0 = texture2D(u_inputTexture, vUv + vec2(-u_stepSize.x, -u_stepSize.y)).xy;
  vec2 n1 = texture2D(u_inputTexture, vUv + vec2(0.0, -u_stepSize.y)).xy;
  vec2 n2 = texture2D(u_inputTexture, vUv + vec2(u_stepSize.x, -u_stepSize.y)).xy;
  vec2 n3 = texture2D(u_inputTexture, vUv + vec2(-u_stepSize.x, 0.0)).xy;
  vec2 n4 = texture2D(u_inputTexture, vUv + vec2(u_stepSize.x, 0.0)).xy;
  vec2 n5 = texture2D(u_inputTexture, vUv + vec2(-u_stepSize.x, u_stepSize.y)).xy;
  vec2 n6 = texture2D(u_inputTexture, vUv + vec2(0.0, u_stepSize.y)).xy;
  vec2 n7 = texture2D(u_inputTexture, vUv + vec2(u_stepSize.x, u_stepSize.y)).xy;

  // Check each neighbor with squared distance
  #define CHECK_NEIGHBOR(n) { \
    if (n.x >= 0.0) { \
      vec2 d = vUv - n; \
      float distSq = dot(d, d); \
      if (distSq < minDistSq) { minDistSq = distSq; currentSeedPos = n; } \
    } \
  }

  CHECK_NEIGHBOR(n0)
  CHECK_NEIGHBOR(n1)
  CHECK_NEIGHBOR(n2)
  CHECK_NEIGHBOR(n3)
  CHECK_NEIGHBOR(n4)
  CHECK_NEIGHBOR(n5)
  CHECK_NEIGHBOR(n6)
  CHECK_NEIGHBOR(n7)

  #undef CHECK_NEIGHBOR

  gl_FragColor = vec4(currentSeedPos, 0.0, 1.0);
}
`;

export const distanceFieldFrag = `
varying vec2 vUv;
uniform sampler2D u_coordTexture;
uniform float maxDistance;

void main() {
  vec2 nearestSeedPos = texture2D(u_coordTexture, vUv).xy;

  float dist = distance(vUv, nearestSeedPos);
  float normalized_dist = clamp(dist / maxDistance, 0.0, 1.0);
  gl_FragColor = vec4(normalized_dist, 0.0, 0.0, 1.0);
}
`;

export const finalDisplayFrag = `
varying vec2 vUv;
uniform sampler2D u_distanceField;
uniform sampler2D u_colorMap;
uniform vec2 u_pixelSize; 
uniform vec3 u_borderColor;

void main() {
  vec2 halfPixel = u_pixelSize * 0.5;

  float dist = texture2D(u_distanceField, vUv + vec2(-halfPixel.x, -halfPixel.y)).r;
  dist += texture2D(u_distanceField, vUv + vec2(halfPixel.x, -halfPixel.y)).r;
  dist += texture2D(u_distanceField, vUv + vec2(-halfPixel.x, halfPixel.y)).r;
  dist += texture2D(u_distanceField, vUv + vec2(halfPixel.x, halfPixel.y)).r;
  dist *= 0.1; 

  vec4 color = texture2D(u_colorMap, vUv);

  float borderMask = smoothstep(0.05, 0.045, dist);

  gl_FragColor = vec4(
    mix(
      color.rgb, 
      u_borderColor,
       borderMask),
    color.a);
}
`;
