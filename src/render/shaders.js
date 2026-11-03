export const POST_VERTEX_SHADER = `
  attribute vec2 aPosition;
  varying vec2 vScreenUv;
  void main() {
    vScreenUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

// Resolve a genuinely higher-resolution framebuffer into the canvas. Model
// textures are still fetched with NEAREST in the scene pass; only the finished
// screen image is averaged here.
export const SSAA_RESOLVE_FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 vScreenUv;
  uniform sampler2D uScreenTexture;
  uniform vec2 uResolution;
  void main() {
    vec2 offset = 0.35 / uResolution;
    vec4 a = texture2D(uScreenTexture, vScreenUv + vec2(-offset.x, -offset.y));
    vec4 b = texture2D(uScreenTexture, vScreenUv + vec2( offset.x, -offset.y));
    vec4 c = texture2D(uScreenTexture, vScreenUv + vec2(-offset.x,  offset.y));
    vec4 d = texture2D(uScreenTexture, vScreenUv + vec2( offset.x,  offset.y));
    float alpha = (a.a + b.a + c.a + d.a) * 0.25;
    vec3 color = (a.rgb * a.a + b.rgb * b.a + c.rgb * c.a + d.rgb * d.a) * 0.25;
    gl_FragColor = vec4(alpha > 0.0001 ? color / alpha : vec3(0.0), alpha);
  }
`;

export const COPY_FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 vScreenUv;
  uniform sampler2D uScreenTexture;
  void main() {
    gl_FragColor = texture2D(uScreenTexture, vScreenUv);
  }
`;

export const LOCKED_COMPOSITE_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vScreenUv;
  uniform sampler2D uScreenTexture;
  uniform vec2 uOutputResolution;
  uniform vec2 uPointer;
  uniform float uHoverRadius;
  uniform float uBaseOpacity;
  uniform float uHoverOpacity;
  uniform float uHoverStrength;
  uniform int uHoverEnabled;
  void main() {
    vec4 color = texture2D(uScreenTexture, vScreenUv);
    if (color.a <= 0.001) discard;
    float opacity = uBaseOpacity;
    if (uHoverEnabled == 1) {
      float radial = smoothstep(0.0, max(1.0, uHoverRadius), distance(gl_FragCoord.xy, uPointer));
      opacity = mix(uBaseOpacity, mix(uHoverOpacity, uBaseOpacity, radial), uHoverStrength);
    }
    color.a *= opacity;
    if (color.a <= 0.001) discard;
    gl_FragColor = color;
  }
`;

