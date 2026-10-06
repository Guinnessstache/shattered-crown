# Builds the game's character models in Blender and exports them as .glb files into public/models.
#
# Run inside Blender (Scripting tab → open this file → Run Script), or from a terminal:
#   blender --background --python tools/blender/build_models.py
#
# Each model is a hierarchy of empties ("joints") named the way the game's animator expects
# (hips, torso, head, armL/armR, foreL/foreR, handL/handR, legL/legR, shinL/shinR), with meshes
# parented to them. Blender is Z-up and the characters face -Y; the glTF exporter converts to the
# game's Y-up, +Z-forward space.
#
# Material names matter: the game swaps "steel", "iron", "leather", "cloth", "bone", "wood", "gold"
# for its own textured versions, recolors "armor"/"trim" by gear tier, and shows/hides objects named
# helm_t0..helm_t5, hair, cape and weapon.
import bpy, bmesh, math, os, json
from mathutils import Matrix, Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() and __file__ else None
OUT = os.environ.get('SC_MODELS_OUT') or (os.path.join(HERE, '..', '..', 'public', 'models') if HERE else None)

# ---------------------------------------------------------------- scene helpers
def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)

MATS = {}
def mat(name, color, metal=0.0, rough=0.7, emit=None):
    key = (name, color, metal, rough, emit)
    if key in MATS and MATS[key].name in bpy.data.materials: return MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    r, g, bl = ((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    b.inputs['Base Color'].default_value = (lin(r), lin(g), lin(bl), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit is not None:
        er, eg, eb = ((emit >> 16) & 255) / 255, ((emit >> 8) & 255) / 255, (emit & 255) / 255
        b.inputs['Emission Color'].default_value = (lin(er), lin(eg), lin(eb), 1)
        b.inputs['Emission Strength'].default_value = 3.0
    m.name = name
    MATS[key] = m
    return m

def joint(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(e)
    if parent: e.parent = parent
    e.location = loc
    return e

def obj_from_bm(name, bm, parent, material, smooth=True, mods=()):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.parent = parent
    me.materials.append(material)
    for kind, args in mods:
        md = o.modifiers.new(kind, kind)
        for k, v in args.items(): setattr(md, k, v)
    return o

def xf(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    M = Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1))
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)

# Primitive builders (Blender coords: Z up, character faces -Y, its left is +X)
def box(name, parent, m, size, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.012, smooth=False):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    xf(bm, loc, rot, size)
    mods = [('BEVEL', {'width': bevel, 'segments': 2, 'limit_method': 'ANGLE'})] if bevel else []
    return obj_from_bm(name, bm, parent, m, smooth=smooth, mods=mods + ([('WEIGHTED_NORMAL', {'keep_sharp': True})] if bevel else []))

def cyl(name, parent, m, r1, r2, h, loc=(0, 0, 0), rot=(0, 0, 0), seg=10, scale=(1, 1, 1), sub=0, caps=True):
    # Cylinder along Z, from z=0 (radius r1) down to z=-h (radius r2): hangs from its joint.
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r2, radius2=r1, depth=h)
    xf(bm, (0, 0, -h / 2))
    xf(bm, loc, rot, scale)
    mods = [('SUBSURF', {'levels': sub, 'render_levels': sub})] if sub else []
    return obj_from_bm(name, bm, parent, m, mods=mods)

def sphere(name, parent, m, r, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), seg=12, rings=8, sub=0, cut=None):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    if cut is not None:  # keep only the part above z = cut * r (dome)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut * r - 1e-4], context='VERTS')
    xf(bm, loc, rot, scale)
    mods = [('SUBSURF', {'levels': sub, 'render_levels': sub})] if sub else []
    if cut is not None: mods.append(('SOLIDIFY', {'thickness': 0.012, 'offset': -1}))
    return obj_from_bm(name, bm, parent, m, mods=mods)

