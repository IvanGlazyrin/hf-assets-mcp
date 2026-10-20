"""Studio renders of a raw AI-generated mesh, as delivered (no clean-up).

Run headless, with the arguments after `--`:
    blender --background --factory-startup --python render_raw.py -- <glb> <out_dir> <prefix> [length_m] [samples] [width] [height]

The mesh is turned so its longest horizontal axis runs along Y, scaled to `length_m`
(default 2 m), centred and put on the floor. Meshes without a material get a plain
matte grey clay material so the form reads. Six views go to
<out_dir>/<prefix>_{a..f}.png. Which end is the front is not known; the views cover both.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from studio_render import render_set, setup_studio  # noqa: E402

VIEWS = [("a", 35, 12, 7.5), ("b", 90, 3, 8.5), ("c", 145, 14, 7.5), ("d", 215, 12, 7.5), ("e", 270, 3, 8.5),
         ("f", 0, 5, 7.0)]


def render_raw(glb, out_dir, prefix, length=2, samples=64, resolution=(1280, 720)):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # bake every transform (and parent empties) into the mesh data, then place by data only
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
    for o in [o for o in bpy.data.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)

    def bounds():
        pts = [v.co for o in meshes for v in o.data.vertices]
        return (Vector([min(p[i] for p in pts) for i in range(3)]),
                Vector([max(p[i] for p in pts) for i in range(3)]))
    mn, mx = bounds()
    ext = mx - mn
    t = Matrix.Identity(4)
    if ext.x > ext.y:
        t = Matrix.Rotation(math.pi / 2, 4, 'Z')
    s = length / max(ext.x, ext.y)
    t = Matrix.Scale(s, 4) @ t
    for o in meshes:
        o.data.transform(t)
    mn, mx = bounds()
    shift = Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z)))
    for o in meshes:
        o.data.transform(shift)
        o.data.update()
    mn, mx = bounds()
    paint = None
    for o in meshes:
        if not o.data.materials:
            if paint is None:
                paint = bpy.data.materials.new("raw_clay")
                paint.use_nodes = True
                b = next(n for n in paint.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
                b.inputs["Base Color"].default_value = (0.55, 0.55, 0.57, 1)
                b.inputs["Roughness"].default_value = 0.6
            o.data.materials.append(paint)
        for p in o.data.polygons:
            p.use_smooth = True
    setup_studio(samples=samples, resolution=resolution)
    os.makedirs(out_dir, exist_ok=True)
    faces = sum(len(o.data.polygons) for o in meshes)
    render_set(out_dir, prefix, VIEWS)
    return faces, [round(c, 2) for c in (mx - mn)]


if __name__ == "__main__" and "--" in sys.argv:
    a = sys.argv[sys.argv.index("--") + 1:]
    print(render_raw(
        a[0],
        a[1],
        a[2],
        float(a[3]) if len(a) > 3 else 2.0,
        int(a[4]) if len(a) > 4 else 64,
        (int(a[5]), int(a[6])) if len(a) > 6 else (1280, 720),
    ))
