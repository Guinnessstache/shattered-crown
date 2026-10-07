"""Build a game-ready animated hero (GLB) from a Mixamo character + animation pack.

Run headless:  python build_mixamo_hero.py -- <pack_dir> <out.glb>
(with Blender's Python module `bpy` installed, or inside Blender: blender -b -P build_mixamo_hero.py -- ...)

- Imports the character FBX and the chosen clips, renames them to the game's action names.
- Strips sideways/forward root motion so every clip plays in place (the game moves the hero).
- Rebuilds the material as PBR: colour + normal + ORM (roughness/metal derived from the
  Mixamo specular map), downsized to 1024px WebP.
- Exports one Draco-compressed GLB with every clip as a named animation.
The raw Mixamo files stay in art-source/ (not in git); only the built GLB ships with the game.
"""
import bpy, os, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PACK = argv[0] if argv else 'art-source/mixamo/sns'
OUT = argv[1] if len(argv) > 1 else 'public/models/hero_knight_mx.glb'
CHAR = 'Knight_D_Pelegrini.fbx'
TEX = 1024

# game action name -> pack clip
CLIPS = {
    'idle': 'sword_and_shield_idle',
    'walk': 'sword_and_shield_walk',
    'run': 'sword_and_shield_run',
    'swing0': 'sword_and_shield_attack_4',
    'swing1': 'sword_and_shield_slash',
    'swing2': 'sword_and_shield_slash_3',
    'cleave': 'sword_and_shield_attack_2',
    'bash': 'sword_and_shield_block',
    'warcry': 'sword_and_shield_power_up',
    'cast': 'sword_and_shield_casting_2',
    'hit': 'sword_and_shield_impact',
    'death': 'sword_and_shield_death',
    'leap': 'sword_and_shield_slash_4',
}
KEEP_ROOT = {'death'}  # keep the fall's travel; everything else plays in place


def fcurves(a):
    if hasattr(a, 'fcurves') and len(a.fcurves):
        return list(a.fcurves)
    out = []
    for L in a.layers:
        for s in L.strips:
            for sl in a.slots:
                cb = s.channelbag(sl)
                if cb:
                    out += list(cb.fcurves)
    return out


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.fbx(filepath=os.path.join(PACK, CHAR), use_anim=False)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.name = 'KnightRig'
if arm.animation_data:
    arm.animation_data.action = None
else:
    arm.animation_data_create()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# ---- clips
for game, clip in CLIPS.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(PACK, clip + '.fbx'), use_anim=True)
    new = [o for o in bpy.data.objects if o not in before]
    act = next(o.animation_data.action for o in new if o.type == 'ARMATURE' and o.animation_data and o.animation_data.action)
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    act.name = game
    act.use_fake_user = True
    if game not in KEEP_ROOT:
        for fc in fcurves(act):
            if fc.data_path == 'pose.bones["mixamorig:Hips"].location' and fc.array_index in (0, 2):
                v0 = fc.keyframe_points[0].co[1]
                for k in fc.keyframe_points:
                    k.co[1] = v0; k.handle_left[1] = v0; k.handle_right[1] = v0
    tr = arm.animation_data.nla_tracks.new()
    tr.name = game
    st = tr.strips.new(game, int(act.frame_range[0]), act)
    try:
        st.action_slot = act.slots[0]
    except Exception:
        pass
    tr.mute = True
for a in [a for a in bpy.data.actions if a.name not in CLIPS]:
    bpy.data.actions.remove(a)

# ---- textures: colour, normal, ORM from the specular map
src = {}
for im in bpy.data.images:
    base = os.path.basename(im.filepath).lower()
    for k in ('diffuse', 'normal', 'specular'):
        if k in base:
            src[k] = im
tmp = os.path.join(os.path.dirname(os.path.abspath(OUT)), '_tex')
os.makedirs(tmp, exist_ok=True)
paths = {}
for k, im in src.items():
    im.scale(TEX, TEX)
    p = os.path.join(tmp, f'knight_{k}.png')
    im.filepath_raw = p; im.file_format = 'PNG'; im.save()
    paths[k] = p
# ORM: R=1 (no AO), G=roughness (shiny where specular is bright), B=metal (bright, unsaturated spec)
spec = src['specular']
px = list(spec.pixels)
orm = bpy.data.images.new('knight_orm', TEX, TEX, alpha=False)
out = [0.0] * len(px)
for i in range(0, len(px), 4):
    s = (px[i] + px[i + 1] + px[i + 2]) / 3
    out[i] = 1.0
    out[i + 1] = max(0.22, min(0.92, 0.95 - s * 1.1))
    out[i + 2] = 1.0 if s > 0.38 else max(0.0, (s - 0.22) / 0.16)
    out[i + 3] = 1.0
orm.pixels = out
orm.filepath_raw = os.path.join(tmp, 'knight_orm.png'); orm.file_format = 'PNG'; orm.save()

mat = bpy.data.materials.new('knight_pbr')
mat.use_nodes = True
nt = mat.node_tree; N = nt.nodes; L = nt.links
bsdf = N['Principled BSDF']
def tex(img, non_color=False):
    n = N.new('ShaderNodeTexImage'); n.image = img
    if non_color: img.colorspace_settings.name = 'Non-Color'
    return n
tc = tex(src['diffuse']); L.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
tn = tex(src['normal'], True); nm = N.new('ShaderNodeNormalMap'); L.new(tn.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
to = tex(orm, True); sep = N.new('ShaderNodeSeparateColor'); L.new(to.outputs['Color'], sep.inputs['Color'])
L.new(sep.outputs['Green'], bsdf.inputs['Roughness']); L.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
for o in meshes:
    o.data.materials.clear(); o.data.materials.append(mat)

# ---- export
for o in bpy.data.objects:
    o.select_set(o in meshes or o == arm)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_image_format='WEBP', export_image_quality=82,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
    export_optimize_animation_size=True, export_anim_single_armature=True,
    export_skins=True, export_def_bones=False, export_yup=True,
)
print('BUILT', OUT, os.path.getsize(OUT))