def lathe(name, parent, m, profile, loc=(0, 0, 0), rot=(0, 0, 0), seg=14, scale=(1, 1, 1), sub=0, angle=math.tau):
    # profile: [(radius, z), ...] revolved around Z
    bm = bmesh.new()
    rings = []
    full = abs(angle - math.tau) < 1e-6
    n = seg if full else seg + 1
    for r, z in profile:
        ring = []
        for i in range(n):
            a = angle * i / seg
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for j in range(len(rings) - 1):
        for i in range(seg):
            a, b = rings[j][i], rings[j][(i + 1) % n]
            c, d = rings[j + 1][(i + 1) % n], rings[j + 1][i]
            try: bm.faces.new((a, b, c, d))
            except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    xf(bm, loc, rot, scale)
    mods = [('SUBSURF', {'levels': sub, 'render_levels': sub})] if sub else []
    return obj_from_bm(name, bm, parent, m, mods=mods)

def extrude_shape(name, parent, m, pts, depth, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.006):
    # 2D outline in the XZ plane, extruded along Y
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    back = [bm.verts.new((x, depth / 2, z)) for x, z in pts]
    bm.faces.new(front[::-1]); bm.faces.new(back)
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    xf(bm, loc, rot)
    return obj_from_bm(name, bm, parent, m, smooth=False, mods=[('BEVEL', {'width': bevel, 'segments': 1})] if bevel else [])

# ---------------------------------------------------------------- humanoid skeleton
def humanoid(key, hipZ=0.95, neck=0.62, sh=0.27, ua=0.32, fa=0.30, hw=0.12, thigh=0.45, shin=0.45):
    root = joint(key)
    hips = joint('hips', root, (0, 0, hipZ))
    torso = joint('torso', hips, (0, 0, 0.05))
    head = joint('head', torso, (0, 0, neck))
    armL = joint('armL', torso, (sh, 0, neck - 0.08)); armR = joint('armR', torso, (-sh, 0, neck - 0.08))
    foreL = joint('foreL', armL, (0, 0, -ua)); foreR = joint('foreR', armR, (0, 0, -ua))
    handL = joint('handL', foreL, (0, -0.02, -fa)); handR = joint('handR', foreR, (0, -0.02, -fa))
    legL = joint('legL', hips, (hw, 0, -0.02)); legR = joint('legR', hips, (-hw, 0, -0.02))
    shinL = joint('shinL', legL, (0, 0, -thigh)); shinR = joint('shinR', legR, (0, 0, -thigh))
    return dict(root=root, hips=hips, torso=torso, head=head, armL=armL, armR=armR, foreL=foreL, foreR=foreR,
                handL=handL, handR=handR, legL=legL, legR=legR, shinL=shinL, shinR=shinR,
                d=dict(ua=ua, fa=fa, thigh=thigh, shin=shin, sh=sh, neck=neck))

