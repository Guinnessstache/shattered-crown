"""Build game-ready animated heroes (GLB) from Mixamo characters + animation packs.

    python build_mixamo_hero.py -- <art_dir> <models_dir> [hero_key ...]

<art_dir> is art-source/mixamo; <models_dir> is public/models. Heroes and their clips are listed in
mixamo_heroes.json next to this script. Needs Blender's Python module (`pip install bpy==5.2.2`,
Python 3.13) or run inside Blender: blender -b -P build_mixamo_hero.py -- ...

For each hero it:
- imports the character and drops prop meshes (the game attaches its own weapons);
- imports each clip, renames it to the game's action name; clips borrowed from another
  character's pack get their hip motion rescaled to this character's hip height;
- measures walk/run ground speed, then strips forward/sideways root motion so clips play in
  place (the game moves the hero); death keeps its fall;
- rebuilds every material as glTF PBR: colour, normal, emissive and alpha kept; the Mixamo
  specular map becomes roughness/metal; textures are downsized and written as WebP;
- exports one Draco-compressed GLB and records height, speeds and clip trims in manifest.json.
The raw Mixamo files stay in art-source/ (git-ignored); only the built GLBs ship.
"""
import bpy, os, sys, json, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ART = argv[0] if argv else 'art-source/mixamo'
MODELS = argv[1] if len(argv) > 1 else 'public/models'
CFG = json.load(open(os.path.join(HERE, 'mixamo_heroes.json')))
ONLY = argv[2:] or [k for k in CFG if not k.startswith('_')]
KEEP_ROOT = {'death'}
import tempfile
TMP = tempfile.mkdtemp(prefix='mixamo_')
HIPS = 'mixamorig:Hips'


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


