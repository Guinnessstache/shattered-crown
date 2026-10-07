# Armor kit: swappable armor pieces for every hero, six tiers per slot, in each class's style.
# Loaded by build_models.py (exec'd into its namespace, so it uses the same helpers).
#
# Every piece lives under an empty named <slot>_t<tier> parented to the joint it moves with:
#   chest_t#   (torso)        pauldL_t# / pauldR_t#  (armL / armR)
#   bracerL_t# / bracerR_t#   (foreL / foreR)        gloveL_t# / gloveR_t#  (handL / handR)
#   greaveL_t# / greaveR_t#   (shinL / shinR)        bootL_t# / bootR_t#    (shinL / shinR, at the foot)
#   thighL_t# / thighR_t#     (legL / legR)
# The game shows the group matching each equipped item's tier and hides the rest.
#
# Material names tell the game how to dress each surface from the item that's equipped there:
#   armor   metal plates, tinted with the item's metal (steel, blackened, gilded, …)
#   armorL  leather armor, tinted leather            armorW  bark/wood armor, tinted wood
#   trim    edging and rivets: iron → silver → gold by rarity
#   enamel  painted cloth or enamel in the item's stat colour (tabards, sashes, panels)
#   rune    glowing inlay in the item's colour (rare/legendary pieces and all tier-5 sets)
#   mail, leather, fur, bone, cloth, wood: textured as usual
import math

TIERS = range(6)

def kit_mats():
    return dict(
        armor=mat('armor', 0xb8bcc4, 0.85, 0.3),
        armorL=mat('armorL', 0x6a4428, 0.0, 0.75),
        armorW=mat('armorW', 0x6a4a2c, 0.0, 0.9),
        trim=mat('trim', 0xd0b060, 0.9, 0.28),
        enamel=mat('enamel', 0x8a1a1e, 0.0, 0.7),
        rune=mat('rune', 0xffa040, 0.0, 0.4, emit=0xffa040),
        mail=mat('mail', 0x8a8c90, 0.75, 0.5),
        leather=mat('leather', 0x4a3020, 0.0, 0.8),
        fur=mat('fur', 0x5a4a3a, 0.0, 1.0),
        bone=mat('bone', 0xe0d4b8, 0.0, 0.6),
        cloth=mat('cloth', 0x3a3430, 0.0, 0.9),
        wood=mat('wood', 0x5a4028, 0.0, 0.9),
        leaf=mat('leaf', 0x4a8a2a, 0.0, 0.8),
        moss=mat('moss', 0x6a9a3a, 0.0, 1.0),
        dark=mat('visor', 0x050505, 0.0, 1.0),
    )

# Torso silhouette (radius, z) shared with the base bodies; armor layers inflate it.
TORSO = [(0.13, 0.1), (0.2, 0.16), (0.235, 0.3), (0.25, 0.44), (0.23, 0.56), (0.16, 0.62), (0.08, 0.64)]

def puff(profile, k, dz=0.0, z0=None, z1=None):
    out = []
    for r, z in profile:
        if z0 is not None and z < z0: continue
        if z1 is not None and z > z1: continue
        out.append((r * k, z + dz))
    return out

def ring(name, parent, m, r, z, h=0.02, ys=0.75, seg=18, flare=0.0):
    return lathe(name, parent, m, [(r, z), (r + 0.006 + flare, z + h * 0.5), (r, z + h)], scale=(1, ys, 1), seg=seg)

def lame(name, parent, m, r_top, r_bot, z_top, h, ys=0.78, seg=18, angle=None, rot=(0, 0, 0)):
    # A single overlapping armour band (a fauld lame / scale row): wider at the bottom.
    prof = [(r_top, z_top), (r_bot, z_top - h), (r_bot - 0.008, z_top - h - 0.006)]
    if angle: return lathe(name, parent, m, prof, scale=(1, ys, 1), seg=seg, angle=angle, rot=rot)
    return lathe(name, parent, m, prof, scale=(1, ys, 1), seg=seg)

def stud(parent, m, loc, r=0.012):
    return sphere('stud', parent, m, r, loc=loc, seg=6, rings=4)

def front(r, a, ys=0.75):
    # point on an elliptical torso ring at angle a (0 = straight ahead, -Y)
    return (math.sin(a) * r, -math.cos(a) * r * ys)