# ---------------------------------------------------------------- the knight
def build_knight():
    J = humanoid('hero_knight')
    d = J['d']
    armor = mat('armor', 0xb8bcc4, 0.8, 0.35)
    trim = mat('trim', 0xd0b060, 0.85, 0.3)
    mail = mat('iron', 0x8a8c90, 0.7, 0.55)
    cloth = mat('cloth', 0xa02028, 0.0, 0.9)
    leather = mat('leather', 0x5a3a22, 0.0, 0.8)
    skin = mat('skin', 0xd8a888, 0.0, 0.65)
    hair = mat('hairmat', 0x4a2c18, 0.0, 0.9)
    dark = mat('visor', 0x050505, 0.0, 1.0)
    T = J['torso']
    # Breastplate: a lathed, slightly flattened barrel with a ridge
    lathe('chest', T, armor, [(0.13, 0.12), (0.2, 0.16), (0.235, 0.3), (0.25, 0.44), (0.23, 0.56), (0.16, 0.62), (0.08, 0.64)], scale=(1, 0.72, 1), seg=16, sub=1)
    box('ridge', T, trim, (0.03, 0.03, 0.34), loc=(0, -0.185, 0.42), rot=(0.12, 0, 0), bevel=0.008)
    # Mail skirt + belt
    lathe('mailskirt', T, mail, [(0.2, 0.16), (0.22, 0.04), (0.25, -0.16)], scale=(1, 0.8, 1), seg=14)
    lathe('belt', T, leather, [(0.215, 0.06), (0.22, 0.12)], scale=(1, 0.78, 1), seg=14)
    box('buckle', T, trim, (0.08, 0.02, 0.06), loc=(0, -0.175, 0.09), bevel=0.005)
    # Tabard front and back
    for nm, y in (('tabard', -0.17), ('tabardB', 0.165)):
        extrude_shape(nm, T, cloth, [(-0.13, 0.5), (0.13, 0.5), (0.15, -0.2), (0.05, -0.27), (0, -0.22), (-0.05, -0.27), (-0.15, -0.2)], 0.02, loc=(0, y, 0), rot=(0.06 if y < 0 else -0.06, 0, 0))
    box('crest', T, trim, (0.08, 0.01, 0.1), loc=(0, -0.185, 0.32), rot=(0, 0.785, 0), bevel=0.004)
    # Gorget
    lathe('gorget', T, armor, [(0.1, 0.58), (0.13, 0.62), (0.1, 0.68)], seg=12)
    # Pauldrons: layered domes
    for side, A in ((1, J['armL']), (-1, J['armR'])):
        sphere('pauldron', A, armor, 0.14, loc=(side * 0.03, 0, 0.02), scale=(1.15, 1.05, 0.8), cut=-0.1, seg=14, rings=8)
        sphere('pauldron2', A, armor, 0.13, loc=(side * 0.05, 0, -0.06), scale=(1.1, 1.0, 0.6), cut=-0.1, seg=14, rings=8)
        lathe('pauldtrim', A, trim, [(0.155, -0.005), (0.16, 0.01)], loc=(side * 0.03, 0, 0.0), scale=(1.15, 1.05, 1), seg=14)
    # Arms: mail upper, armored vambrace with elbow cop
    for side, A, F, H in ((1, J['armL'], J['foreL'], J['handL']), (-1, J['armR'], J['foreR'], J['handR'])):
        cyl('upperarm', A, mail, 0.068, 0.06, d['ua'], seg=10)
        sphere('elbow', F, armor, 0.07, scale=(1, 1, 0.9), seg=10, rings=6)
        cyl('vambrace', F, armor, 0.064, 0.055, d['fa'] - 0.02, seg=10, sub=0)
        lathe('cuff', F, armor, [(0.058, -d['fa'] + 0.08), (0.075, -d['fa'] + 0.03), (0.07, -d['fa'] + 0.01)], seg=10)
        box('gauntlet', H, armor, (0.09, 0.1, 0.11), loc=(0, 0, -0.03), bevel=0.015)
        box('fingers', H, leather, (0.085, 0.09, 0.06), loc=(0, -0.01, -0.1), rot=(0.3, 0, 0), bevel=0.01)
    # Legs: armored thighs (cuisses), knee cops, greaves and sabatons
    for side, L, S in ((1, J['legL'], J['shinL']), (-1, J['legR'], J['shinR'])):
        cyl('thigh', L, mail, 0.09, 0.075, d['thigh'], seg=10)
        cyl('cuisse', L, armor, 0.095, 0.08, d['thigh'] * 0.7, loc=(0, -0.012, -0.04), scale=(1, 0.85, 1), seg=10)
        sphere('knee', S, armor, 0.075, loc=(0, -0.03, 0), scale=(1, 0.9, 1.1), seg=10, rings=6)
        cyl('greave', S, armor, 0.072, 0.06, d['shin'] - 0.04, seg=10)
        box('sabaton', S, armor, (0.12, 0.24, 0.08), loc=(0, -0.05, -d['shin'] + 0.02), bevel=0.02)
        box('sole', S, leather, (0.12, 0.25, 0.025), loc=(0, -0.05, -d['shin'] - 0.025), bevel=0.006)
    # Head
    H = J['head']
    cyl('neck', H, skin, 0.06, 0.065, 0.1, loc=(0, 0, 0.08), seg=8)
    sphere('face', H, skin, 0.125, loc=(0, -0.01, 0.17), scale=(0.88, 0.95, 1.08), seg=14, rings=10, sub=1)
    sphere('nose', H, skin, 0.025, loc=(0, -0.13, 0.17), scale=(0.8, 1, 1.3), seg=6, rings=4)
    sphere('beard', H, hair, 0.1, loc=(0, -0.05, 0.09), scale=(1.0, 0.8, 0.7), seg=10, rings=6)
    for sx in (-1, 1):
        sphere('eye', H, dark, 0.014, loc=(sx * 0.042, -0.112, 0.19), seg=6, rings=4)
    sphere('hair', H, hair, 0.135, loc=(0, 0.01, 0.2), scale=(1, 1.02, 0.9), cut=-0.05, seg=14, rings=8)
    # Helm variants by tier
    def helm(t):
        g = joint(f'helm_t{t}', H, (0, 0, 0))
        if t == 0:
            sphere('cap', g, leather, 0.15, loc=(0, 0.005, 0.18), cut=0.0, seg=14, rings=8)
            lathe('capband', g, leather, [(0.152, 0.17), (0.156, 0.2)], seg=14)
        elif t == 1:
            lathe('helm', g, armor, [(0.16, 0.15), (0.155, 0.22), (0.13, 0.31), (0.07, 0.35), (0.0, 0.36)], seg=16)
            box('nasal', g, armor, (0.03, 0.02, 0.13), loc=(0, -0.155, 0.17), bevel=0.006)
        else:
            lathe('helm', g, armor, [(0.155, 0.04), (0.16, 0.15), (0.16, 0.24), (0.13, 0.32), (0.06, 0.36), (0.0, 0.365)], seg=16)
            box('slit', g, dark, (0.2, 0.02, 0.022), loc=(0, -0.152, 0.19), bevel=0)
            box('breaths', g, dark, (0.06, 0.02, 0.05), loc=(0.07, -0.152, 0.11), bevel=0)
            box('visorridge', g, trim, (0.025, 0.03, 0.26), loc=(0, -0.16, 0.2), bevel=0.006)
            lathe('helmband', g, trim, [(0.162, 0.235), (0.165, 0.255)], seg=16)
            if t >= 3:
                for sx in (-1, 1):
                    extrude_shape('wing', g, trim, [(0, 0), (0.05, 0.02), (0.16, 0.16), (0.09, 0.07), (0.15, 0.2), (0.03, 0.06)], 0.015, loc=(sx * 0.15, 0.02, 0.24), rot=(0, 0, 0 if sx > 0 else math.pi))
            if t >= 4:
                box('crestfin', g, trim, (0.025, 0.28, 0.08), loc=(0, 0.02, 0.38), bevel=0.008)
            if t >= 5:
                for i in range(5):
                    a = -0.8 + i * 0.4
                    cyl('spike', g, trim, 0.0, 0.02, 0.1, loc=(math.sin(a) * 0.12, -math.cos(a) * 0.08 + 0.02, 0.42), rot=(math.pi, 0, 0), seg=6)
        g.hide_set(False)
        return g
    for t in range(6): helm(t)
    # Cape (shown at higher armor tiers)
    cape = extrude_shape('cape', T, mat('capemat', 0x7a1018, 0, 0.95), [(-0.2, 0.6), (0.2, 0.6), (0.27, -0.35), (0, -0.4), (-0.27, -0.35)], 0.012, loc=(0, 0.2, 0), rot=(-0.12, 0, 0))
    return J['root']

