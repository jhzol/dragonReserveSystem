/** @resolution */
uniform vec2 u_resolution;

/** @backdrop */
uniform sampler2D u_backdrop;

/**
 * Fade end point (0.0 = bottom, 1.0 = top of container)
 * @label Fade End Point
 * @default 0.95
 * @range 0.1, 1.0
 */
uniform float u_fadeEnd;

/**
 * Maximum blur radius at the bottom
 * @label Max Blur Radius
 * @default 20.0
 * @range 0.0, 40.0
 */
uniform float u_maxBlur;

/**
 * Black tint opacity at the bottom
 * @label Bottom Black Opacity
 * @default 0.7
 * @range 0.0, 1.0
 */
uniform float u_blackOpacity;

/**
 * Gradient curve exponent (1.0 = linear, 1.4 = smooth ease-out)
 * @label Curve Exponent
 * @default 1.3
 * @range 0.5, 3.0
 */
uniform float u_curve;

const int BLUR_TAPS = 24;

void main() {
  vec2 invRes = 1.0 / u_resolution;
  vec2 uv = gl_FragCoord.xy * invRes;

  // uv.y: 0.0 at bottom, 1.0 at top
  float end = clamp(u_fadeEnd, 0.05, 1.0);
  float progress = clamp(uv.y / end, 0.0, 1.0);

  // Smooth factor: 1.0 at bottom, 0.0 at end point
  float rawT = 1.0 - progress;
  float factor = pow(rawT, max(u_curve, 0.2));

  if (factor <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float r = factor * u_maxBlur;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < BLUR_TAPS; i++) {
    float fi = float(i) + 0.5;
    float a = fi * 2.39996323;
    float rad = sqrt(fi / float(BLUR_TAPS)) * r;
    vec2 offset = vec2(cos(a), sin(a)) * rad * invRes;
    sum += texture2D(u_backdrop, clamp(uv + offset, vec2(0.001), vec2(0.999))).rgb;
  }
  vec3 blurred = sum / float(BLUR_TAPS);

  // Blend blurred background with black tint
  vec3 col = mix(blurred, vec3(0.0), u_blackOpacity);

  // Fade out both blur and black tint towards the top
  gl_FragColor = vec4(col, factor);
}