# ---------------------------------------------------------------- chest pieces
def chest_piece(g, t, style, K):
    S = style
    if S == 'plate':
        kind = ['quilt', 'mail', 'scale', 'plate', 'gothic', 'ember'][t]
    elif S == 'brute':
        kind = ['straps', 'harness', 'furvest', 'ironvest', 'reaver', 'emberbrute'][t]
    elif S == 'robe':
        kind = ['none', 'apron', 'coat', 'arcane', 'shadow', 'emberrobe'][t]
    else:
        kind = ['none', 'bark', 'leafmail', 'bonecage', 'thorn', 'emberwood'][t]

    def belt(r=0.22, z=0.06, m=None, buckle=True):
        lathe('belt', g, m or K['leather'], [(r, z), (r + 0.004, z + 0.06)], scale=(1, 0.78, 1), seg=16)
        if buckle: box('buckle', g, K['trim'], (0.08, 0.02, 0.065), loc=(0, -r * 0.78 - 0.008, z + 0.03), bevel=0.006)

    if kind == 'quilt':  # padded gambeson in the item's colour
        lathe('gambeson', g, K['enamel'], puff(TORSO, 1.04), scale=(1, 0.74, 1), seg=18, sub=1)
        for i, z in enumerate((0.18, 0.28, 0.38, 0.48)):
            ring('quilting', g, K['cloth'], 0.236 + (0.01 if 0.3 < z < 0.5 else 0), z, h=0.012)
        lathe('skirt', g, K['enamel'], [(0.22, 0.14), (0.24, 0.0), (0.27, -0.2)], scale=(1, 0.8, 1), seg=18)
        belt()
    elif kind == 'mail':
        lathe('hauberk', g, K['mail'], puff(TORSO, 1.04), scale=(1, 0.74, 1), seg=18, sub=1)
        lathe('mailskirt', g, K['mail'], [(0.21, 0.16), (0.23, 0.0), (0.27, -0.24)], scale=(1, 0.8, 1), seg=18)
        for nm, y in (('tabard', -0.18), ('tabardB', 0.175)):
            extrude_shape(nm, g, K['enamel'], [(-0.12, 0.52), (0.12, 0.52), (0.14, -0.24), (0.05, -0.3), (0, -0.25), (-0.05, -0.3), (-0.14, -0.24)], 0.016, loc=(0, y, 0), rot=(0.06 if y < 0 else -0.06, 0, 0))
        box('crest', g, K['trim'], (0.07, 0.01, 0.09), loc=(0, -0.19, 0.34), rot=(0, 0.785, 0), bevel=0.004)
        belt(z=0.07)
    elif kind == 'scale':
        lathe('hauberk', g, K['mail'], puff(TORSO, 1.03), scale=(1, 0.74, 1), seg=18, sub=1)
        for i in range(6):
            z = 0.58 - i * 0.075
            r = 0.2 + 0.05 * math.sin(min(1, (0.62 - z) / 0.32) * math.pi * 0.5)
            lame('scales', g, K['armor'], r, r + 0.02, z, 0.07, seg=20)
        for i in range(3): lame('fauld', g, K['armor'], 0.235 + i * 0.012, 0.25 + i * 0.012, 0.06 - i * 0.07, 0.07, seg=20)
        belt(z=0.07)
        lathe('gorget', g, K['armor'], [(0.1, 0.58), (0.135, 0.62), (0.1, 0.69)], seg=16)
    elif kind in ('plate', 'gothic', 'ember'):
        lathe('cuirass', g, K['armor'], puff(TORSO, 1.08, z0=0.15), scale=(1, 0.74, 1), seg=24, sub=1)
        lathe('plackart', g, K['armor'], [(0.215, 0.12), (0.245, 0.2), (0.25, 0.3)], scale=(1, 0.77, 1), seg=24, angle=math.pi * 0.9, rot=(0, 0, -math.pi / 2 - math.pi * 0.45))
        box('ridge', g, K['trim'], (0.022, 0.03, 0.4), loc=(0, -0.19, 0.4), rot=(0.12, 0, 0), bevel=0.008)
        ring('neckedge', g, K['trim'], 0.17, 0.6, h=0.02, ys=0.74, seg=20)
        ring('waistedge', g, K['trim'], 0.235, 0.14, h=0.02, ys=0.76, seg=20)
        lathe('gorget', g, K['armor'], [(0.1, 0.58), (0.14, 0.62), (0.105, 0.7)], seg=18, sub=1)
        for i in range(3): lame('fauld', g, K['armor'], 0.235 + i * 0.012, 0.255 + i * 0.012, 0.13 - i * 0.075, 0.075, seg=22)
        for sx in (-1, 1):
            extrude_shape('tasset', g, K['armor'], [(-0.07, 0), (0.07, 0), (0.08, -0.16), (0, -0.19), (-0.08, -0.16)], 0.012, loc=(sx * 0.13, -0.17, -0.08), rot=(0.12, 0, sx * 0.08))
        if kind == 'plate':
            box('crest', g, K['enamel'], (0.09, 0.01, 0.11), loc=(0, -0.2, 0.36), rot=(0.12, 0.785, 0), bevel=0.004)
        if kind in ('gothic', 'ember'):
            for i in range(7):
                a = -0.6 + i * 0.2
                x, y = front(0.252, a, 0.74)
                box('flute', g, K['trim' if kind == 'ember' else 'armor'], (0.012, 0.018, 0.3), loc=(x * 1.03, y * 1.03, 0.4), rot=(0.1 * math.cos(a), 0, -a * 0.9), bevel=0.004)
        if kind == 'gothic':
            for sx in (-1, 1):
                spoke('spike', g, K['trim'], 0.022, 0.0, 0.1, (sx * 0.12, -0.17, 0.48), (sx * 0.4, -1, 0.3), seg=6)
        if kind == 'ember':
            for z in (0.24, 0.5):
                ring('runeband', g, K['rune'], 0.25 if z < 0.4 else 0.252, z, h=0.012, ys=0.74, seg=22)
            sphere('heart', g, K['rune'], 0.035, loc=(0, -0.2, 0.42), scale=(1, 0.6, 1.2), seg=10, rings=8)
            lathe('heartframe', g, K['trim'], [(0.05, -0.02), (0.06, 0.0), (0.05, 0.02)], loc=(0, -0.19, 0.42), rot=(math.pi / 2, 0, 0), seg=14)
        belt(z=0.14, m=K['leather'], buckle=kind != 'ember')
    elif kind in ('straps', 'harness'):
        for sx in (-1, 1):
            box('strap', g, K['armorL'], (0.055, 0.03, 0.64), loc=(sx * 0.08, -0.155, 0.36), rot=(0.1, sx * 0.55, 0), bevel=0.006)
        if kind == 'harness':
            lathe('chestband', g, K['armorL'], [(0.255, 0.36), (0.26, 0.42)], scale=(1, 0.76, 1), seg=18)
            for i in range(10):
                a = -1.2 + i * 0.27
                x, y = front(0.262, a, 0.76)
                stud(g, K['trim'], (x, y, 0.39))
            sphere('ring', g, K['trim'], 0.035, loc=(0, -0.2, 0.38), scale=(1, 0.4, 1), seg=10, rings=6)
        belt(r=0.23, z=0.05)
    elif kind in ('furvest', 'ironvest', 'reaver', 'emberbrute'):
        lathe('vest', g, K['armorL'] if kind == 'furvest' else K['armor'], puff(TORSO, 1.07, z0=0.14), scale=(1, 0.76, 1), seg=20, sub=1, angle=math.tau * 0.84, rot=(0, 0, -math.pi / 2 + math.tau * 0.08))
        if kind == 'furvest':
            for i in range(4):
                for sx in (-1, 1):
                    box('scale', g, K['armor'], (0.08, 0.02, 0.06), loc=(sx * 0.14, -0.16, 0.48 - i * 0.08), rot=(0.15, sx * 0.4, 0), bevel=0.008)
        else:
            for i in range(3): lame('plate', g, K['armor'], 0.24, 0.255, 0.5 - i * 0.11, 0.1, seg=20, angle=math.tau * 0.84, rot=(0, 0, -math.pi / 2 + math.tau * 0.08))
        lathe('furcollar', g, K['fur'], [(0.12, 0.7), (0.24, 0.66), (0.33, 0.58), (0.3, 0.5), (0.2, 0.56)], scale=(1, 0.82, 1), seg=18, sub=1)
        if kind in ('reaver', 'emberbrute'):
            sphere('skull', g, K['bone'], 0.06, loc=(0, -0.21, 0.34), scale=(1, 0.8, 1.1), seg=12, rings=8)
            for sx in (-1, 1):
                sphere('socket', g, K['rune'] if kind == 'emberbrute' else K['dark'], 0.013, loc=(sx * 0.022, -0.255, 0.35), seg=6, rings=4)
                spoke('spike', g, K['trim'], 0.024, 0.0, 0.12, (sx * 0.16, -0.15, 0.44), (sx * 0.6, -1, 0.2), seg=6)
            for i in range(8):
                a = i / 8 * math.pi + math.pi * 0.5
                sphere('link', g, K['mail'], 0.016, loc=(math.cos(a) * 0.18 + 0.05, -0.2, 0.18 + math.sin(a) * 0.08), scale=(1.3, 0.5, 1), seg=6, rings=4)
        if kind == 'emberbrute':
            for i in range(5):
                a = -0.8 + i * 0.4
                x, y = front(0.26, a, 0.76)
                box('crack', g, K['rune'], (0.008, 0.012, 0.18), loc=(x * 1.02, y * 1.02, 0.36), rot=(0, 0, -a + (i % 2 - 0.5) * 0.4), bevel=0)
        belt(r=0.235, z=0.04)
    elif kind in ('apron', 'coat', 'arcane', 'shadow', 'emberrobe'):
        if kind == 'apron':
            extrude_shape('apron', g, K['armorL'], [(-0.14, 0.47), (0.14, 0.47), (0.16, -0.32), (-0.16, -0.32)], 0.016, loc=(0, -0.18, 0), rot=(0.06, 0, 0))
            for sx in (-1, 1):
                box('pouch', g, K['leather'], (0.07, 0.05, 0.08), loc=(sx * 0.19, -0.13, 0.06), rot=(0, 0, sx * 0.5), bevel=0.012)
            belt(r=0.225, z=0.07)
        else:
            m = K['armorL'] if kind == 'coat' else K['armor']
            lathe('coat', g, K['armorL'], puff(TORSO, 1.06, z0=0.12), scale=(1, 0.76, 1), seg=20, sub=1)
            lathe('coattail', g, K['armorL'], [(0.23, 0.12), (0.26, -0.1), (0.3, -0.4)], scale=(1, 0.85, 1), seg=20, angle=math.tau * 0.75, rot=(0, 0, math.pi / 2 - math.tau * 0.375 + math.pi))
            for i in range(4): stud(g, K['trim'], (0.04, -0.2, 0.5 - i * 0.1), 0.012)
            if kind == 'coat':
                box('bandolier', g, K['leather'], (0.045, 0.03, 0.62), loc=(0, -0.175, 0.36), rot=(0.1, 0.65, 0), bevel=0.006)
                for i in range(4):
                    cyl('vial', g, K['rune'], 0.016, 0.016, 0.06, loc=(-0.13 + i * 0.07, -0.2, 0.52 - i * 0.085), rot=(0, 0.65, 0), seg=8)
            else:
                lathe('breastplate', g, m, puff(TORSO, 1.09, z0=0.26, z1=0.6), scale=(1, 0.74, 1), seg=22, sub=1, angle=math.pi * 0.85, rot=(0, 0, -math.pi / 2 - math.pi * 0.425))
                lathe('collar', g, K['trim'], [(0.11, 0.62), (0.15, 0.76)], scale=(1, 0.9, 1), seg=16, angle=math.pi * 1.4, rot=(0, 0, math.pi * 0.3))
                ring('sigilband', g, K['rune'] if kind != 'arcane' else K['trim'], 0.255, 0.32, h=0.014, seg=22)
                sphere('focus', g, K['rune'], 0.03, loc=(0, -0.21, 0.44), seg=10, rings=8)
                if kind in ('shadow', 'emberrobe'):
                    for sx in (-1, 1):
                        cyl('chain', g, K['mail'], 0.008, 0.008, 0.28, loc=(sx * 0.08, -0.2, 0.44), rot=(0, sx * 0.9, 0), seg=6)
                    o = sphere('orbit', g, K['rune'], 0.022, loc=(0.18, -0.24, 0.6), seg=8, rings=6)
            belt(r=0.235, z=0.1)
    elif kind in ('bark', 'leafmail', 'bonecage', 'thorn', 'emberwood'):
        if kind == 'bark':
            for i in range(3):
                for sx in (-1, 1):
                    box('barkplate', g, K['armorW'], (0.12, 0.03, 0.1), loc=(sx * 0.1, -0.165, 0.5 - i * 0.12), rot=(0.1, sx * 0.35, sx * 0.1), bevel=0.02)
            belt(r=0.228, z=0.06, m=K['wood'])
        elif kind == 'leafmail':
            for i in range(6):
                z = 0.58 - i * 0.08
                for j in range(12):
                    a = -math.pi * 0.85 + j * (math.pi * 1.7 / 11) + (i % 2) * 0.08
                    r = 0.22 + 0.04 * math.sin(min(1, (0.62 - z) / 0.3) * math.pi * 0.5)
                    x, y = front(r, a, 0.76)
                    box('leafscale', g, K['leaf'] if (i + j) % 3 else K['armorW'], (0.07, 0.012, 0.09), loc=(x * 1.05, y * 1.05, z), rot=(0.25 * math.cos(a), 0, -a), bevel=0.01)
            belt(r=0.228, z=0.06, m=K['wood'])
        elif kind in ('bonecage', 'thorn', 'emberwood'):
            mm = K['bone'] if kind == 'bonecage' else K['armorW']
            lathe('spine', g, mm, [(0.03, 0.62), (0.035, 0.1)], seg=8, loc=(0, -0.195, 0))
            for i in range(5):
                z = 0.54 - i * 0.085
                for sx in (-1, 1):
                    pts = []
                    for k in range(7):
                        a = k / 6 * math.pi * 0.75
                        x, y = front(0.25 - i * 0.004, sx * a, 0.76)
                        pts.append((x * 1.04, y * 1.04, z - k * 0.008))
                    for k in range(6):
                        p0, p1 = pts[k], pts[k + 1]
                        d = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
                        L = math.sqrt(sum(c * c for c in d))
                        spoke('rib', g, mm, 0.014, 0.012, L, p0, d, seg=6)
            if kind == 'thorn':
                for i in range(10):
                    a = -1.3 + i * 0.29
                    x, y = front(0.26, a, 0.76)
                    spoke('thorn', g, K['armorW'], 0.012, 0.0, 0.07, (x, y, 0.3 + (i % 3) * 0.1), (math.sin(a), -math.cos(a), 0.4), seg=5)
            if kind == 'emberwood':
                sphere('heartseed', g, K['rune'], 0.04, loc=(0, -0.2, 0.42), seg=10, rings=8)
                for i in range(6):
                    a = -0.9 + i * 0.36
                    x, y = front(0.255, a, 0.76)
                    box('vein', g, K['rune'], (0.007, 0.012, 0.2), loc=(x, y, 0.32), rot=(0, 0, -a + 0.3), bevel=0)
            if kind == 'bonecage':
                sphere('skullclasp', g, K['bone'], 0.04, loc=(0, -0.21, 0.16), scale=(1, 0.8, 1.1), seg=10, rings=8)
            belt(r=0.228, z=0.06, m=K['wood'])
    # 'none': the class's base clothing shows through