def hips_height(fbx):
    """Rest height of the hips (metres) of the character in an FBX."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=fbx, use_anim=False)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    return (arm.matrix_world @ arm.data.bones[HIPS].head_local).z


def pack_char(pack_dir):
    """The character file that came with a pack (the one a hero in the config uses)."""
    for k, h in CFG.items():
        if not k.startswith('_') and os.path.dirname(h['char']) == pack_dir:
            return os.path.join(ART, h['char'])
    return None


def process_materials(meshes):
    mats = {m for o in meshes for m in o.data.materials if m}
    imgs = {}
    for mat in mats:
        for n in mat.node_tree.nodes if mat.use_nodes else []:
            if n.type == 'TEX_IMAGE' and n.image:
                imgs[n.image.name] = n.image
    biggest = max((im.size[0] for im in imgs.values()), default=1024)
    done = set()
    for im in imgs.values():
        if im.name in done or im.size[0] == 0:
            continue
        done.add(im.name)
        s = im.size[0]
        t = min(1024, s) if s >= biggest else max(256, min(512, s // 2))
        if t < s:
            im.scale(t, t)
    for mat in mats:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree; N = nt.nodes; L = nt.links
        bsdf = next((n for n in N if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        spec_node = None
        for l in list(L):
            if l.to_node == bsdf and l.to_socket.name.startswith('Specular') and l.from_node.type == 'TEX_IMAGE':
                spec_node = l.from_node
                L.remove(l)
        bsdf.inputs['Specular IOR Level'].default_value = 0.5
        if spec_node:
            sp = spec_node.image
            w, h = sp.size
            px = np.empty(w * h * 4, dtype=np.float32); sp.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            s = px[:, :3].mean(axis=1)
            orm = np.ones_like(px)
            orm[:, 1] = np.clip(0.95 - s * 1.1, 0.22, 0.92)
            orm[:, 2] = np.where(s > 0.38, 1.0, np.clip((s - 0.22) / 0.16, 0, 1))
            oi = bpy.data.images.new(f'{sp.name}_orm', w, h, alpha=False)
            oi.pixels.foreach_set(orm.ravel())
            # a generated image must be written out, or the exporter sees an empty (black) one
            oi.filepath_raw = os.path.join(TMP, f'{mat.name}_orm.png'); oi.file_format = 'PNG'; oi.save()
            oi.colorspace_settings.name = 'Non-Color'
            tn = N.new('ShaderNodeTexImage'); tn.image = oi
            sep = N.new('ShaderNodeSeparateColor'); L.new(tn.outputs['Color'], sep.inputs['Color'])
            L.new(sep.outputs['Green'], bsdf.inputs['Roughness']); L.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        else:
            bsdf.inputs['Roughness'].default_value = 0.62
            bsdf.inputs['Metallic'].default_value = 0.0
        if any(l.to_node == bsdf and l.to_socket.name == 'Emission Color' for l in L):
            bsdf.inputs['Emission Strength'].default_value = 1.0
        # alpha-cut hair / lashes (exported as MASK)
        if any(l.to_node == bsdf and l.to_socket.name == 'Alpha' for l in L):
            try:
                mat.surface_render_method = 'DITHERED'
            except Exception:
                pass


def build(key, h):
    print('==', key)
    src_h = {}
    for clip in h['clips'].values():
        d = os.path.dirname(clip)
        if d != os.path.dirname(h['char']) and d not in src_h:
            src_h[d] = hips_height(pack_char(d))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.fbx(filepath=os.path.join(ART, h['char']), use_anim=False)
    for name in h.get('drop', []):
        o = bpy.data.objects.get(name)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    if arm.animation_data:
        arm.animation_data.action = None
    else:
        arm.animation_data_create()
    unit = arm.scale.x  # Mixamo rigs are in centimetres under a 0.01 scale
    my_hips = (arm.matrix_world @ arm.data.bones[HIPS].head_local).z
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    import mathutils
    height = max((o.matrix_world @ mathutils.Vector(c)).z for o in meshes for c in o.bound_box)
    speeds = {}
    for game, clip in h['clips'].items():
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=os.path.join(ART, clip + '.fbx'), use_anim=True)
        new = [o for o in bpy.data.objects if o not in before]
        act = next(o.animation_data.action for o in new if o.type == 'ARMATURE' and o.animation_data and o.animation_data.action)
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        act.name = game
        act.use_fake_user = True
        d = os.path.dirname(clip)
        k = my_hips / src_h[d] if d in src_h else 1.0
        fr = act.frame_range
        dist = [0, 0, 0]
        for fc in fcurves(act):
            if fc.data_path == f'pose.bones["{HIPS}"].location':
                if k != 1.0:
                    for kp in fc.keyframe_points:
                        kp.co[1] *= k; kp.handle_left[1] *= k; kp.handle_right[1] *= k
                dist[fc.array_index] = fc.evaluate(fr[1]) - fc.evaluate(fr[0])
                if game not in KEEP_ROOT and fc.array_index in (0, 2):
                    v0 = fc.keyframe_points[0].co[1]
                    for kp in fc.keyframe_points:
                        kp.co[1] = v0; kp.handle_left[1] = v0; kp.handle_right[1] = v0
        if game in ('walk', 'run'):
            secs = (fr[1] - fr[0]) / 30
            speeds[game] = round(math.hypot(dist[0], dist[2]) * unit / max(secs, 1e-3), 2)
        tr = arm.animation_data.nla_tracks.new(); tr.name = game
        st = tr.strips.new(game, int(fr[0]), act)
        try:
            st.action_slot = act.slots[0]
        except Exception:
            pass
        tr.mute = True
    keep = set(h['clips'])
    for a in [a for a in bpy.data.actions if a.name not in keep]:
        bpy.data.actions.remove(a)
    process_materials(meshes)
    out = os.path.join(MODELS, f'{key}.glb')
    for o in bpy.data.objects:
        o.select_set(o in meshes or o == arm)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_image_format='WEBP', export_image_quality=82,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_optimize_animation_size=True, export_anim_single_armature=True,
        export_skins=True, export_def_bones=False, export_yup=True,
    )
    shots = {c: {'from': v[0], 'to': v[1], 'min': v[2]} for c, v in h.get('shots', {}).items()}
    print('BUILT', key, os.path.getsize(out), 'height', round(height, 2), 'speeds', speeds)
    return {'file': f'{key}.glb', 'height': round(height, 2), 'speeds': speeds, 'shots': shots}


results = {k: build(k, CFG[k]) for k in ONLY}
mf = os.path.join(MODELS, 'manifest.json')
man = json.load(open(mf)) if os.path.exists(mf) else {}
for k, r in results.items():
    for sec in ('models', 'rigs', 'heights', 'speeds', 'shots'):
        man.setdefault(sec, {})
    man['models'][k] = r['file']; man['rigs'][k] = 'skinned'; man['heights'][k] = r['height']
    man['speeds'][k] = r['speeds']
    if r['shots']:
        man['shots'][k] = r['shots']
    else:
        man['shots'].pop(k, None)
json.dump(man, open(mf, 'w'), indent=2)
print('manifest updated', list(results))