# ---------------------------------------------------------------- skeleton warrior
def build_skeleton():
    J = humanoid('skeleton', sh=0.24, ua=0.3, fa=0.28)
    d = J['d']
    bone = mat('bone', 0xe0d4b8, 0, 0.75)
    rust = mat('rustiron', 0x7a5a40, 0.5, 0.75)
    eye = mat('eyeglow', 0x60c0ff, 0, 0.5, emit=0x60c0ff)
    T = J['torso']
    cyl('spine', T, bone, 0.028, 0.03, 0.58, loc=(0, 0.04, 0.6), seg=6)
    for i in range(5):
        z = 0.52 - i * 0.075; r = 0.15 - i * 0.012
        lathe(f'rib{i}', T, bone, [(r, z), (r + 0.004, z + 0.022)], loc=(0, 0, 0), scale=(1, 0.75, 1), seg=14, angle=math.pi * 1.55, rot=(0, 0, math.pi * 0.72))
    box('sternum', T, bone, (0.04, 0.02, 0.24), loc=(0, -0.11, 0.42), bevel=0.008)
    lathe('pelvis', J['hips'], bone, [(0.06, -0.06), (0.14, 0.0), (0.13, 0.06)], scale=(1, 0.7, 1), seg=10)
    sphere('clav', T, bone, 0.025, loc=(0, -0.02, 0.56), scale=(9, 1, 1), seg=6, rings=4)
    for side, A, F, H in ((1, J['armL'], J['foreL'], J['handL']), (-1, J['armR'], J['foreR'], J['handR'])):
        sphere('shoulderball', A, bone, 0.045)
        cyl('humerus', A, bone, 0.024, 0.02, d['ua'], seg=6)
        sphere('elbowk', F, bone, 0.03)
        cyl('radius', F, bone, 0.02, 0.016, d['fa'], loc=(0.012, 0, 0), seg=5)
        cyl('ulna', F, bone, 0.018, 0.016, d['fa'], loc=(-0.012, 0, 0), seg=5)
        box('handbones', H, bone, (0.06, 0.03, 0.09), loc=(0, 0, -0.03), bevel=0.01)
    for side, L, S in ((1, J['legL'], J['shinL']), (-1, J['legR'], J['shinR'])):
        cyl('femur', L, bone, 0.03, 0.026, d['thigh'], seg=6)
        sphere('kneecap', S, bone, 0.035, loc=(0, -0.02, 0))
        cyl('tibia', S, bone, 0.026, 0.02, d['shin'], seg=6)
        box('footbones', S, bone, (0.07, 0.17, 0.035), loc=(0, -0.04, -d['shin']), bevel=0.01)
    H = J['head']
    cyl('neckbones', H, bone, 0.02, 0.022, 0.1, loc=(0, 0.02, 0.09), seg=6)
    lathe('skull', H, bone, [(0.0, 0.07), (0.08, 0.09), (0.12, 0.15), (0.125, 0.21), (0.1, 0.27), (0.05, 0.3), (0.0, 0.305)], scale=(0.9, 1.08, 1), seg=14, sub=1)
    box('jaw', H, bone, (0.12, 0.09, 0.05), loc=(0, -0.06, 0.07), bevel=0.02)
    for sx in (-1, 1):
        sphere('socket', H, mat('socket', 0x050302, 0, 1), 0.032, loc=(sx * 0.045, -0.1, 0.18), scale=(1, 0.6, 1.1), seg=8, rings=6)
        sphere('eyeglow', H, eye, 0.015, loc=(sx * 0.045, -0.115, 0.18), seg=6, rings=4)
    box('teeth', H, bone, (0.08, 0.02, 0.025), loc=(0, -0.11, 0.105), bevel=0.004)
    # Rusty sword
    w = joint('weapon', J['handR'], (0, 0, -0.05))
    cyl('grip', w, mat('leather', 0x5a3a22, 0, 0.8), 0.03, 0.03, 0.2, loc=(0, 0, 0.1), rot=(math.pi / 2, 0, 0), seg=6)
    box('guard', w, rust, (0.3, 0.06, 0.05), loc=(0, -0.11, 0), bevel=0.01)
    extrude_shape('blade', w, rust, [(-0.04, 0), (0.04, 0), (0.035, 0.75), (0, 0.85), (-0.035, 0.75)], 0.018, loc=(0, -0.12, 0), rot=(math.pi / 2, 0, 0), bevel=0.004)
    return J['root']

