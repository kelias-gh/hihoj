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
uniform vec2 resolution;

void main() {
  vec4 centerColor = texture2D(u_lookUpTex, vUv);

  vec2 pixelSize = 1.0 / resolution;

  vec4 leftColor = texture2D(u_lookUpTex, vUv + vec2(-pixelSize.x, 0.0));
  vec4 rightColor = texture2D(u_lookUpTex, vUv + vec2(pixelSize.x, 0.0));
  vec4 upColor = texture2D(u_lookUpTex, vUv + vec2(0.0, pixelSize.y));
  vec4 downColor = texture2D(u_lookUpTex, vUv + vec2(0.0, -pixelSize.y));

  bool isBorder = any(notEqual(leftColor.rgb, centerColor.rgb)) ||
                 any(notEqual(rightColor.rgb, centerColor.rgb)) ||
                 any(notEqual(upColor.rgb, centerColor.rgb)) ||
                 any(notEqual(downColor.rgb, centerColor.rgb));

  gl_FragColor = isBorder ? vec4(vUv, 0.0, 1.0) : vec4(-1.0, -1.0, 0.0, 1.0);
}
`;

export const jfaFrag = `
varying vec2 vUv;
uniform sampler2D u_inputTexture;
uniform vec2 resolution;
uniform float step;

void main() {
  vec2 currentSeedPos = texture2D(u_inputTexture, vUv).xy;
  float min_dist = (currentSeedPos.x < 0.0) ? 99999.0 : distance(vUv, currentSeedPos);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x) * (step / resolution.x), float(y) * (step / resolution.y));
      vec2 neighborUv = vUv + offset;

      vec2 neighborSeedPos = texture2D(u_inputTexture, neighborUv).xy;

      if (neighborSeedPos.x >= 0.0) {
        float dist_to_neighbor_seed = distance(vUv, neighborSeedPos);

        if (dist_to_neighbor_seed < min_dist) {
          min_dist = dist_to_neighbor_seed;
          currentSeedPos = neighborSeedPos;
        }
      }
    }
  }
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
uniform vec2 u_resolution;

void main() {
  vec2 pixelSize = 1.0 / u_resolution;

  float distance = texture2D(u_distanceField, vUv).r;
  distance += texture2D(u_distanceField, vUv + vec2(pixelSize.x, 0.)).r;
  distance += texture2D(u_distanceField, vUv + vec2(pixelSize.x, pixelSize.y)).r;
  distance += texture2D(u_distanceField, vUv + vec2(0., pixelSize.y)).r;
  distance += texture2D(u_distanceField, vUv + vec2(-pixelSize.x, pixelSize.y)).r;
  distance += texture2D(u_distanceField, vUv + vec2(-pixelSize.x, 0.)).r;
  distance += texture2D(u_distanceField, vUv + vec2(-pixelSize.x, -pixelSize.y)).r;
  distance += texture2D(u_distanceField, vUv + vec2(0., -pixelSize.y)).r;
  distance += texture2D(u_distanceField, vUv + vec2(pixelSize.x, -pixelSize.y)).r;
  distance /= 20.;

  vec4 color = texture2D(u_colorMap, vUv);
  vec4 innerGlowColor = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 politicalBorderColor = vec4(0.0, 0.0, 0.0, 1.0);

  vec4 politicalBorder = mix(
      color,
      politicalBorderColor,
      smoothstep(0.05, 0.045, distance)
  );

  gl_FragColor = politicalBorder;
}
`;