# ---------------------------------------------------------------- shoulders
def pauldron_piece(g, t, side, style, K):
    if t == 0 and style in ('robe', 'wild', 'brute'): return
    s = side
    if style == 'plate':
        if t == 0:
            sphere('pad', g, K['enamel'], 0.12, loc=(s * 0.03, 0, 0.0), scale=(1.1, 1.0, 0.7), cut=-0.1, seg=12, rings=8)
            return
        if t == 1:
            sphere('pad', g, K['armorL'], 0.13, loc=(s * 0.03, 0, 0.0), scale=(1.1, 1.05, 0.7), cut=-0.1, seg=14, rings=8)
            return
        layers = {2: 2, 3: 3, 4: 3, 5: 4}[t]
        for i in range(layers):
            sphere('lame', g, K['armor'], 0.135 - i * 0.006, loc=(s * (0.04 + i * 0.016), 0, 0.03 - i * 0.05), scale=(1.12, 1.04, 0.58 - i * 0.04), rot=(0, s * (0.28 + i * 0.08), 0), cut=-0.05, seg=20, rings=10)
        lathe('edge', g, K['trim'], [(0.148, -0.005), (0.154, 0.01)], loc=(s * 0.04, 0, 0.02), scale=(1.12, 1.04, 1), rot=(0, s * 0.28, 0), seg=20)
        if t >= 3:
            extrude_shape('haute', g, K['armor'], [(-0.12, 0), (0.12, 0), (0.1, 0.09), (-0.1, 0.07)], 0.012, loc=(s * 0.0, 0, 0.1), rot=(0, 0, s * 0.15))
        if t == 4:
            for i in range(3): spoke('spike', g, K['trim'], 0.022, 0.0, 0.11, (s * (0.07 + i * 0.025), -0.04 + i * 0.04, 0.1), (s * 0.4, 0, 1), seg=6)
        if t == 5:
            extrude_shape('wing', g, K['trim'], [(0, 0), (0.05, 0.02), (0.18, 0.14), (0.1, 0.06), (0.16, 0.2), (0.03, 0.06)], 0.014, loc=(s * 0.1, 0.02, 0.06), rot=(0, 0, 0 if s > 0 else math.pi))
            ring('runeedge', g, K['rune'], 0.16, -0.02, h=0.01, ys=1.0, seg=18)
    elif style == 'brute':
        sphere('fur', g, K['fur'], 0.15, loc=(s * 0.03, 0, 0.02), scale=(1.15, 1.1, 0.75), cut=-0.15, seg=14, rings=8, sub=1)
        if t >= 2:
            sphere('plate', g, K['armor'], 0.12, loc=(s * 0.07, 0, 0.05), scale=(1.0, 0.95, 0.72), rot=(0, s * 0.5, 0), cut=0.0, seg=18, rings=8)
            for i in range(2 + t // 2): stud(g, K['trim'], (s * (0.06 + i * 0.03), -0.09, 0.07 - i * 0.01))
        if t >= 3:
            for i in range(t - 1): spoke('spike', g, K['trim'], 0.026, 0.0, 0.1 + i * 0.02, (s * (0.05 + i * 0.03), -0.04 + i * 0.04, 0.13), (s * 0.5, 0.1, 1), seg=6)
        if t >= 4:
            sphere('skull', g, K['bone'], 0.055, loc=(s * 0.12, -0.08, 0.04), scale=(1, 0.85, 1.1), seg=10, rings=8)
            if t == 5:
                for sx in (-1, 1): sphere('eye', g, K['rune'], 0.011, loc=(s * 0.12 + sx * 0.02, -0.125, 0.05), seg=6, rings=4)
    elif style == 'robe':
        sphere('mantle', g, K['enamel'], 0.12, loc=(s * 0.03, 0, 0.0), scale=(1.15, 1.05, 0.65), cut=-0.15, seg=14, rings=8)
        if t >= 2:
            lathe('disc', g, K['armor'], [(0.001, 0.05), (0.11, 0.03), (0.13, 0.0), (0.12, -0.01)], loc=(s * 0.05, 0, 0.04), rot=(0, s * 0.35, 0), seg=18)
            ring('discedge', g, K['trim'], 0.125, 0.0, h=0.012, ys=1.0, seg=18)
        if t >= 3:
            sphere('gem', g, K['rune'], 0.022, loc=(s * 0.08, -0.03, 0.08), seg=8, rings=6)
        if t >= 4:
            for i in range(2): cyl('tassel', g, K['enamel'], 0.012, 0.004, 0.14, loc=(s * (0.12 + i * 0.03), -0.06 + i * 0.05, -0.04), seg=6)
        if t == 5:
            extrude_shape('flare', g, K['trim'], [(0, 0), (0.06, 0.05), (0.16, 0.1), (0.07, 0.02)], 0.01, loc=(s * 0.08, 0.02, 0.06), rot=(0, 0, 0 if s > 0 else math.pi))
    else:  # wild
        sphere('bark', g, K['armorW'], 0.13, loc=(s * 0.03, 0, 0.02), scale=(1.15, 1.05, 0.8), cut=-0.1, seg=12, rings=8)
        sphere('moss', g, K['moss'], 0.09, loc=(s * 0.05, 0, 0.09), scale=(1.1, 1, 0.4), cut=0.0, seg=10, rings=6)
        if t >= 2:
            for i in range(3): box('leaf', g, K['leaf'], (0.06, 0.012, 0.09), loc=(s * (0.1 + i * 0.02), -0.06 + i * 0.06, 0.06), rot=(0.4, 0, s * (0.6 + i * 0.3)), bevel=0)
        if t >= 3:
            p = spoke('antler', g, K['bone'], 0.018, 0.01, 0.12 + t * 0.02, (s * 0.08, 0.0, 0.08), (s * 0.7, 0.1, 1), seg=6)
            spoke('tine', g, K['bone'], 0.01, 0.0, 0.07, p, (s * 0.2, -0.4, 0.8), seg=5)
        if t >= 4:
            for i in range(4): spoke('thorn', g, K['armorW'], 0.012, 0.0, 0.06, (s * (0.05 + i * 0.03), -0.08 + i * 0.05, 0.1), (s * 0.3, -0.3, 1), seg=5)
        if t == 5:
            sphere('bloom', g, K['rune'], 0.025, loc=(s * 0.07, -0.08, 0.1), seg=8, rings=6)

# ---------------------------------------------------------------- arms: bracers + gloves
def bracer_piece(g, t, d, style, K, side=1):
    fa = d['fa']
    if t == 0:
        for i in range(3): ring('wrap', g, K['leather'], 0.062, -fa + 0.04 + i * 0.05, h=0.03, ys=1.0, seg=10)
        return
    m = K['armorW'] if style == 'wild' else K['armorL'] if (t == 1 or (style == 'robe' and t < 3)) else K['armor']
    lathe('bracer', g, m, [(0.064, -0.04), (0.066, -fa * 0.5), (0.072, -fa + 0.04), (0.08, -fa + 0.01)], seg=14, sub=1 if t >= 3 else 0)
    if t >= 2: ring('cuffedge', g, K['trim'], 0.078, -fa + 0.01, h=0.014, ys=1.0, seg=14)
    if t >= 3: sphere('couter', g, K['armor'] if style != 'wild' else K['armorW'], 0.075, loc=(0, 0.02, 0.0), scale=(1, 1.1, 0.95), seg=12, rings=8)
    if t >= 3 and style == 'plate':
        extrude_shape('wingcop', g, K['armor'], [(-0.05, 0), (0.05, 0), (0.0, 0.06)], 0.01, loc=(0, 0.075, 0.0), rot=(0, 0, 0))
    if t == 4:
        for i in range(3): spoke('spike', g, K['trim'] if style != 'wild' else K['armorW'], 0.016, 0.0, 0.07, (side * 0.05, 0.02, -0.08 - i * 0.06), (side, 0.3, 0.2), seg=5)
    if t == 5:
        ring('runeband', g, K['rune'], 0.07, -fa * 0.45, h=0.012, ys=1.0, seg=14)

def glove_piece(g, t, style, K):
    if t == 0: return  # bare hands
    m = K['armorW'] if style == 'wild' else K['armorL'] if (t <= 1 or (style == 'robe' and t < 3)) else K['mail'] if t == 2 and style == 'plate' else K['armor']
    box('glove', g, m, (0.1, 0.11, 0.12), loc=(0, 0, -0.03), bevel=0.022)
    box('fingers', g, m if t >= 3 else K['leather'], (0.095, 0.1, 0.065), loc=(0, -0.012, -0.105), rot=(0.3, 0, 0), bevel=0.016)
    box('thumb', g, m, (0.03, 0.04, 0.06), loc=(-0.055, -0.04, -0.06), rot=(0.3, 0, -0.4), bevel=0.01)
    if t >= 3:
        for i in range(3): box('lame', g, K['armor'] if style != 'wild' else K['armorW'], (0.105, 0.11, 0.018), loc=(0, 0, 0.0 - i * 0.03), rot=(0.1, 0, 0), bevel=0.006)
        for i in range(4): stud(g, K['trim'], (-0.035 + i * 0.023, -0.06, -0.06), 0.009)
    if t >= 4:
        for i in range(4): spoke('claw', g, K['trim'], 0.01, 0.0, 0.06, (-0.035 + i * 0.023, -0.04, -0.13), (0, -0.4, -1), seg=5)
    if t == 5:
        sphere('gem', g, K['rune'], 0.016, loc=(0, -0.06, -0.02), seg=8, rings=6)

# ---------------------------------------------------------------- legs: thighs, greaves, boots
def thigh_piece(g, t, d, style, K):
    if t < 3 or style in ('robe',): return
    m = K['armorW'] if style == 'wild' else K['armor']
    lathe('cuisse', g, m, [(0.098, -0.03), (0.1, -d['thigh'] * 0.4), (0.088, -d['thigh'] * 0.75)], scale=(1, 0.88, 1), seg=14, sub=1)
    ring('cuisseedge', g, K['trim'], 0.09, -d['thigh'] * 0.76, h=0.014, ys=0.9, seg=14)

def greave_piece(g, t, d, style, K):
    sh = d['shin']
    if t <= 1:
        if t == 1: lathe('legwrap', g, K['armorL'], [(0.074, -0.05), (0.072, -sh * 0.55)], seg=12)
        return
    m = K['armorW'] if style == 'wild' else K['mail'] if t == 2 else K['armor']
    lathe('greave', g, m, [(0.08, -0.03), (0.082, -sh * 0.35), (0.07, -sh * 0.8), (0.075, -sh + 0.08)], seg=14, sub=1 if t >= 3 else 0)
    if t >= 3:
        sphere('poleyn', g, K['armor'] if style != 'wild' else K['armorW'], 0.082, loc=(0, -0.035, 0.0), scale=(1, 0.9, 1.15), seg=14, rings=8)
        ring('greaveedge', g, K['trim'], 0.072, -sh * 0.8, h=0.012, ys=1.0, seg=14)
    if t == 4:
        spoke('kneespike', g, K['trim'] if style != 'wild' else K['armorW'], 0.02, 0.0, 0.09, (0, -0.1, 0.02), (0, -1, 0.5), seg=6)
    if t == 5:
        extrude_shape('kneewing', g, K['trim'], [(-0.06, 0), (0.06, 0), (0.0, 0.08)], 0.01, loc=(0, -0.105, 0.04), rot=(0.2, 0, 0))
        ring('runeband', g, K['rune'], 0.078, -sh * 0.45, h=0.012, ys=1.0, seg=14)

def boot_piece(g, t, d, style, K):
    sh = d['shin']
    fz = -sh + 0.03
    if t == 0:
        box('shoe', g, K['leather'] if style != 'brute' else K['fur'], (0.12, 0.24, 0.1), loc=(0, -0.05, fz), bevel=0.03)
        return
    m = K['armorW'] if style == 'wild' and t >= 2 else K['armorL'] if t <= 2 else K['armor']
    box('boot', g, m, (0.13, 0.26, 0.11), loc=(0, -0.055, fz), bevel=0.032)
    box('sole', g, K['leather'], (0.13, 0.27, 0.025), loc=(0, -0.055, fz - 0.055), bevel=0.008)
    lathe('cuff', g, m, [(0.08, fz + 0.05), (0.085, fz + 0.16), (0.095, fz + 0.2)], seg=14)
    if t >= 3:
        for i in range(3): box('sabaton', g, K['armor'] if style != 'wild' else K['armorW'], (0.135, 0.07, 0.03), loc=(0, -0.13 - i * 0.045, fz + 0.04 - i * 0.008), rot=(0.25, 0, 0), bevel=0.008)
    if t == 4:
        spoke('toe', g, K['trim'], 0.018, 0.0, 0.07, (0, -0.19, fz + 0.0), (0, -1, 0.2), seg=6)
    if t >= 2: ring('cuffedge', g, K['trim'], 0.092, fz + 0.19, h=0.012, ys=1.0, seg=14)
    if t == 5:
        box('runestrap', g, K['rune'], (0.136, 0.02, 0.012), loc=(0, -0.09, fz + 0.03), bevel=0)

# ---------------------------------------------------------------- assemble
def armor_kit(J, style, K=None, chest_scale=(1.0, 1.0)):
    # chest_scale widens the torso pieces for broader bodies (the berserker is ~8% wider).
    K = K or kit_mats()
    d = J['d']
    for t in TIERS:
        cg = joint(f'chest_t{t}', J['torso'])
        cg.scale = (chest_scale[0], chest_scale[1], 1.0)
        chest_piece(cg, t, style, K)
        for side, A, F, H, L, S in ((1, J['armL'], J['foreL'], J['handL'], J['legL'], J['shinL']), (-1, J['armR'], J['foreR'], J['handR'], J['legR'], J['shinR'])):
            sfx = 'L' if side > 0 else 'R'
            pauldron_piece(joint(f'pauld{sfx}_t{t}', A), t, side, style, K)
            bracer_piece(joint(f'bracer{sfx}_t{t}', F), t, d, style, K, side)
            glove_piece(joint(f'glove{sfx}_t{t}', H), t, style, K)
            thigh_piece(joint(f'thigh{sfx}_t{t}', L), t, d, style, K)
            greave_piece(joint(f'greave{sfx}_t{t}', S), t, d, style, K)
            boot_piece(joint(f'boot{sfx}_t{t}', S), t, d, style, K)
    return K