# ---------------------------------------------------------------- goblin
def build_goblin():
    J = humanoid('goblin', hipZ=0.62, neck=0.42, sh=0.2, ua=0.24, fa=0.24, hw=0.1, thigh=0.3, shin=0.3)
    d = J['d']
    skin = mat('goblinskin', 0x5a7a30, 0, 0.7)
    rag = mat('leather', 0x6a5030, 0, 0.85)
    eye = mat('goblineye', 0xffd020, 0, 0.4, emit=0xffd020)
    T = J['torso']; T.rotation_euler = (0.35, 0, 0)
    lathe('belly', T, skin, [(0.0, 0.0), (0.15, 0.04), (0.19, 0.18), (0.17, 0.32), (0.1, 0.42), (0.0, 0.44)], scale=(1, 0.85, 1), seg=12, sub=1)
    lathe('loincloth', T, rag, [(0.17, 0.08), (0.2, -0.02), (0.23, -0.14)], scale=(1, 0.85, 1), seg=12)
    box('strap', T, rag, (0.05, 0.3, 0.45), loc=(0, 0, 0.22), rot=(0, 0.6, 0), bevel=0.006)
    for side, A, F, H in ((1, J['armL'], J['foreL'], J['handL']), (-1, J['armR'], J['foreR'], J['handR'])):
        cyl('arm', A, skin, 0.05, 0.042, d['ua'], seg=8)
        cyl('forearm', F, skin, 0.045, 0.04, d['fa'], seg=8)
        sphere('hand', H, skin, 0.05, scale=(1, 0.8, 1.2), seg=8, rings=6)
    for side, L, S in ((1, J['legL'], J['shinL']), (-1, J['legR'], J['shinR'])):
        cyl('thigh', L, skin, 0.06, 0.048, d['thigh'], seg=8)
        cyl('shin', S, skin, 0.046, 0.036, d['shin'], seg=8)
        box('foot', S, skin, (0.08, 0.18, 0.05), loc=(0, -0.05, -d['shin']), bevel=0.02)
    H = J['head']
    lathe('head', H, skin, [(0.0, 0.0), (0.1, 0.03), (0.15, 0.12), (0.14, 0.2), (0.08, 0.27), (0.0, 0.28)], loc=(0, -0.02, 0), scale=(1.05, 1.15, 1), seg=12, sub=1)
    cyl('nose', H, skin, 0.035, 0.0, 0.14, loc=(0, -0.17, 0.12), rot=(-math.pi / 2 + 0.3, 0, 0), seg=6)
    for sx in (-1, 1):
        extrude_shape('ear', H, skin, [(0, 0.0), (0.24, 0.06), (0.05, 0.08)], 0.02, loc=(sx * 0.13, 0, 0.16), rot=(0, 0, 0 if sx > 0 else math.pi))
        sphere('eye', H, eye, 0.024, loc=(sx * 0.055, -0.15, 0.16), seg=6, rings=4)
    box('teeth', H, mat('bone', 0xe0d4b8, 0, 0.7), (0.1, 0.02, 0.025), loc=(0, -0.16, 0.06), bevel=0.004)
    w = joint('weapon', J['handR'], (0, 0, -0.04))
    cyl('grip', w, rag, 0.025, 0.025, 0.14, loc=(0, 0.04, 0), rot=(math.pi / 2, 0, 0), seg=6)
    extrude_shape('blade', w, mat('iron', 0x8a8c90, 0.6, 0.5), [(-0.035, 0), (0.035, 0), (0.02, 0.32), (-0.01, 0.4), (-0.03, 0.3)], 0.014, loc=(0, -0.08, 0), rot=(math.pi / 2, 0, 0))
    return J['root']

