import { gateEditor, generationLog } from "./civic/gate-editor.ts";
import { focusMode } from "./civic/focus.ts";
import { studio } from "./civic/studio.ts";
import { civicPanel } from "./civic/panel.ts";
import { cityMap } from "./city-map.ts";
import { characterPanel } from "./player/interface.ts";
import { minimap } from "./minimap.ts";
import { modelSettings } from "./model-settings.ts";
import { terrainHeight } from "./workshop/site.ts";
import { element } from "./types.ts";
import type {
  Bytes,
  PackedAttribute,
  PackedGeometry,
  Owner,
  Tile,
  ActorRig,
  PersonSlot,
  ActorSpec,
  MotionState,
  Population,
  MapManifest,
  StreamPackets,
  Packet,
  TilePacket,
  RigPacket,
} from "./types.ts";
import { covers, crowdCollision, resolveSupport } from "./physics/collision.ts";
import packedPopulation from "./data/crowd-silhouettes.json";
import * as T from "three";
import rawMap from "./data/stream-map.json";
import { gunzipSync } from "fflate";

const map: MapManifest = rawMap;
const canvas = element<HTMLCanvasElement>("canvas");
const status = element("#status");
const renderer = new T.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
const scene = new T.Scene();
scene.background = new T.Color("#d8dfd7");
scene.fog = new T.Fog("#d8dfd7", 88, 180);
const camera = new T.PerspectiveCamera(66, 1, 0.075, 205);
scene.add(new T.HemisphereLight("#fffae9", "#a2a896", 1.7));
const sun = new T.DirectionalLight("#fff0d7", 2.05);
sun.position.set(-65, 95, 45);
scene.add(sun);
const ground = new T.Mesh(
  new T.PlaneGeometry(13000, 13000),
  new T.MeshLambertMaterial({ color: "#aaab8b" }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.9;
ground.visible = false;
scene.add(ground);
// Two continuous colour layers share a camera. Distance selects the blend and the filter width.
const sight = { detailStart: 115, detailEnd: 185, limit: 12500 };
const sky = 0xcfd9d6;
const horizon = new T.Scene();
horizon.background = new T.Color(sky);
scene.background = null;
scene.fog = null;
camera.far = sight.limit; // Contains the model's whole bounding rectangle from any walkable point.
const composite = new T.Scene();
const screenCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
function makeColourDepthTarget() {
  const target = new T.WebGLRenderTarget(16, 16, {
    minFilter: T.LinearFilter,
    magFilter: T.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.colorSpace = T.LinearSRGBColorSpace;
  target.depthTexture = new T.DepthTexture(16, 16, T.UnsignedIntType);
  target.depthTexture.minFilter = target.depthTexture.magFilter =
    T.NearestFilter;
  return target;
}
const horizonTarget = makeColourDepthTarget();
const detailTarget = makeColourDepthTarget();
const coverageBytes = new Uint8Array(128 * 128);
const coverage = new T.DataTexture(coverageBytes, 128, 128, T.RedFormat);
coverage.magFilter = coverage.minFilter = T.NearestFilter;
coverage.needsUpdate = true;
const entering = new Map();
let horizonReady = false;
function writeCoverage(key: string, value: number) {
  const [x, z] = key.split("_").map(Number);
  const index = (z + 64) * 128 + x + 64;
  if (coverageBytes[index] === value) return;
  coverageBytes[index] = value;
  coverage.needsUpdate = true;
}
function fadeTiles(now: number) {
  for (const [key, start] of entering) {
    const progress = Math.min(1, (now - start) / 650);
    writeCoverage(key, Math.round(255 * progress));
    if (progress === 1) entering.delete(key);
  }
}
// Leave a clear opening in the coarse city at the player's feet, for open doors and courtyards.
// A continuous opacity ramp on the coarse surfaces prevents a visible inner cut plane.
const farMaterial = new T.MeshBasicMaterial({
  vertexColors: true,
  side: T.DoubleSide,
  transparent: true,
  depthWrite: true,
});
farMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.streetCoverage = { value: coverage };
  shader.vertexShader =
    "varying vec3 landmarkPosition;\n" +
    shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
    landmarkPosition=(modelMatrix*vec4(transformed,1.0)).xyz;`,
    );
  shader.fragmentShader =
    "uniform sampler2D streetCoverage; varying vec3 landmarkPosition;\n" +
    shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
    float d=length(landmarkPosition-cameraPosition);
    float k=texture2D(streetCoverage,(floor(landmarkPosition.xz/128.0)+64.5)/128.0).r;
    diffuseColor.a*=mix(1.0,smoothstep(48.0,91.0,d),k);
    if(diffuseColor.a<0.0001)discard;
    `,
    );
};
const actorTarget = makeColourDepthTarget();
// Daylight adaptation is evaluated in optical power (inverse metres) on the GPU.
const sceneVertex = `
  varying vec2 screenUV;
  void main(){screenUV=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
function postMaterial(
  uniforms: Record<string, T.IUniform>,
  fragmentShader: string,
) {
  return new T.ShaderMaterial({
    uniforms,
    vertexShader: sceneVertex,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: T.NoBlending,
  });
}
function postTarget(
  width: number,
  height: number,
  type: T.TextureDataType = T.UnsignedByteType,
) {
  const target = new T.WebGLRenderTarget(width, height, {
    type,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: T.LinearFilter,
    magFilter: T.LinearFilter,
    generateMipmaps: false,
  });
  target.texture.colorSpace = T.LinearSRGBColorSpace;
  return target;
}
const daylightUniforms = {
  actorColour: { value: actorTarget.texture },
  actorDepth: { value: actorTarget.depthTexture },
  fineColour: { value: detailTarget.texture },
  fineDepth: { value: detailTarget.depthTexture },
  farColour: { value: horizonTarget.texture },
  farDepth: { value: horizonTarget.depthTexture },
  coverageMap: { value: coverage },
  invProjection: { value: camera.projectionMatrixInverse },
  cameraWorld: { value: camera.matrixWorld },
  clip: { value: new T.Vector2(camera.near, camera.far) },
  farValid: { value: 0 },
};
const depthGLSL = `
  uniform sampler2D fineDepth,farDepth,coverageMap,actorDepth;
  uniform mat4 invProjection,cameraWorld;
  uniform vec2 clip;uniform float farValid;
  float metres(float d){return clip.x*clip.y/(clip.y-d*(clip.y-clip.x));}
  vec3 viewRay(vec2 uv){vec4 r=invProjection*vec4(uv*2.-1.,1.,1.);return r.xyz/max(.00001,-r.z);}
  float availability(vec3 viewPoint){
    vec3 world=(cameraWorld*vec4(viewPoint,1.)).xyz;
    return texture2D(coverageMap,(floor(world.xz/128.)+64.5)/128.).r;
  }
  // A fully resident street owns its depth. A coarse wall can still occlude people outside it.
  float worldBlocker(vec2 uv,vec3 ray,float fine,float farPlane){
    if(farPlane>=1.)return fine;
    vec3 farPoint=ray*metres(farPlane);
    float resident=availability(farPoint);
    if(resident>.98 && length(farPoint)<165.)return fine;
    return min(fine,farPlane);
  }
  bool actorInFront(float actor,float barrier){return actor<1. && actor<=barrier;}
  float opticalPower(vec2 uv){
    float barrier=worldBlocker(uv,viewRay(uv),texture2D(fineDepth,uv).r,texture2D(farDepth,uv).r);
    return 1./clamp(metres(min(barrier,texture2D(actorDepth,uv).r)),.6,1200.);
  }`;
const focusBuffers = [postTarget(1, 1), postTarget(1, 1)];
const focusUniforms = {
  ...daylightUniforms,
  previous: { value: null as T.Texture | null },
  first: { value: 1 },
  adapt: { value: 1 },
  aim: { value: new T.Vector2(0.5, 0.5) },
};
const focusPass = postMaterial(
  focusUniforms,
  depthGLSL +
    `
  uniform sampler2D previous;uniform float first,adapt;uniform vec2 aim;
  void main(){
    float s[5];s[0]=opticalPower(aim);s[1]=opticalPower(aim+vec2(-.012,0.));s[2]=opticalPower(aim+vec2(.012,0.));
    s[3]=opticalPower(aim+vec2(0.,.016));s[4]=opticalPower(aim-vec2(0.,.016));
    for(int i=0;i<5;i++)for(int j=0;j<4;j++)if(s[j]>s[j+1]){float t=s[j];s[j]=s[j+1];s[j+1]=t;}
    vec2 prev=texture2D(previous,vec2(.5)).rg;
    float last=2.*(prev.x+prev.y/255.);
    float goal=s[2];if(abs(last-goal)<.0025&&first<.5)goal=last;
    float next=mix(last,goal,max(first,adapt));
    float p=clamp(next*.5,0.,.998)*255.;gl_FragColor=vec4(floor(p)/255.,fract(p),0.,1.);
  }`,
);
const highPrecision =
  renderer.extensions.has("EXT_color_buffer_float") &&
  renderer.extensions.has("OES_texture_float_linear");
const resolvedDaylight = postTarget(
  1,
  1,
  highPrecision ? T.HalfFloatType : T.UnsignedByteType,
);
const atmospherePass = postMaterial(
  daylightUniforms,
  depthGLSL +
    `
  varying vec2 screenUV;uniform sampler2D fineColour,farColour,actorColour;
  vec3 throughAir(vec3 rgb,vec3 world,float distanceM){
    // Closed-form mean of an exponential vertical density along the sight line.
    float eyeH=clamp(cameraWorld[3].y,0.,500.);
    float dy=clamp(world.y-eyeH,-250.,500.)/70.;
    float average=abs(dy)<.001?1.-dy*.5:(1.-exp(-dy))/dy;
    float tau=.00024*max(0.,distanceM-25.)*exp(-eyeH/70.)*average;
    float scatter=min(.53,1.-exp(-tau));
    float lum=dot(rgb,vec3(.2126,.7152,.0722));
    vec3 grade=mix(rgb,vec3(lum),scatter*.33);
    return mix(grade,vec3(.59,.65,.66),scatter);
  }
  void main(){
    vec3 ray=viewRay(screenUV);
    float cd=texture2D(farDepth,screenUV).r,fd=texture2D(fineDepth,screenUV).r;
    float coarseZ=metres(cd);vec3 coarseP=ray*coarseZ;
    vec3 colour=texture2D(farColour,screenUV).rgb;
    if(cd<.9999999)colour=throughAir(colour,(cameraWorld*vec4(coarseP,1.)).xyz,length(coarseP));
    float power=cd<.9999999?1./max(.6,coarseZ):0.;
    if(fd<1.){
      float z=metres(fd);vec3 p=ray*z;vec4 fine=texture2D(fineColour,screenUV);
      float blend=availability(p)*(1.-farValid*smoothstep(115.,185.,length(p)))*fine.a;
      vec3 surface=throughAir(fine.rgb/max(.00001,fine.a),(cameraWorld*vec4(p,1.)).xyz,length(p));
      colour=mix(colour,surface,blend);power=mix(power,1./max(.6,z),blend);
    }
    float actor=texture2D(actorDepth,screenUV).r;
    if(actorInFront(actor,worldBlocker(screenUV,ray,fd,cd))){
      float z=metres(actor);vec3 p=ray*z;
      colour=throughAir(texture2D(actorColour,screenUV).rgb,(cameraWorld*vec4(p,1.)).xyz,length(p));
      power=1./max(.6,z);
    }
    // Packing in square-root space also preserves sensible precision on RGBA8 devices.
    gl_FragColor=vec4(colour,sqrt(clamp(power*.5,0.,1.)));
  }`,
);
const lensUniforms = {
  source: { value: resolvedDaylight.texture },
  focusMap: { value: null as T.Texture | null },
  pixel: { value: new T.Vector2() },
  pupilScale: { value: 2 },
};
const lensPass = postMaterial(
  lensUniforms,
  `
  varying vec2 screenUV;uniform sampler2D source,focusMap;
  uniform vec2 pixel;uniform float pupilScale;
  void main(){
    vec4 centre=texture2D(source,screenUV);
    vec2 packedPower=texture2D(focusMap,vec2(.5)).rg;
    float focus=2.*(packedPower.x+packedPower.y/255.);
    float here=2.*centre.a*centre.a;
    float radius=min(3.2,max(0.,abs(here-focus)-.035)*pupilScale);
    vec3 colour=centre.rgb;
    if(radius>.28){
      vec3 sum=centre.rgb*2.;float total=2.;
      for(int i=0;i<12;i++){
        float a=float(i)*.52359878;
        // Two interleaved aperture rings. Positions are deterministic across frames.
        float ring=mod(float(i),2.)<.5?.52:1.;
        vec4 n=texture2D(source,screenUV+vec2(cos(a),sin(a))*ring*radius*pixel);
        float samplePower=2.*n.a*n.a;
        float weight=1.-smoothstep(.035,.22,samplePower-here);
        float energy=smoothstep(.80,1.,dot(n.rgb,vec3(.2126,.7152,.0722)))*step(.00001,n.a);
        weight*=1.+.13*energy;
        sum+=n.rgb*weight;total+=weight;
      }
      colour=mix(colour,sum/total,smoothstep(.28,.75,radius));
    }
    gl_FragColor=vec4(colour,1.);
    #include <colorspace_fragment>
  }`,
);
const postQuad = new T.Mesh(new T.PlaneGeometry(2, 2), atmospherePass);
postQuad.frustumCulled = false;
composite.add(postQuad);
function stagePass(
  material: T.ShaderMaterial,
  target: T.WebGLRenderTarget | null,
) {
  postQuad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(composite, screenCamera);
}
function sizeVisibility() {
  const size = renderer.getDrawingBufferSize(new T.Vector2());
  actorTarget.setSize(size.x, size.y);
  detailTarget.setSize(size.x, size.y);
  horizonTarget.setSize(size.x, size.y);
  resolvedDaylight.setSize(size.x, size.y);
  lensUniforms.pixel.value.set(1 / canvas.clientWidth, 1 / canvas.clientHeight);
  lensUniforms.pupilScale.value =
    (0.0032 * canvas.clientHeight) /
    (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)));
}
let focusFront = 0,
  lastFocusTime = 0;
function drawVisibility(now: number) {
  fadeTiles(now);
  renderer.autoClear = false;
  renderer.setRenderTarget(horizonTarget);
  renderer.setClearColor(sky, 1);
  renderer.clear();
  renderer.render(horizon, camera);
  renderer.setRenderTarget(detailTarget);
  renderer.setClearColor(0, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(actorTarget);
  renderer.setClearColor(0, 0);
  renderer.clear();
  renderer.render(actorScene, camera);
  daylightUniforms.farValid.value = horizonReady ? 1 : 0;
  focusUniforms.aim.value.set(0.5, player.first ? 0.5 : 0.58);
  focusUniforms.first.value = lastFocusTime ? 0 : 1;
  focusUniforms.adapt.value =
    1 - Math.exp(-Math.min(0.15, (now - lastFocusTime) / 1000) / 0.34);
  lastFocusTime = now;
  focusUniforms.previous.value = focusBuffers[focusFront].texture;
  focusFront = 1 - focusFront;
  stagePass(focusPass, focusBuffers[focusFront]);
  stagePass(atmospherePass, resolvedDaylight);
  lensUniforms.focusMap.value = focusBuffers[focusFront].texture;
  stagePass(lensPass, null);
}

async function initHorizon() {
  const blocks = await readPacket("horizon", "city");
  let deadline = performance.now() + 5;
  for (const [xyz, rgb, indices] of blocks) {
    const raw = new Int16Array(from64(xyz).buffer),
      pos = Float32Array.from(raw, (n) => n * 0.25);
    const colours = from64(rgb),
      linear = new Uint8Array(colours.length);
    for (let i = 0; i < colours.length; i++) {
      const v = colours[i] / 255;
      linear[i] = Math.round(
        255 * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
      );
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    g.setAttribute("color", new T.BufferAttribute(linear, 3, true));
    g.setIndex(
      new T.BufferAttribute(new Uint32Array(from64(indices).buffer), 1),
    );
    g.computeBoundingSphere();
    horizon.add(new T.Mesh(g, farMaterial));
    if (performance.now() > deadline) {
      await frame();
      deadline = performance.now() + 5;
    }
  }
  horizonReady = true;
}
const speedControl = element<HTMLInputElement>("#speed");
const speedOutput = element<HTMLOutputElement>("#speedValue");
let walkingSpeed = 1.6;
try {
  const saved = Number.parseFloat(
    localStorage.getItem("luoyang.walk.mps") ?? "",
  );
  if (Number.isFinite(saved)) walkingSpeed = T.MathUtils.clamp(saved, 0.5, 6);
} catch {}
function showSpeed() {
  speedControl.value = String(walkingSpeed);
  speedOutput.value = walkingSpeed.toFixed(1) + " 米/秒";
  speedControl.setAttribute("aria-valuetext", speedOutput.value);
}
speedControl.addEventListener("input", () => {
  walkingSpeed = T.MathUtils.clamp(Number(speedControl.value), 0.5, 6);
  showSpeed();
  try {
    localStorage.setItem("luoyang.walk.mps", String(walkingSpeed));
  } catch {}
});
showSpeed();

const CELL = map.tileSize,
  available = new Set(map.tileKeys),
  loaded = new Map<string, Tile>(),
  pending = new Set<string>(),
  failed = new Map<string, number>();
const player = {
  ...map.spawn,
  angle: map.spawn.yaw,
  pitch: -0.035,
  face: map.spawn.yaw,
  phase: 0,
  first: true,
  rig: null as ActorRig | null,
  action: "idle",
};
player.x += Math.cos(player.angle) * 14.2;
player.z -= Math.sin(player.angle) * 14.2;
player.angle += 0.11;
let wanted = new Set<string>(),
  plans: [string, number][] = [],
  lastPlan = "",
  unloaded = 0,
  ready = false;
const keys = new Set<string>();
interface Job {
  key: string;
  data?: string | null;
  resolve: (p: Packet) => void;
  reject: (error: unknown) => void;
}
const scripts = new Map<string, Job>(),
  queue: Job[] = [];
let busy = 0;
function from64(s: Bytes): Uint8Array<ArrayBuffer> {
  if (s instanceof Uint8Array) return s;
  const txt = atob(s),
    buf = new Uint8Array(txt.length);
  for (let i = 0; i < buf.length; i++) buf[i] = txt.charCodeAt(i);
  return buf;
}
declare global {
  interface Window {
    LuoyangChunk: (key: string, data: string) => void;
  }
}
window.LuoyangChunk = (key, data) => {
  const item = scripts.get(key);
  if (item) item.data = data;
};
// The worker decodes compressed JSON and converts geometry streams to transferable buffers.
import workerSource from "embedded:decoder";
let decoder: Worker | null = null,
  decodeId = 0;
const decodeJobs = new Map<
  number,
  {
    resolve: (p: Packet) => void;
    reject: (e: unknown) => void;
    payload: string;
  }
>();
function fallbackDecode(payload: string): Packet {
  return JSON.parse(
    new TextDecoder().decode(gunzipSync(from64(payload))),
  ) as Packet;
}
if (globalThis.Worker) {
  try {
    const url = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    decoder = new Worker(url);
    URL.revokeObjectURL(url);
    decoder.onmessage = ({
      data,
    }: {
      data: { id: number; packet: Packet; error?: string };
    }) => {
      const job = decodeJobs.get(data.id);
      if (!job) return;
      decodeJobs.delete(data.id);
      if (data.error) {
        try {
          job.resolve(fallbackDecode(job.payload));
        } catch (e) {
          job.reject(e);
        }
      } else job.resolve(data.packet);
    };
    decoder.onerror = () => {
      decoder?.terminate();
      decoder = null;
      for (const job of decodeJobs.values()) {
        try {
          job.resolve(fallbackDecode(job.payload));
        } catch (e) {
          job.reject(e);
        }
      }
      decodeJobs.clear();
    };
  } catch {
    decoder = null;
  }
}
function decodePacket(key: string, payload: string): Promise<Packet> {
  if (!decoder) return Promise.resolve(fallbackDecode(payload));
  return new Promise((resolve, reject) => {
    const id = ++decodeId;
    decodeJobs.set(id, { resolve, reject, payload });
    decoder!.postMessage({ id, key, payload });
  });
}
function readPacket<K extends keyof StreamPackets>(
  key: K,
  id: string | number,
): Promise<StreamPackets[K]> {
  return new Promise((resolve, reject) => {
    queue.push({
      key: key + "/" + id,
      resolve: (p) => resolve(p as StreamPackets[K]),
      reject,
    });
    pump();
  });
}
function pump() {
  while (busy < 8 && queue.length) {
    const job = queue.shift()!;
    busy++;
    const el = document.createElement("script");
    el.src = "./洛阳漫游资源/" + job.key + ".js";
    el.async = true;
    scripts.set(job.key, job);
    const finish = () => {
      el.remove();
      scripts.delete(job.key);
      busy--;
      pump();
    };
    el.onerror = () => {
      finish();
      job.reject(new Error("街区资源读取失败 " + job.key));
    };
    el.onload = async () => {
      try {
        if (!job.data) throw Error("模型数据缺失 " + job.key);
        const packet = await decodePacket(job.key, job.data);
        job.data = null;
        job.resolve(packet);
      } catch (e) {
        job.reject(e);
      } finally {
        finish();
      }
    };
    document.head.append(el);
  }
}
const constructors = { Float32Array, Uint8Array, Uint16Array, Uint32Array };
const names: Record<string, string> = {
  POSITION: "position",
  NORMAL: "normal",
  TEXCOORD_0: "uv",
  COLOR_0: "color",
  JOINTS_0: "skinIndex",
  WEIGHTS_0: "skinWeight",
};
function attr([type, n, data, normalized]: PackedAttribute) {
  return new T.BufferAttribute(
    new constructors[type](from64(data).buffer),
    n,
    !!normalized,
  );
}
function geoFrom(data: PackedGeometry) {
  const g = new T.BufferGeometry();
  for (const [k, v] of Object.entries(data.attrs))
    if (names[k]) g.setAttribute(names[k], attr(v));
  if (data.indices) g.setIndex(attr(data.indices));
  return g;
}
const assets = new Map<
  string,
  { users: number; promise: Promise<unknown>; cleanup: () => void }
>();
function borrow<T>(
  key: string,
  owner: Owner,
  create: () => T | Promise<T>,
  dispose: (v: T) => void,
): Promise<T> {
  let entry = assets.get(key);
  if (!entry) {
    const promise = Promise.resolve().then(create);
    entry = {
      users: 0,
      promise,
      cleanup: () => {
        void promise.then(dispose).catch(() => {});
      },
    };
    assets.set(key, entry);
  }
  if (!owner.refs.has(key)) {
    owner.refs.add(key);
    entry.users++;
  }
  return entry.promise as Promise<T>;
}
function release(owner: Owner) {
  for (const key of owner.refs) {
    const entry = assets.get(key);
    if (entry && --entry.users === 0) {
      assets.delete(key);
      entry.cleanup();
    }
  }
  owner.refs.clear();
}
const dispose = (asset: { dispose(): void }) => asset.dispose();
function texture(id: number, owner: Owner) {
  return borrow(
    "t" + id,
    owner,
    async () => {
      const d = await readPacket("images", id),
        img = new Image();
      img.src = d.uri;
      await img.decode();
      const t = new T.Texture(img);
      t.flipY = false;
      t.colorSpace = T.SRGBColorSpace;
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
      return t;
    },
    dispose,
  );
}
async function getMat(id: number, vc: boolean, owner: Owner) {
  const spec = map.materials[id];
  const tex =
    spec.texture === undefined ? null : await texture(spec.texture, owner);
  return borrow(
    "m" + id + "/" + vc,
    owner,
    () => {
      const opts = {
        color: new T.Color().fromArray(spec.c),
        map: tex,
        vertexColors: !!vc,
        side: spec.side ? T.DoubleSide : T.FrontSide,
        transparent: spec.alpha === "BLEND",
        opacity: spec.c[3],
        depthWrite: spec.alpha !== "BLEND",
        alphaTest: spec.alpha === "MASK" ? (spec.cut ?? 0.5) : 0,
      };
      return spec.unlit
        ? new T.MeshBasicMaterial(opts)
        : new T.MeshStandardMaterial({
            ...opts,
            roughness: spec.r,
            metalness: 0,
          });
    },
    dispose,
  );
}
function shared(id: number, owner: Owner) {
  return borrow(
    "g" + id,
    owner,
    async () => geoFrom(await readPacket("geometry", id)),
    dispose,
  );
}
function decodeFloats(s: Bytes) {
  return new Float32Array(from64(s).buffer);
}
function frame() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}
function closeTile(key: string) {
  const tile = loaded.get(key);
  if (!tile) return;
  loaded.delete(key);
  entering.delete(key);
  writeCoverage(key, 0);
  scene.remove(tile.group);
  for (const mesh of tile.group.children)
    if (mesh instanceof T.InstancedMesh) mesh.dispose();
  for (const g of tile.own) g.dispose();
  release(tile);
  unloaded++;
}
async function streamTile(key: string) {
  const tile: Tile = {
    group: new T.Group(),
    refs: new Set(),
    own: [],
    collision: new Float32Array(),
    people: [],
    grid: new Map(),
    key,
  };
  tile.group.userData.tile = key;
  pending.add(key);
  try {
    const d = await readPacket("tiles", key);
    if (!wanted.has(key)) return;
    const base = decodeFloats(d.c),
      extra = d.extra ? decodeFloats(d.extra) : null;
    tile.collision = extra
      ? new Float32Array(base.length + extra.length)
      : base;
    if (extra) {
      tile.collision.set(base);
      tile.collision.set(extra, base.length);
    }
    tile.people = d.p;
    tile.grid = new Map();
    for (let i = 0; i < tile.collision.length; i += 10) {
      const v = tile.collision,
        x = v[i + 1],
        z = v[i + 2],
        ex =
          Math.abs(v[i + 3]) * v[i + 5] + Math.abs(v[i + 4]) * v[i + 6] + 0.5,
        ez =
          Math.abs(v[i + 4]) * v[i + 5] + Math.abs(v[i + 3]) * v[i + 6] + 0.5;
      const [tx, tz] = key.split("_").map(Number);
      for (
        let a = Math.max(tx * 8, Math.floor((x - ex) / 16));
        a <= Math.min(tx * 8 + 7, Math.floor((x + ex) / 16));
        a++
      )
        for (
          let b = Math.max(tz * 8, Math.floor((z - ez) / 16));
          b <= Math.min(tz * 8 + 7, Math.floor((z + ez) / 16));
          b++
        ) {
          const k = a + "," + b;
          if (!tile.grid.has(k)) tile.grid.set(k, []);
          tile.grid.get(k)!.push(i);
        }
    }
    // Dependencies are requested once, even when several neighbouring tiles use the same roof or texture.
    const batches = await Promise.all(
      d.b.map(async ([id, mid, data]) => {
        const g = await shared(id, tile),
          m = await getMat(mid, !!g.attributes.color, tile);
        return { g, m, data, mid };
      }),
    );
    const direct = await Promise.all(
      d.g.map(async (g) => ({
        data: g,
        mat: await getMat(g.mat, !!g.cc, tile),
      })),
    );
    let deadline = performance.now() + 5;
    for (const [batchIndex, { g, m, data, mid }] of batches.entries()) {
      if (!wanted.has(key)) return;
      const v = decodeFloats(data),
        mesh = new T.InstancedMesh(g, m, v.length / 15);
      for (let i = 0, j = 0; i < v.length; i += 15, j++) {
        mesh.instanceMatrix.array.set(
          [
            v[i],
            v[i + 1],
            v[i + 2],
            0,
            v[i + 3],
            v[i + 4],
            v[i + 5],
            0,
            v[i + 6],
            v[i + 7],
            v[i + 8],
            0,
            v[i + 9],
            v[i + 10],
            v[i + 11],
            1,
          ],
          j * 16,
        );
        mesh.setColorAt(j, new T.Color(v[i + 12], v[i + 13], v[i + 14]));
      }
      mesh.userData = {
        asset: `city:${key}:b:${batchIndex}`,
        batch: true,
        display:
          (rawMap.materials[mid] as { name?: string }).name || "街区构件",
      };
      tile.group.add(mesh);
      if (performance.now() > deadline) {
        await frame();
        deadline = performance.now() + 5;
      }
    }
    for (const [geoIndex, { data, mat }] of direct.entries()) {
      if (!wanted.has(key)) return;
      const g = new T.BufferGeometry();
      g.setAttribute(
        "position",
        new T.BufferAttribute(decodeFloats(data.p), 3),
      );
      g.setAttribute("normal", new T.BufferAttribute(decodeFloats(data.n), 3));
      g.setAttribute("uv", new T.BufferAttribute(decodeFloats(data.uv), 2));
      if (data.cc)
        g.setAttribute(
          "color",
          new T.BufferAttribute(decodeFloats(data.c), data.cc),
        );
      g.setIndex(
        new T.BufferAttribute(new Uint32Array(from64(data.i).buffer), 1),
      );
      tile.own.push(g);
      const item = new T.Mesh(g, mat);
      item.userData = {
        asset: `city:${key}:g:${geoIndex}:0`,
        display:
          (rawMap.materials[data.mat] as { name?: string }).name || "地表",
      };
      tile.group.add(item);
      if (performance.now() > deadline) {
        await frame();
        deadline = performance.now() + 5;
      }
    }
    if (wanted.has(key)) {
      loaded.set(key, tile);
      entering.set(key, performance.now());
      scene.add(tile.group);
      failed.delete(key);
    }
  } catch (error) {
    console.error(error);
    failed.set(key, performance.now());
  } finally {
    if (!loaded.has(key)) {
      for (const mesh of tile.group.children)
        if (mesh instanceof T.InstancedMesh) mesh.dispose();
      for (const g of tile.own) g.dispose();
      release(tile);
    }
    pending.delete(key);
  }
}
const tileKey = (x: number, z: number) =>
  Math.floor(x / CELL) + "_" + Math.floor(z / CELL);
function plan() {
  const x = player.x,
    z = player.z,
    tx = Math.floor(x / CELL),
    tz = Math.floor(z / CELL);
  const signature = [
    Math.floor(x / 18),
    Math.floor(z / 18),
    Math.round(player.angle / 0.55),
  ].join("/");
  if (signature !== lastPlan) {
    lastPlan = signature;
    plans = [];
    for (let i = tx - 2; i <= tx + 2; i++)
      for (let j = tz - 2; j <= tz + 2; j++) {
        const key = i + "_" + j;
        if (!available.has(key)) continue;
        const cx = (i + 0.5) * CELL - x,
          cz = (j + 0.5) * CELL - z,
          edge = Math.hypot(
            Math.max(0, Math.abs(cx) - CELL / 2),
            Math.max(0, Math.abs(cz) - CELL / 2),
          );
        if (edge > 213) continue;
        const forward =
          cx * Math.sin(player.angle) + cz * Math.cos(player.angle);
        plans.push([
          key,
          edge -
            Math.min(48, Math.max(0, forward * 0.18)) +
            (key === tileKey(x, z) ? -999 : 0),
        ]);
      }
    plans.sort((a, b) => a[1] - b[1]);
    wanted = new Set(plans.map((item) => item[0]));
    for (const k of [...loaded.keys()]) {
      const [i, j] = k.split("_").map(Number);
      if (
        !wanted.has(k) &&
        Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z) > 300
      )
        closeTile(k);
    }
  }
  const home = tileKey(x, z);
  for (const [k] of plans) {
    if (pending.size >= (loaded.has(home) ? 2 : 1)) break;
    if (
      !loaded.has(k) &&
      !pending.has(k) &&
      (!failed.has(k) || performance.now() - failed.get(k)! > 3000)
    )
      streamTile(k);
  }
  ready = loaded.has(home);
  status.hidden = ready && !waiting;
  if (!ready)
    status.textContent = failed.has(home)
      ? "正在重试街区资源…"
      : "正在载入街区…";
}
function pointBoxes(x: number, z: number): [Float32Array, number[]] | null {
  const tile = loaded.get(tileKey(x, z));
  return tile
    ? [
        tile.collision,
        tile.grid.get(Math.floor(x / 16) + "," + Math.floor(z / 16)) || [],
      ]
    : null;
}
let waiting = false;
function support(x: number, z: number, y: number) {
  if (Math.abs(x) > 4050 || z < -3720 || z > 4630) return null;
  const query = pointBoxes(x, z);
  if (!query) {
    waiting = true;
    status.textContent = "正在载入前方街区…";
    return null;
  }
  const [a, ids] = query;
  const floor = resolveSupport(a, ids, x, z, y, terrainHeight(x, z));
  return floor === null ||
    civic.blocks(x, z, floor) ||
    creations.blocks(x, z, floor) ||
    crowdCollision.blocksMove(player.x, player.z, x, z, floor, 0.31, 1.7)
    ? null
    : floor;
}
const skeletonNames = [
  "trunk",
  "head",
  ...["L", "R"].flatMap((side) =>
    ["upperArm", "forearm", "palm", "thigh", "shank", "foot"].map(
      (part) => side + part,
    ),
  ),
];
const people = new Map<number, PersonSlot>();
let pendingPeople = 0,
  actorUpdate = 0,
  simTime = 0;
async function createRig(
  profile: number,
  height: number,
  skin: string,
  robe: string,
  trim: string | undefined,
  owner: Owner,
  lightweight = false,
) {
  const folder = lightweight ? "people-low" : "people";
  const model = await borrow(
    folder + "/" + profile,
    owner,
    async () => {
      const source = await readPacket(folder, profile);
      const geometry = geoFrom(source.body);
      for (const group of source.groups) geometry.addGroup(...group);
      return { geometry, cycles: source.cycles };
    },
    (r) => r.geometry.dispose(),
  );
  const colours = [
    skin,
    robe,
    "#746d60",
    "#514a41",
    "#39332f",
    trim || "#ae977a",
  ];
  const mats = colours.map(
    (color) =>
      new T.MeshLambertMaterial({
        color,
        vertexColors: true,
        side: T.DoubleSide,
      }),
  );
  const mesh = new T.SkinnedMesh(model.geometry, mats);
  mesh.scale.setScalar(height / 178.5);
  const bones = skeletonNames.map((name) => {
    const b = new T.Bone();
    b.name = name;
    mesh.add(b);
    return b;
  });
  mesh.bind(
    new T.Skeleton(
      bones,
      bones.map(() => new T.Matrix4()),
    ),
    new T.Matrix4(),
  );
  mesh.boundingSphere = new T.Sphere(new T.Vector3(0, 90, 0), 125);
  const root = new T.Group();
  root.add(mesh);
  return { model, mesh, bones, root };
}
const qa = new T.Quaternion(),
  qb = new T.Quaternion();
function animateRig(rig: ActorRig, action: string, phase: number) {
  const cycle = rig.model.cycles[action] || rig.model.cycles.idle,
    n = cycle.length === 1 ? 0 : (phase % 1) * (cycle.length - 1),
    i = Math.floor(n),
    a = cycle[i],
    b = cycle[Math.min(i + 1, cycle.length - 1)],
    t = n - i;
  for (let j = 0; j < rig.bones.length; j++) {
    const k = j * 7,
      o = rig.bones[j];
    o.position.set(
      a[k] + (b[k] - a[k]) * t,
      a[k + 1] + (b[k + 1] - a[k + 1]) * t,
      a[k + 2] + (b[k + 2] - a[k + 2]) * t,
    );
    qa.fromArray(a, k + 3);
    qb.fromArray(b, k + 3);
    o.quaternion.slerpQuaternions(qa, qb, t);
  }
}
function discardRig(rig: ActorRig) {
  rig.root.removeFromParent();
  rig.mesh.skeleton.dispose();
  for (const m of rig.mesh.material) m.dispose();
}
// All residents exist in this compact table from the first frame, independently of streamed tiles.
// Each profile's poses were baked from the same skin weights and clips used by its close-up rig.
const populationData: Population = JSON.parse(
  new TextDecoder().decode(gunzipSync(from64(packedPopulation))),
);
const residents = populationData.index;
const poseRanges = new Map<string, { start: number; count: number }>();
let poseRows = 0;
for (const [index, name] of populationData.actions.entries()) {
  const count = populationData.frameCounts[index];
  poseRanges.set(name, { start: poseRows, count });
  poseRows += count;
}
function crowdPose(spec: ActorSpec, time: number, state: MotionState) {
  if (spec.m) {
    state.x = spec.m[12];
    state.y = spec.m[13];
    state.z = spec.m[14];
    state.yaw = Math.atan2(spec.m[8], spec.m[10]);
    state.action = spec.seat ? "sit" : "idle";
    state.phase = 0;
    return;
  }
  const clock = (time + spec.phase) % spec.d,
    travelling = spec.a === "walk" || spec.a === "run";
  let phase = clock / spec.d,
    progress = 0.5,
    yaw = spec.yaw;
  if (travelling) {
    const half = spec.leg + spec.turn,
      back = clock >= half,
      local = clock % half;
    const step = Math.min(1, local / spec.leg);
    progress = back ? 1 - step : step;
    yaw +=
      Math.PI *
      ((back ? 1 : 0) + T.MathUtils.smoothstep(local, spec.leg, half));
    phase = (step * spec.cycles) % 1;
  }
  state.x = spec.x + spec.tx * (progress - 0.5) * spec.l;
  state.y = 0.13;
  state.z = spec.z + spec.tz * (progress - 0.5) * spec.l;
  state.yaw = yaw;
  state.action = spec.a;
  state.phase = phase;
}
const actorScene = new T.Scene();
actorScene.add(new T.HemisphereLight("#fffae9", "#a2a896", 1.7));
const actorSun = new T.DirectionalLight("#fff0d7", 2.05);
actorSun.position.set(-65, 95, 45);
actorScene.add(actorSun);
function coarseMaterial(poseTexture: T.DataTexture) {
  return new T.ShaderMaterial({
    glslVersion: T.GLSL3,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    side: T.DoubleSide,
    uniforms: { poses: { value: poseTexture } },
    vertexShader: `
      uniform highp sampler2D poses;
      in float garment;in vec4 motion;in vec3 complexion;in vec3 dye;in vec3 trim;
      out vec3 world;out vec3 tone;
      void main(){
        vec3 centre=(modelViewMatrix*instanceMatrix*vec4(0.,82.,0.,1.)).xyz;
        float depth=-centre.z;
        if(motion.w<.5 || depth< -2.5 || abs(centre.x)>max(0.,depth)/projectionMatrix[0][0]+2.5 || abs(centre.y)>max(0.,depth)/projectionMatrix[1][1]+2.5){
          world=vec3(0.);tone=vec3(0.);gl_Position=vec4(2.,2.,2.,1.);return;
        }
        vec3 a=texelFetch(poses,ivec2(gl_VertexID,int(motion.x)),0).rgb;
        vec3 b=texelFetch(poses,ivec2(gl_VertexID,int(motion.y)),0).rgb;
        vec4 p=modelMatrix*instanceMatrix*vec4(mix(a,b,motion.z),1.);
        world=p.xyz;tone=garment<.5?complexion:garment<1.5?dye:garment<2.5?vec3(.175,.153,.117):garment<3.5?vec3(.082,.069,.054):garment<4.5?vec3(.041,.033,.028):trim;
        gl_Position=projectionMatrix*viewMatrix*p;
      }`,
    fragmentShader: `
      in vec3 world;in vec3 tone;out vec4 finalColour;
      void main(){
        vec3 n=normalize(cross(dFdx(world),dFdy(world)));
        float sun=max(dot(n,normalize(vec3(-65.,95.,45.))),0.);
        vec3 light=mix(vec3(.36,.34,.29),vec3(.79,.80,.72),clamp(n.y*.5+.5,0.,1.))+sun*vec3(.55,.50,.39);
        finalColour=vec4(tone*light,1.);
      }`,
  });
}
const crowdStates = residents.map(() => ({
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  action: "idle",
  phase: 0,
  detail: 0,
}));
const proxyGroups: {
  ids: number[];
  motion: T.InstancedBufferAttribute;
  nearMesh: T.InstancedMesh;
}[] = [];
for (const [profile, template] of populationData.templates.entries()) {
  const ids = [];
  for (let i = 0; i < residents.length; i++)
    if (residents[i].p === profile) ids.push(i);
  if (!ids.length) continue;
  const packed = new Int16Array(from64(template.delta).buffer),
    rgba = new Float32Array(template.n * poseRows * 4);
  for (let j = 0; j < poseRows; j++)
    for (let v = 0; v < template.n; v++)
      for (let k = 0; k < 3; k++) {
        const to = (j * template.n + v) * 4 + k,
          from = (j * template.n + v) * 3 + k;
        rgba[to] = packed[from] / 40 + (j ? rgba[to - template.n * 4] : 0);
      }
  const atlas = new T.DataTexture(
    rgba,
    template.n,
    poseRows,
    T.RGBAFormat,
    T.FloatType,
  );
  atlas.needsUpdate = true;
  const geometry = new T.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(new Float32Array(template.n * 3), 3),
  );
  geometry.setAttribute(
    "garment",
    new T.Uint8BufferAttribute(from64(template.slots), 1),
  );
  geometry.setIndex(
    new T.Uint16BufferAttribute(
      new Uint16Array(from64(template.indices).buffer),
      1,
    ),
  );
  const motion = new T.InstancedBufferAttribute(
    new Float32Array(ids.length * 4),
    4,
  ).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute("motion", motion);
  for (const [key, field, defaultColour] of [
    ["complexion", "s", "#cba382"],
    ["dye", "r", "#768780"],
    ["trim", "t", "#ae977a"],
  ]) {
    const attribute = new T.InstancedBufferAttribute(
      new Float32Array(ids.length * 3),
      3,
    );
    ids.forEach((id, i) => {
      const c = new T.Color(
        residents[id][field as "s" | "r" | "t"] || defaultColour,
      );
      attribute.setXYZ(i, c.r, c.g, c.b);
    });
    geometry.setAttribute(key, attribute);
  }
  const nearMesh = new T.InstancedMesh(
    geometry,
    coarseMaterial(atlas),
    ids.length,
  );
  nearMesh.frustumCulled = false;
  nearMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  actorScene.add(nearMesh);
  proxyGroups.push({ ids, motion, nearMesh });
}
populationData.templates.length = 0;
const personMatrix = new T.Matrix4();
function updateCrowdSilhouettes() {
  for (const group of proxyGroups) {
    for (const [instance, id] of group.ids.entries()) {
      const spec = residents[id],
        s = crowdStates[id];
      const { start, count } =
        poseRanges.get(s.action) || poseRanges.get("idle")!;
      const n = s.phase * count,
        base = Math.floor(n) % count;
      group.motion.setXYZW(
        instance,
        start + base,
        start + ((base + 1) % count),
        n - Math.floor(n),
        s.detail ? 0 : 1,
      );
      personMatrix.makeRotationY(s.yaw);
      const scale = spec.h / 178.5;
      const e = personMatrix.elements;
      for (const j of [0, 2, 5, 8, 10]) e[j] *= scale;
      personMatrix.setPosition(s.x, s.y, s.z);
      group.nearMesh.setMatrixAt(instance, personMatrix);
    }
    group.motion.needsUpdate = true;
    group.nearMesh.instanceMatrix.needsUpdate = true;
  }
}
const retryAfter = new Map();
let priorityIds = new Set<number>();
function selectNearResidents(now: number) {
  const candidates = [];
  for (const [id, state] of crowdStates.entries()) {
    const range = Math.hypot(state.x - player.x, state.z - player.z);
    if (range < 67 && (retryAfter.get(id) || 0) < now)
      candidates.push({ id, priority: range - (priorityIds.has(id) ? 6 : 0) });
  }
  candidates.sort((a, b) => a.priority - b.priority || a.id - b.id);
  priorityIds = new Set(candidates.slice(0, 9).map((c) => c.id));
  for (const id of priorityIds) {
    if (pendingPeople >= 2 || people.size >= 12) break;
    if (!people.has(id)) spawnDetailedCitizen(id, now);
  }
}
async function spawnDetailedCitizen(id: number, now: number) {
  const spec = residents[id],
    owner: PersonSlot = { refs: new Set(), rig: null, lastDemand: now, spec };
  people.set(id, owner);
  pendingPeople++;
  try {
    owner.rig = await createRig(
      spec.p,
      spec.h,
      spec.s,
      spec.r,
      spec.t,
      owner,
      true,
    );
    for (const mat of owner.rig.mesh.material) {
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthTest = mat.depthWrite = true;
    }
    owner.rig.root.visible = false;
    actorScene.add(owner.rig.root);
  } catch (error) {
    console.error(error);
    people.delete(id);
    release(owner);
    retryAfter.set(id, performance.now() + 5000);
  } finally {
    pendingPeople--;
  }
}
const individualClocks = new Float64Array(residents.length);
function updatePeople(now: number, dt: number) {
  for (let i = 0; i < residents.length; i++) {
    const spec = residents[i],
      state = crowdStates[i],
      clock = individualClocks[i],
      previousX = state.x,
      previousZ = state.z;
    crowdPose(spec, clock + dt, state);
    const next = (state.x - player.x) ** 2 + (state.z - player.z) ** 2;
    if (
      clock > 0 &&
      !spec.m &&
      Math.abs(state.y - player.y) < 1.55 &&
      next < 0.55 ** 2 &&
      next < (previousX - player.x) ** 2 + (previousZ - player.z) ** 2
    ) {
      crowdPose(spec, clock, state);
    } else individualClocks[i] += dt;
  }
  crowdCollision.rebuild(
    crowdStates.map((p, i) => ({
      x: p.x,
      z: p.z,
      y: p.y,
      radius: 0.24,
      height: residents[i].h * (residents[i].seat ? 0.62 : 1),
    })),
  );
  if (now > actorUpdate && ready) {
    actorUpdate = now + 200;
    selectNearResidents(now);
  }
  for (const [id, owner] of people) {
    if (!owner.rig) continue;
    const s = crowdStates[id],
      d = Math.hypot(s.x - player.x, s.z - player.z),
      selected = priorityIds.has(id);
    if (selected) owner.lastDemand = now;
    // Select a complete opaque model in one frame. Different enter/exit radii avoid oscillation.
    const rig = owner.rig;
    s.detail = selected && d < (s.detail ? 50 : 37) ? 1 : 0;
    rig.root.visible = Boolean(s.detail);
    if (rig.root.visible) {
      rig.root.position.set(s.x, s.y, s.z);
      rig.root.rotation.y = s.yaw;
      animateRig(rig, s.action, s.phase);
    }
    if (!selected && s.detail === 0 && now - owner.lastDemand > 1150) {
      discardRig(rig);
      release(owner);
      people.delete(id);
    }
  }
  updateCrowdSilhouettes();
}

let loadingPlayer = false;
const playerOwner = { refs: new Set<string>() };
async function requirePlayer() {
  if (player.rig || loadingPlayer) return;
  loadingPlayer = true;
  try {
    player.rig = await createRig(
      3,
      1.7,
      "#cba382",
      "#687e79",
      "#c9af84",
      playerOwner,
    );
    actorScene.add(player.rig.root);
    player.rig.root.visible = !player.first;
  } catch (e) {
    console.error(e);
    setMode(true);
  } finally {
    loadingPlayer = false;
  }
}
function setMode(first: boolean) {
  if (!first) releaseLook();
  player.first = first;
  syncPointerCursor();
  element("#first").setAttribute("aria-pressed", String(first));
  element("#third").setAttribute("aria-pressed", String(!first));
  if (!first) requirePlayer();
  if (player.rig) player.rig.root.visible = !first;
}
function step(dx: number, dz: number) {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const x = player.x,
      z = player.z;
    for (const [a, b] of [
      [dx / n, dz / n],
      [dx / n, 0],
      [0, dz / n],
    ]) {
      if (!a && !b) continue;
      const floor = support(x + a, z + b, player.y);
      if (floor === null) continue;
      player.x = x + a;
      player.z = z + b;
      player.y = floor;
      break;
    }
    moved += Math.hypot(player.x - x, player.z - z);
  }
  return moved;
}
function setCamera() {
  const sx = Math.sin(player.angle),
    sz = Math.cos(player.angle),
    cp = Math.cos(player.pitch),
    sp = Math.sin(player.pitch),
    height = player.y + (1.7 * 166.7) / 178.5;
  if (player.first) {
    camera.position.set(player.x, height, player.z);
    camera.lookAt(player.x + sx * cp, height + sp, player.z + sz * cp);
  } else {
    const pivot = new T.Vector3(player.x, player.y + 1.23, player.z),
      back = new T.Vector3(-sx * cp, 0.24 - sp, -sz * cp).normalize();
    let d = 0.16;
    for (let t = 0.24; t <= 4; t += 0.17) {
      const test = pivot.clone().addScaledVector(back, t),
        col = pointBoxes(test.x, test.z);
      if (!col || test.y < terrainHeight(test.x, test.z) + 0.14) break;
      const [a, ids] = col;
      if (
        ids.some(
          (i) =>
            (a[i] === 0 || a[i] === 4) &&
            test.y > a[i + 7] - 0.12 &&
            test.y < a[i + 8] + 0.12 &&
            covers(a, i, test.x, test.z, 0.14),
        )
      )
        break;
      d = t;
    }
    camera.position.copy(pivot).addScaledVector(back, d);
    camera.lookAt(pivot);
    if (player.rig) player.rig.root.visible = d > 0.5;
  }
  camera.updateMatrixWorld();
}
let last = 0;
function draw(now: number) {
  requestAnimationFrame(draw);
  if (document.hidden) {
    last = 0;
    return;
  }
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  simTime += dt;
  waiting = false;
  plan();
  const axis = (a: string, b: string) =>
    Number(keys.has(a)) - Number(keys.has(b));
  player.angle += axis("ArrowLeft", "ArrowRight") * dt * 1.75;
  const forward = axis("KeyW", "KeyS") + axis("ArrowUp", "ArrowDown"),
    strafe = axis("KeyD", "KeyA"),
    size = Math.hypot(forward, strafe);
  const run =
    character.canRun() && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
  let moved = 0;
  if (size && ready) {
    const sx = Math.sin(player.angle),
      sz = Math.cos(player.angle),
      dx = (sx * forward - sz * strafe) / size,
      dz = (sz * forward + sx * strafe) / size,
      speed = walkingSpeed * (run ? 2.5 : 1);
    moved = step(dx * speed * dt, dz * speed * dt);
    if (moved) player.face = Math.atan2(dx, dz);
  }
  player.action = moved > 0.00001 ? (run ? "run" : "walk") : "idle";
  if (moved) player.phase = (player.phase + moved / (run ? 2.35 : 1.43)) % 1;
  if (player.rig && !player.first) {
    player.rig.root.position.set(player.x, player.y, player.z);
    player.rig.root.rotation.y = player.face;
    animateRig(player.rig, player.action, player.phase);
  }
  if (
    ready &&
    !creations.open() &&
    !civic.open() &&
    !atlas.open() &&
    !character.open() &&
    !settingsOpen()
  )
    character.advance(dt, moved > 0, run);
  civic.update(now);
  updateMap(now);
  setCamera();
  focus.update(now);
  updatePeople(now, dt);
  if (waiting) status.hidden = false;
  drawVisibility(now);
  if (ready) document.body.dataset.ready = "yes";
}
function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  sizeVisibility();
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();
const allowed = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
]);
window.addEventListener("keydown", (e) => {
  if (
    e.altKey ||
    e.ctrlKey ||
    e.metaKey ||
    (e.target === speedControl && e.code.startsWith("Arrow"))
  )
    return;
  if (
    creations.open() ||
    civic.open() ||
    settingsOpen() ||
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.target instanceof HTMLSelectElement
  )
    return;
  if (e.code === "KeyM") {
    e.preventDefault();
    if (!e.repeat) atlas.toggle();
    return;
  }
  if (atlas.open()) return;
  if (e.code === "KeyB") {
    e.preventDefault();
    if (!e.repeat) character.toggle();
    return;
  }
  if (character.open() || document.querySelector("dialog[open]")) return;
  if (e.code === "KeyE") {
    if (!e.repeat) focus.down();
    e.preventDefault();
    return;
  }
  if (!e.repeat && focus.command(e.code)) {
    e.preventDefault();
    return;
  }
  if (/^Digit[1-9]$/.test(e.code)) {
    e.preventDefault();
    character.belt.select(Number(e.code.slice(5)) - 1);
    return;
  }
  if (e.code === "KeyF") {
    e.preventDefault();
    if (!e.repeat) character.belt.activate();
    return;
  }
  if (e.code === "KeyV") {
    e.preventDefault();
    if (!e.repeat) setMode(!player.first);
  }
  if (allowed.has(e.code)) {
    e.preventDefault();
    keys.add(e.code);
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  last = 0;
});
document.addEventListener("visibilitychange", () => {
  keys.clear();
  last = 0;
});
// Mouse lock starts with an explicit click. Touchscreens and restricted embeds support drag-look.

let lockPending = false;
let lockUnavailable = false;
let activeDrag: { id: number; x: number; y: number } | null = null;
let lastPointerType = "mouse";
function syncPointerCursor() {
  const locked = document.pointerLockElement === canvas;
  canvas.classList.toggle("mouse-locked", locked);
}
function releaseLook() {
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  activeDrag = null;
  keys.clear();
}
function rotateLook(dx: number, dy: number) {
  player.angle -= dx * 0.0032;
  player.pitch = T.MathUtils.clamp(player.pitch - dy * 0.0032, -1.14, 1.1);
}
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  lastPointerType = event.pointerType;
  if (document.pointerLockElement === canvas) return;
  if (
    player.first &&
    event.pointerType === "mouse" &&
    !lockUnavailable &&
    canvas.requestPointerLock
  ) {
    if (lockPending) return;
    lockPending = true;
    // Only request lock during the user's gesture, including when reacquiring after Esc.
    try {
      const request = canvas.requestPointerLock();
      if (request)
        request.catch(() => {
          lockPending = false;
          lockUnavailable = true;
          syncPointerCursor();
        });
    } catch {
      lockPending = false;
      lockUnavailable = true;
      syncPointerCursor();
    }
  }
  // Keep the initiating drag usable if pointer lock is denied by the host.
  activeDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {}
  syncPointerCursor();
});
document.addEventListener("pointerlockchange", () => {
  lockPending = false;
  activeDrag = null;
  keys.clear();
  syncPointerCursor();
});
document.addEventListener("pointerlockerror", () => {
  lockPending = false;
  lockUnavailable = true;
  syncPointerCursor();
});
document.addEventListener("mousemove", (event) => {
  if (player.first && document.pointerLockElement === canvas)
    rotateLook(event.movementX, event.movementY);
});
canvas.addEventListener("pointermove", (event) => {
  if (
    document.pointerLockElement === canvas ||
    activeDrag?.id !== event.pointerId
  )
    return;
  rotateLook(event.clientX - activeDrag.x, event.clientY - activeDrag.y);
  activeDrag.x = event.clientX;
  activeDrag.y = event.clientY;
});
canvas.addEventListener("lostpointercapture", () => {
  activeDrag = null;
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") releaseLook();
});
window.addEventListener("blur", releaseLook);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseLook();
});
syncPointerCursor();

element("#first").onclick = () => setMode(true);
element("#third").onclick = () => setMode(false);
for (const el of document.querySelectorAll<HTMLButtonElement>("[data-key]")) {
  el.onpointerdown = (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    keys.add(el.dataset.key!);
  };
  el.onlostpointercapture = () => keys.delete(el.dataset.key!);
}
const character = characterPanel(() => {
  releaseLook();
  keys.clear();
});
const atlas = cityMap(player, () => {
  releaseLook();
  keys.clear();
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 2 && !atlas.open() && !character.open() && !settingsOpen()) {
    e.preventDefault();
    character.belt.activate();
  }
});
canvas.addEventListener(
  "wheel",
  (e) => {
    if (!atlas.open() && !character.open() && !settingsOpen() && e.deltaY) {
      e.preventDefault();
      character.belt.scroll(Math.sign(e.deltaY));
    }
  },
  { passive: false },
);
const creations = studio(scene, player, () => {
  releaseLook();
  keys.clear();
});
const civic = civicPanel(
  scene,
  player,
  () => {
    releaseLook();
    keys.clear();
  },
  async (id, x, z, yaw) => {
    const owner = { refs: new Set<string>() };
    try {
      const rig = await createRig(
        id % 20,
        1.66,
        "#b38d6d",
        "#697969",
        "#af996f",
        owner,
        true,
      );
      rig.root.position.set(x, terrainHeight(x, z), z);
      rig.root.rotation.y = yaw;
      animateRig(rig, "idle", 0.2);
      actorScene.add(rig.root);
      return () => {
        discardRig(rig);
        release(owner);
      };
    } catch (e) {
      release(owner);
      throw e;
    }
  },
);
const updateMap = minimap(player);
const settingsOpen = modelSettings(() => {
  releaseLook();
  keys.clear();
});
const editGate = gateEditor(() => {
  releaseLook();
  keys.clear();
});
generationLog();
const focus = focusMode(
  scene,
  camera,
  player,
  () => civic.interact(),
  (edit, name) => creations.newItem(edit, name),
  (ctx) => {
    const gate = /^home:(\d+):gate$/.exec(ctx.target.id);
    if (gate) void editGate(Number(gate[1]));
    else creations.fromSelection(ctx);
  },
  () =>
    !!document.querySelector("dialog[open]") ||
    character.open() ||
    settingsOpen() ||
    document.hidden,
);
initHorizon().catch((error) => {
  console.error(error);
  setTimeout(() => initHorizon().catch(console.error), 2500);
});
requestAnimationFrame(draw);
