"""Tiny node-graph builder shared by materials.py (shader nodes) and gn.py (geometry nodes).

    nb = NB(material.node_tree)
    n = nb.node("ShaderNodeTexNoise", Vector=coords, Scale=4.0, Detail=8)      # inputs by name
    m = nb.mix(a, b, fac)                                  # colour mix, returns the output socket
    h = nb.math("MULTIPLY", n.outputs["Fac"], 0.3)         # returns socket

Every helper accepts either a socket (it gets linked) or a plain value (it is set as default).
Sockets with duplicate names (Mix, Random Value, Compare…) are resolved by socket type.
"""
import bpy

_TYPE_ALIASES = {"FLOAT": "VALUE", "COLOR": "RGBA", "RGBA": "RGBA", "VECTOR": "VECTOR", "INT": "INT",
                 "BOOLEAN": "BOOLEAN", "ROTATION": "ROTATION", "VALUE": "VALUE", "GEOMETRY": "GEOMETRY",
                 "SHADER": "SHADER", "MATRIX": "MATRIX", "STRING": "STRING", "OBJECT": "OBJECT",
                 "MATERIAL": "MATERIAL", "COLLECTION": "COLLECTION", "MENU": "MENU"}


def srgb(c):
    """'#rrggbb' or (r,g,b[,a]) in sRGB 0..1 -> linear RGBA tuple (Blender colour sockets are linear)."""
    if isinstance(c, str):
        h = c.lstrip("#")
        c = tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    lin = tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c[:3])
    return (*lin, c[3] if len(c) > 3 else 1.0)


def _avail(s):
    try:
        return s.is_available if hasattr(s, "is_available") else s.enabled
    except Exception:
        return True


def sock(coll, key, typ=None):
    """Find a socket in node.inputs/outputs by name/identifier/index, preferring available ones of `typ`."""
    if isinstance(key, int):
        return coll[key]
    typ = _TYPE_ALIASES.get(typ, typ) if typ else None
    cands = [s for s in coll if s.name == key or s.identifier == key]
    if typ:
        t = [s for s in cands if s.type == typ]
        cands = t or cands
    av = [s for s in cands if _avail(s)]
    if av:
        return av[0]
    if cands:
        return cands[0]
    raise KeyError(f"socket {key!r} ({typ}) not in {[s.name for s in coll]}")