# ---------------------------------------------------------------- ogre boss
def build_ogre():
    J = humanoid('ogre', hipZ=0.82, neck=0.66, sh=0.36, ua=0.36, fa=0.34, hw=0.16, thigh=0.38, shin=0.38)
    d = J['d']
    skin = mat('ogreskin', 0x8a9a6a, 0, 0.75)
    hide = mat('leather', 0x7a5434, 0, 0.85)
    eye = mat('ogreeye', 0xff3010, 0, 0.4, emit=0xff3010)
    T = J['torso']
    lathe('belly', T, skin, [(0.0, -0.05), (0.26, 0.0), (0.37, 0.18), (0.36, 0.38), (0.3, 0.55), (0.18, 0.68), (0.0, 0.7)], scale=(1, 0.88, 1), seg=16, sub=1)
    sphere('chesthump', T, skin, 0.26, loc=(0, 0.06, 0.55), scale=(1.45, 0.95, 0.75), seg=14, rings=8, sub=1)
    lathe('loin', T, hide, [(0.33, 0.08), (0.36, -0.06), (0.4, -0.22)], scale=(1, 0.9, 1), seg=14)
    box('beltstrap', T, hide, (0.06, 0.62, 0.7), loc=(0, 0, 0.32), rot=(0, 0.7, 0), bevel=0.01)
    for side, A, F, H in ((1, J['armL'], J['foreL'], J['handL']), (-1, J['armR'], J['foreR'], J['handR'])):
        sphere('shoulder', A, hide, 0.15, scale=(1.1, 1, 0.9), cut=-0.2, seg=12, rings=8)
        cyl('arm', A, skin, 0.12, 0.1, d['ua'], seg=10, sub=1)
        cyl('forearm', F, skin, 0.105, 0.09, d['fa'], seg=10, sub=1)
        lathe('bracer', F, hide, [(0.1, -0.18), (0.11, -0.3)], seg=10)
        sphere('fist', H, skin, 0.11, scale=(1, 0.9, 1.1), seg=10, rings=8)
    for side, L, S in ((1, J['legL'], J['shinL']), (-1, J['legR'], J['shinR'])):
        cyl('thigh', L, hide, 0.135, 0.11, d['thigh'], seg=10, sub=1)
        cyl('shin', S, skin, 0.1, 0.09, d['shin'], seg=10, sub=1)
        box('foot', S, skin, (0.2, 0.3, 0.08), loc=(0, -0.05, -d['shin']), bevel=0.03)
    H = J['head']
    lathe('head', H, skin, [(0.0, 0.0), (0.13, 0.02), (0.17, 0.1), (0.15, 0.2), (0.08, 0.26), (0.0, 0.27)], loc=(0, -0.06, 0), scale=(1.1, 1, 0.95), seg=12, sub=1)
    box('jaw', H, skin, (0.24, 0.13, 0.09), loc=(0, -0.14, 0.03), bevel=0.03)
    sphere('brow', H, skin, 0.07, loc=(0, -0.16, 0.16), scale=(2.2, 0.8, 0.6), seg=10, rings=6)
    for sx in (-1, 1):
        cyl('tusk', H, mat('bone', 0xe0d4b8, 0, 0.7), 0.0, 0.028, 0.09, loc=(sx * 0.075, -0.2, 0.09), rot=(math.pi, 0, 0), seg=6)
        sphere('eye', H, eye, 0.022, loc=(sx * 0.055, -0.205, 0.13), seg=6, rings=4)
    w = joint('weapon', J['handR'], (0, 0, -0.05))
    lathe('club', w, mat('wood', 0x7a5530, 0, 0.85), [(0.04, 0.0), (0.05, 0.3), (0.11, 0.75), (0.13, 1.0), (0.09, 1.12), (0.0, 1.14)], loc=(0, 0.1, 0), rot=(math.pi / 2, 0, 0), seg=9)
    for i in range(6):
        a = i * 1.1
        cyl('stud', w, mat('iron', 0x8a8c90, 0.6, 0.5), 0.0, 0.03, 0.09, loc=(math.cos(a) * 0.12, -0.75 - i * 0.05, math.sin(a) * 0.12), rot=(math.pi / 2 + math.sin(a) * 1.2, 0, math.cos(a) * 1.2), seg=5)
    J['root'].scale = (2.1, 2.1, 2.1)  # boss size
    return J['root']

