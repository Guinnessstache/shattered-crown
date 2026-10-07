// Post-processing: HDR bloom (flames, lava, crystals, magic), then a film-style grade —
// per-zone tint, lift, saturation, vignette and a touch of grain. Quality-gated:
// high = full-res bloom + grade, medium = half-res bloom + grade, low = straight render.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uSat: { value: 1 },
    uVig: { value: 0.5 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uFlash: { value: new THREE.Vector4(0, 0, 0, 0) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec3 uTint; uniform vec3 uLift; uniform float uSat; uniform float uVig;
    uniform float uTime; uniform float uAspect; uniform vec4 uFlash;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // gentle S-curve for contrast, then grade
      c = c * c * (3.0 - 2.0 * c) * 0.35 + c * 0.65;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = c * uTint + uLift * (1.0 - c);
      // warm highlights / cool shadows split-tone
      c += vec3(0.018, 0.008, -0.012) * smoothstep(0.45, 1.0, l) + vec3(-0.008, 0.0, 0.016) * (1.0 - smoothstep(0.0, 0.35, l));
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.95, 0.25, length(d) * (0.85 + uVig * 0.5));
      c *= mix(1.0, v, uVig);
      c = mix(c, uFlash.rgb, uFlash.a * smoothstep(0.2, 0.9, length(d)));
      c += (hash(vUv * 731.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.enabled = false; this.composer = null;
    this.grade = { tint: [1, 1, 1], lift: [0, 0, 0], sat: 1, vig: 0.5, bloom: 0.5 };
    this.flash = new THREE.Vector4(0, 0, 0, 0);
  }

  setQuality(q, w, h) {
    this.dispose();
    this.enabled = q !== 'low';
    if (!this.enabled) return;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bs = q === 'high' ? 1 : 0.5;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w * bs, h * bs), 0.5, 0.5, 0.9);
    this.bloomScale = bs;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);
    this.apply();
    this.setSize(w, h);
  }

  setGrade(g) { this.grade = { ...this.grade, ...g }; this.apply(); }

  apply() {
    if (!this.enabled) return;
    const g = this.grade; const u = this.gradePass.uniforms;
    u.uTint.value.set(...g.tint); u.uLift.value.set(...g.lift); u.uSat.value = g.sat; u.uVig.value = g.vig;
    this.bloom.strength = g.bloom;
  }

  // Brief screen-edge flash (red when hurt, gold on level-up, …).
  pulse(color, a = 0.4) { const c = new THREE.Color(color); this.flash.set(c.r, c.g, c.b, a); }

  setSize(w, h) {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    if (this.bloomScale !== 1) this.bloom.setSize(w * this.bloomScale * this.renderer.getPixelRatio(), h * this.bloomScale * this.renderer.getPixelRatio());
    this.gradePass.uniforms.uAspect.value = w / h;
  }

  render(dt) {
    if (!this.enabled) { this.renderer.render(this.scene, this.camera); return; }
    const u = this.gradePass.uniforms;
    u.uTime.value = (u.uTime.value + dt * 7.3) % 100;
    this.flash.w = Math.max(0, this.flash.w - dt * 1.6);
    u.uFlash.value.copy(this.flash);
    this.composer.render(dt);
  }

  dispose() {
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); this.bloom?.dispose(); }
    this.composer = null;
  }
}