class NB:
    def __init__(self, tree, clear=False):
        self.t = tree
        self.nodes = tree.nodes
        self.links = tree.links
        self.x = 0
        if clear:
            self.nodes.clear()

    # ------------------------------------------------------------------ core
    def node(self, typ, _props=None, **inputs):
        n = self.nodes.new(typ)
        self.x += 1
        n.location = ((self.x % 12) * 220 - 2400, -(self.x // 12) * 260)
        for k, v in (_props or {}).items():
            setattr(n, k, v)
        for k, v in inputs.items():
            self.set(n, k.replace("__", " "), v)
        return n

    def set(self, node, key, value, typ=None):
        if isinstance(key, tuple):
            key, typ = key
        if typ is None and isinstance(value, bpy.types.NodeSocket) and not isinstance(key, int):
            # prefer an input socket of a compatible type when names collide
            cands = [s for s in node.inputs if (s.name == key or s.identifier == key) and _avail(s)]
            same = [s for s in cands if s.type == value.type]
            s = (same or cands or [sock(node.inputs, key)])[0]
        else:
            s = sock(node.inputs, key, typ)
        self.feed(s, value)
        return s

    def feed(self, s, value):
        if value is None:
            return
        if isinstance(value, bpy.types.NodeSocket):
            self.links.new(value, s)
        elif isinstance(value, bpy.types.Node):
            self.links.new(value.outputs[0], s)
        else:
            if s.type == "RGBA" and isinstance(value, (str, tuple, list)) and (isinstance(value, str) or len(value) in (3, 4)):
                value = srgb(value) if isinstance(value, str) else (tuple(value) + (1.0,))[:4]
            elif s.type == "VECTOR" and isinstance(value, (int, float)):
                value = (value, value, value)
            s.default_value = value

    def link(self, a, b):
        if isinstance(a, bpy.types.Node):
            a = a.outputs[0]
        return self.links.new(a, b)

    @staticmethod
    def out(node, key=0, typ=None):
        return sock(node.outputs, key, typ)

    # ------------------------------------------------------------------ math
    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.node("ShaderNodeMath", {"operation": op, "use_clamp": clamp})
        for i, v in enumerate((a, b, c)):
            if v is not None:
                self.feed(n.inputs[i], v)
        return n.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        n = self.node("ShaderNodeVectorMath", {"operation": op})
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        if scale is not None:
            self.feed(sock(n.inputs, "Scale"), scale)
        return n.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs["Vector"]

    def add(self, a, b): return self.math("ADD", a, b)
    def mul(self, a, b): return self.math("MULTIPLY", a, b)
    def sub(self, a, b): return self.math("SUBTRACT", a, b)
    def clamp01(self, a): return self.math("ADD", a, 0.0, clamp=True)

    def maprange(self, v, a=0.0, b=1.0, c=0.0, d=1.0, interp="LINEAR", clamp=True):
        n = self.node("ShaderNodeMapRange", {"interpolation_type": interp, "clamp": clamp})
        self.feed(sock(n.inputs, "Value", "VALUE"), v)
        for key, val in (("From Min", a), ("From Max", b), ("To Min", c), ("To Max", d)):
            self.feed(sock(n.inputs, key, "VALUE"), val)
        return sock(n.outputs, "Result", "VALUE")

    def smooth(self, v, a, b):
        return self.maprange(v, a, b, 0, 1, "SMOOTHSTEP")

    def mix(self, a, b, fac, blend="MIX", typ="RGBA", clamp=True):
        """Mix node (colour by default). Returns output socket."""
        n = self.node("ShaderNodeMix", {"data_type": typ})
        if typ == "RGBA":
            n.blend_type = blend
            n.clamp_result = clamp
        ft = "VALUE" if typ in ("RGBA", "FLOAT") else "VECTOR"
        self.feed(sock(n.inputs, "Factor", ft), fac)
        tt = {"RGBA": "RGBA", "FLOAT": "VALUE", "VECTOR": "VECTOR"}[typ]
        self.feed(sock(n.inputs, "A", tt), a)
        self.feed(sock(n.inputs, "B", tt), b)
        return sock(n.outputs, "Result", tt)

    def mixf(self, a, b, fac):
        return self.mix(a, b, fac, typ="FLOAT")

    def ramp(self, fac, stops, interp="LINEAR"):
        """stops = [(pos, colour), ...] colour hex/tuple. Returns Color output."""
        n = self.node("ShaderNodeValToRGB")
        cr = n.color_ramp
        cr.interpolation = interp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = srgb(stops[0][1]) if not isinstance(stops[0][1], (int, float)) else (stops[0][1],) * 3 + (1,)
        for p, c in stops[1:]:
            e = cr.elements.new(p)
            e.color = srgb(c) if not isinstance(c, (int, float)) else (c, c, c, 1)
        self.feed(n.inputs[0], fac)
        return n.outputs["Color"]

    def rampf(self, fac, stops, interp="LINEAR"):
        """Float remap through a colour ramp (grey values). stops = [(pos, value)]."""
        return self.bw(self.ramp(fac, [(p, float(v)) for p, v in stops], interp))

    def bw(self, col):
        n = self.node("ShaderNodeRGBToBW")
        self.feed(n.inputs[0], col)
        return n.outputs[0]

    def xyz(self, x=0.0, y=0.0, z=0.0):
        n = self.node("ShaderNodeCombineXYZ")
        for i, v in enumerate((x, y, z)):
            self.feed(n.inputs[i], v)
        return n.outputs[0]

    def sep(self, v):
        n = self.node("ShaderNodeSeparateXYZ")
        self.feed(n.inputs[0], v)
        return n.outputs

    # ------------------------------------------------------------------ textures (work in shader AND geometry trees)
    def noise(self, vec, scale=5.0, detail=4.0, rough=0.5, dist=0.0, lac=2.0, dim="3D", w=None, ntype="FBM"):
        n = self.node("ShaderNodeTexNoise", {"noise_dimensions": dim, "noise_type": ntype},
                      Vector=vec, Scale=scale, Detail=detail, Roughness=rough, Distortion=dist, Lacunarity=lac)
        if w is not None:
            self.feed(sock(n.inputs, "W"), w)
        return n

    def voronoi(self, vec, scale=5.0, feature="F1", metric="EUCLIDEAN", rand=1.0, dim="3D", smooth=None, detail=0.0):
        n = self.node("ShaderNodeTexVoronoi", {"feature": feature, "distance": metric, "voronoi_dimensions": dim},
                      Vector=vec, Scale=scale, Randomness=rand, Detail=detail)
        if smooth is not None:
            self.feed(sock(n.inputs, "Smoothness"), smooth)
        return n

    def wave(self, vec, scale=5.0, dist=4.0, detail=3.0, wtype="BANDS", direction="Z", profile="SIN", phase=0.0, dscale=1.0):
        props = {"wave_type": wtype, "wave_profile": profile}
        if wtype == "BANDS":
            props["bands_direction"] = direction
        else:
            props["rings_direction"] = direction
        return self.node("ShaderNodeTexWave", props, Vector=vec, Scale=scale, Distortion=dist, Detail=detail,
                         **{"Phase Offset": phase, "Detail Scale": dscale})

    def brick(self, vec, scale=1.0, width=0.5, height=0.25, mortar=0.02, msmooth=0.1, offset=0.5, freq=2, squash=1.0, c1=(0.8,) * 3, c2=(0.2,) * 3):
        return self.node("ShaderNodeTexBrick", {"offset": offset, "offset_frequency": freq, "squash": squash},
                         Vector=vec, Scale=scale, Color1=c1, Color2=c2, Mortar=(0, 0, 0, 1),
                         **{"Mortar Size": mortar, "Mortar Smooth": msmooth, "Brick Width": width, "Row Height": height})