# ---------------------------------------------------------------- export
def export(root, name):
    bpy.ops.object.select_all(action='DESELECT')
    def sel(o):
        o.hide_set(False); o.select_set(True)
        for c in o.children: sel(c)
    sel(root)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_animations=False, export_cameras=False, export_lights=False)
    return path

BUILDERS = {
    'hero_knight': (build_knight, 'humanoid', 1.95),
    'skeleton': (build_skeleton, 'humanoid', 1.9),
    'goblin': (build_goblin, 'humanoid', 1.3),
    'ogre': (build_ogre, 'humanoid', 4.2),
}

def build_all(names=None, keep_last=True):
    os.makedirs(OUT, exist_ok=True)
    manifest = {'models': {}, 'rigs': {}, 'heights': {}}
    mpath = os.path.join(OUT, 'manifest.json')
    if os.path.exists(mpath):
        try: manifest = json.load(open(mpath))
        except Exception: pass
    done = []
    for key, (fn, rig, h) in BUILDERS.items():
        if names and key not in names: continue
        clear()
        root = fn()
        export(root, key)
        manifest['models'][key] = f'{key}.glb'; manifest['rigs'][key] = rig; manifest['heights'][key] = h
        done.append(key)
    json.dump(manifest, open(mpath, 'w'), indent=2)
    return done

if __name__ == '__main__':
    print(build_all())
