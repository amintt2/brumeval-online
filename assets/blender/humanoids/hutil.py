"""Small helpers shared by the character builders of the humanoids group."""
import bpy
import mathutils

import hbody as HB
import hgarment as HG
from kit import gn

V = mathutils.Vector


def J0(J, b, e=0):
    return V(J[b][e])


def lerp(a, b, t):
    return a + (b - a) * t


def shell(base, R, pred, inflate, name, mat):
    """Garment = faces of the quad skin-mesh `base` in a region, pushed out along the normals."""
    return HB.region_shell(base, lambda co: pred(R.limb(co), co), inflate, name, mat)


def conform(ob, colliders, offset, iters=3, smooth=1):
    HB.push_outside(ob, colliders, offset, iters=iters, smooth=smooth)


def thicken(ob, t, depth=None, full=False):
    """Cloth thickness: hem lip (cheap) or a full Solidify inner shell (hoods: the inside is visible)."""
    if full:
        md = gn.solidify(ob, t, offset=-1.0)
        md.use_even_offset = False
        gn.apply(ob)
    else:
        HG.hem_lip(ob, t, depth if depth is not None else t * 3.5)
    HB.clean(ob, 2e-4, recalc=False)
    HB.triangulate(ob)
    HB.drop_degenerate(ob)


def transform(ob, M):
    ob.data.transform(M)
    ob.data.update()
    return ob


def frame_matrix(origin, z_axis, y_hint):
    """World matrix whose local +Z = z_axis and local -Y is as close as possible to y_hint (props built upright,
    facing -Y, then placed into a hand)."""
    z = V(z_axis).normalized()
    fy = V(y_hint)
    fy = (fy - z * fy.dot(z)).normalized()        # local -Y
    y = -fy
    x = y.cross(z).normalized()
    M = mathutils.Matrix((x, y, z)).transposed().to_4x4()
    M.translation = V(origin)
    return M


def tidy(ob, dist=1e-5):
    """Final clean of a rigid/gear mesh: merge doubles, drop degenerate slivers and loose verts."""
    HB.clean(ob, dist, recalc=False)
    HB.drop_degenerate(ob)
    return ob