export const VERTEX_SHADER = `
  precision highp int;
  attribute vec3 aPosition;
  attribute vec4 aColor;
  attribute vec3 aNormal;
  attribute vec2 aUv;
  uniform mat4 uViewProjection;
  uniform mat4 uModelTransform;
  uniform vec3 uLight0Direction;
  uniform vec3 uLight1Direction;
  uniform int uPreviewShade;
  uniform int uRenderMode;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vSelected;
  varying float vFragDepth;
  void main() {
    gl_Position = uViewProjection * uModelTransform * vec4(aPosition, 1.0);
    vFragDepth = 1.0 + gl_Position.w;
    float normalLength = length(aNormal);
    vec3 transformedNormal = normalLength > 0.1
      ? normalize((uModelTransform * vec4(aNormal, 0.0)).xyz)
      : vec3(0.0);
    float diffuse = 1.0;
    if (uPreviewShade == 1 && normalLength > 0.1) {
      float light0 = max(0.0, dot(uLight0Direction, transformedNormal));
      float light1 = max(0.0, dot(uLight1Direction, transformedNormal));
      // Exact vanilla minecraft_mix_light constants: ambient 0.4 and
      // equal 0.6-power contribution from both directional lights.
      diffuse = min(1.0, (light0 + light1) * 0.6 + 0.4);
    }
    // Textured faces keep source chroma; untextured faces retain the cube's
    // solid-mode display colour instead of falling back to white.
    vSelected = step(1.5, aColor.a);
    vColor = uRenderMode == 4 && normalLength > 0.1
      ? vec4(transformedNormal * 0.5 + 0.5, min(aColor.a, 1.0))
      : uRenderMode == 2 && aUv.x > -999999.0
        ? vec4(vec3(diffuse), min(aColor.a, 1.0))
        : vec4(aColor.rgb * diffuse, min(aColor.a, 1.0));
    vUv = aUv;
  }
`;
export const FRAGMENT_SHADER = `
  precision highp float;
  precision highp int;
  varying vec4 vColor;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform int uPaintPixelGrid;
  uniform vec2 uPaintGridSize;
  uniform sampler2D uSelectionMask;
  uniform int uSelectionActive;
  uniform vec2 uSelectionTexel;
  uniform float uSelectionPixelRadius;
  uniform float uSelectionPhase;
  uniform sampler2D uSelectionStripe;
  uniform vec4 uSelectionStripeViewport;
  uniform int uRenderMode;
  uniform int uAlphaMode;
  uniform float uOpacity;
  uniform vec4 uColorOverride;
  varying float vSelected;
  void main() {
    vec4 color = vColor;
    bool hasTexture = vUv.x > -999999.0;
    bool gridOnly = false;
    if ((uRenderMode == 2 || uRenderMode == 3) && hasTexture) {
      vec4 texel = texture2D(uTexture, vUv);
      if (uRenderMode == 2) color *= texel;
      else color.a *= texel.a;
      if (uAlphaMode == 0) color.a = 1.0;
      if (uAlphaMode == 1) {
        if (color.a < 0.1) {
          if (uPaintPixelGrid == 1 && uRenderMode == 2) gridOnly = true;
          else discard;
        } else color.a = 1.0;
      }
      if (uAlphaMode == 2 && color.a < 0.1) {
        if (uPaintPixelGrid == 1 && uRenderMode == 2) gridOnly = true;
        else discard;
      }
    }
    color.rgb = mix(color.rgb, vec3(1.0), vSelected * 0.13);
    #ifdef SCREEN_SELECTION_DERIVATIVES
    vec2 selectionStepX = dFdx(vUv) * uSelectionPixelRadius;
    vec2 selectionStepY = dFdy(vUv) * uSelectionPixelRadius;
    #else
    vec2 selectionStepX = vec2(uSelectionTexel.x, 0.0);
    vec2 selectionStepY = vec2(0.0, uSelectionTexel.y);
    #endif
    if (uSelectionActive == 1 && (uRenderMode == 1 || uRenderMode == 2)) {
      float selected = hasTexture ? texture2D(uSelectionMask, vUv).r : 0.0;
      if (selected < 0.5) color.rgb *= 0.57;
      else if (hasTexture) {
        float nearest = min(min(texture2D(uSelectionMask, vUv + selectionStepX).r,
          texture2D(uSelectionMask, vUv - selectionStepX).r),
          min(texture2D(uSelectionMask, vUv + selectionStepY).r,
          texture2D(uSelectionMask, vUv - selectionStepY).r));
        if (nearest < 0.5) {
          vec2 screenPoint = vec2(gl_FragCoord.x,
            uSelectionStripeViewport.w - gl_FragCoord.y) / uSelectionStripeViewport.z
            + uSelectionStripeViewport.xy;
          color.rgb = texture2D(uSelectionStripe,
            (screenPoint + vec2(uSelectionPhase, 0.0)) / 8.0).rgb;
        }
      }
    }
    if (uPaintPixelGrid == 1 && hasTexture) {
      vec2 pixelPoint = vUv * uPaintGridSize;
      vec2 boundary = min(fract(pixelPoint), 1.0 - fract(pixelPoint));
      #ifdef SCREEN_SELECTION_DERIVATIVES
      vec2 footprint = max(fwidth(pixelPoint), vec2(0.0001));
      vec2 visibility = smoothstep(vec2(1.0), vec2(2.0), 1.0 / footprint);
      vec2 lines = 1.0 - smoothstep(vec2(0.1), vec2(0.65), boundary / footprint);
      float line = max(lines.x * visibility.x, lines.y * visibility.y);
      #else
      float line = 1.0 - smoothstep(0.01, 0.05, min(boundary.x, boundary.y));
      #endif
      vec3 ink = dot(color.rgb, vec3(0.299, 0.587, 0.114)) > 0.45 ? vec3(0.0) : vec3(1.0);
      if (gridOnly) {
        if (line < 0.001) discard;
        color.rgb = ink;
        color.a = line * 0.45;
      } else color.rgb = mix(color.rgb, ink, line * 0.45);
    }
    if (uColorOverride.a > 0.5) color.rgb = uColorOverride.rgb;
    color.a *= uOpacity;
    gl_FragColor = color;
  }
`;

export const LOG_DEPTH_FRAGMENT_SHADER = `
  #extension GL_EXT_frag_depth : enable
  precision highp float;
  precision highp int;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vSelected;
  varying float vFragDepth;
  uniform sampler2D uTexture;
  uniform int uPaintPixelGrid;
  uniform vec2 uPaintGridSize;
  uniform sampler2D uSelectionMask;
  uniform int uSelectionActive;
  uniform vec2 uSelectionTexel;
  uniform float uSelectionPixelRadius;
  uniform float uSelectionPhase;
  uniform sampler2D uSelectionStripe;
  uniform vec4 uSelectionStripeViewport;
  uniform int uRenderMode;
  uniform int uAlphaMode;
  uniform float uOpacity;
  uniform vec4 uColorOverride;
  uniform int uUseLogDepth;
  uniform float uLogDepthFactor;
  void main() {
    vec4 color = vColor;
    bool hasTexture = vUv.x > -999999.0;
    bool gridOnly = false;
    if ((uRenderMode == 2 || uRenderMode == 3) && hasTexture) {
      vec4 texel = texture2D(uTexture, vUv);
      if (uRenderMode == 2) color *= texel;
      else color.a *= texel.a;
      if (uAlphaMode == 0) color.a = 1.0;
      if (uAlphaMode == 1) {
        if (color.a < 0.1) {
          if (uPaintPixelGrid == 1 && uRenderMode == 2) gridOnly = true;
          else discard;
        } else color.a = 1.0;
      }
      if (uAlphaMode == 2 && color.a < 0.1) {
        if (uPaintPixelGrid == 1 && uRenderMode == 2) gridOnly = true;
        else discard;
      }
    }
    color.rgb = mix(color.rgb, vec3(1.0), vSelected * 0.13);
    #ifdef SCREEN_SELECTION_DERIVATIVES
    vec2 selectionStepX = dFdx(vUv) * uSelectionPixelRadius;
    vec2 selectionStepY = dFdy(vUv) * uSelectionPixelRadius;
    #else
    vec2 selectionStepX = vec2(uSelectionTexel.x, 0.0);
    vec2 selectionStepY = vec2(0.0, uSelectionTexel.y);
    #endif
    if (uSelectionActive == 1 && (uRenderMode == 1 || uRenderMode == 2)) {
      float selected = hasTexture ? texture2D(uSelectionMask, vUv).r : 0.0;
      if (selected < 0.5) color.rgb *= 0.57;
      else if (hasTexture) {
        float nearest = min(min(texture2D(uSelectionMask, vUv + selectionStepX).r,
          texture2D(uSelectionMask, vUv - selectionStepX).r),
          min(texture2D(uSelectionMask, vUv + selectionStepY).r,
          texture2D(uSelectionMask, vUv - selectionStepY).r));
        if (nearest < 0.5) {
          vec2 screenPoint = vec2(gl_FragCoord.x,
            uSelectionStripeViewport.w - gl_FragCoord.y) / uSelectionStripeViewport.z
            + uSelectionStripeViewport.xy;
          color.rgb = texture2D(uSelectionStripe,
            (screenPoint + vec2(uSelectionPhase, 0.0)) / 8.0).rgb;
        }
      }
    }
    if (uPaintPixelGrid == 1 && hasTexture) {
      vec2 pixelPoint = vUv * uPaintGridSize;
      vec2 boundary = min(fract(pixelPoint), 1.0 - fract(pixelPoint));
      #ifdef SCREEN_SELECTION_DERIVATIVES
      vec2 footprint = max(fwidth(pixelPoint), vec2(0.0001));
      vec2 visibility = smoothstep(vec2(1.0), vec2(2.0), 1.0 / footprint);
      vec2 lines = 1.0 - smoothstep(vec2(0.1), vec2(0.65), boundary / footprint);
      float line = max(lines.x * visibility.x, lines.y * visibility.y);
      #else
      float line = 1.0 - smoothstep(0.01, 0.05, min(boundary.x, boundary.y));
      #endif
      vec3 ink = dot(color.rgb, vec3(0.299, 0.587, 0.114)) > 0.45 ? vec3(0.0) : vec3(1.0);
      if (gridOnly) {
        if (line < 0.001) discard;
        color.rgb = ink;
        color.a = line * 0.45;
      } else color.rgb = mix(color.rgb, ink, line * 0.45);
    }
    if (uColorOverride.a > 0.5) color.rgb = uColorOverride.rgb;
    color.a *= uOpacity;
    gl_FragDepthEXT = uUseLogDepth == 1
      ? log2(max(1.0e-6, vFragDepth)) * uLogDepthFactor
      : gl_FragCoord.z;
    gl_FragColor = color;
  }
`;
