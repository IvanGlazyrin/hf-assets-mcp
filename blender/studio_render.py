"""Studio lighting and turntable rendering for Blender.

`render_raw.py` calls this to frame a mesh that is already in the scene:

    setup_studio()                       -> cyclorama, key/fill/rim lights, camera, render settings
    render_set(out_dir, prefix, views)   -> one PNG per view

A view is `(label, azimuth_deg, elevation_deg, distance_m)`: the camera goes to
that azimuth and elevation around the subject and looks back at its centre. The
azimuth is a compass bearing — 0 looks along -Y, 90 along -X — and the mesh lies
with its longest axis along Y, so 0 is an end of the subject and 90 is its
long side. The distance is measured from the subject's centre and is a
floor: the camera is pushed further out if the subject would not fit.

The camera is always derived from the subject itself, never placed by hand — a
hand-placed camera ends up inside the geometry.

Part of this repository, MIT-licensed like the rest of it.
"""

import math
import os

import bpy
from mathutils import Vector

# The meshes the studio frames. Captured by setup_studio() before the backdrop
# is added, so the floor never counts as the subject.
SUBJECT = []


def _subject_objects():
    if SUBJECT:
        return SUBJECT
    return [o for o in bpy.context.scene.objects
            if o.type == "MESH" and not o.name.startswith("studio_")]


def _world_points(objects):
    # Read the vertices, not `bound_box`: the mesh data may have been transformed
    # after import and the cached box is then stale.
    return [o.matrix_world @ v.co for o in objects for v in o.data.vertices]


def _centre(points):
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return (lo + hi) / 2


def _tan_half_fovs(cam, scene):
    """Half-angles of the frame, as tangents, for the camera and the resolution."""
    res_x = scene.render.resolution_x * scene.render.resolution_percentage / 100
    res_y = scene.render.resolution_y * scene.render.resolution_percentage / 100
    fit = cam.data.sensor_fit
    if fit == "VERTICAL":
        tan_v = (cam.data.sensor_height / 2) / cam.data.lens
        tan_h = tan_v * (res_x / res_y)
    elif fit == "HORIZONTAL":
        tan_h = (cam.data.sensor_width / 2) / cam.data.lens
        tan_v = tan_h * (res_y / res_x)
    elif res_x >= res_y:
        tan_h = (cam.data.sensor_width / 2) / cam.data.lens
        tan_v = tan_h * (res_y / res_x)
    else:
        tan_v = (cam.data.sensor_height / 2) / cam.data.lens
        tan_h = tan_v * (res_x / res_y)
    return tan_h, tan_v


def _direction(azimuth, elevation):
    """Camera direction for a view.

    The azimuth is a compass bearing: 0 looks along -Y, 90 along -X. The mesh
    is laid out with its longest axis along Y, so azimuth 0 is an end of the
    subject and azimuth 90 is its long side.
    """
    az, el = math.radians(azimuth), math.radians(elevation)
    return Vector((math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)))


def _fit_distance(points, centre, azimuth, elevation, tan_h, tan_v):
    """Closest distance at which the whole subject fits the frame from this angle.

    The camera looks at the subject's centre, so a point's lateral offset does
    not change with distance — only its depth does. The distance therefore has
    to satisfy `lateral <= tan(fov/2) * depth` for every point.
    """
    forward = -_direction(azimuth, elevation)
    right = forward.cross(Vector((0.0, 0.0, 1.0)))
    if right.length < 1e-9:
        right = Vector((1.0, 0.0, 0.0))
    right.normalize()
    up = right.cross(forward)
    need = 0.0
    for p in points:
        q = p - centre
        depth = q.dot(forward)
        need = max(need, abs(q.dot(right)) / tan_h - depth, abs(q.dot(up)) / tan_v - depth)
    return need


def _material(name, colour, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def _link(name, data):
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _floor(size=200.0):
    mesh = bpy.data.meshes.new("studio_floor")
    mesh.from_pydata([(-size, -size, 0), (size, -size, 0), (size, size, 0), (-size, size, 0)],
                     [], [(0, 1, 2, 3)])
    mesh.update()
    floor = _link("studio_floor", mesh)
    floor.data.materials.append(_material("studio_floor_mat", (0.72, 0.72, 0.73), roughness=0.45))
    return floor


def _world(strength=0.45):
    world = bpy.data.worlds.new("studio_world")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.bl_idname == "ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.62, 0.64, 0.68, 1.0)
    bg.inputs["Strength"].default_value = strength
    bpy.context.scene.world = world
    return world


def _light(name, kind, location, energy, colour=(1.0, 1.0, 1.0), size=None, angle=None,
           target=(0.0, 0.0, 0.0)):
    data = bpy.data.lights.new(name, type=kind)
    data.energy = energy
    data.color = colour
    if kind == "SUN":
        data.angle = angle if angle is not None else math.radians(0.9)
    elif kind == "AREA":
        data.shape = "SQUARE"
        data.size = size if size is not None else 6.0
    obj = _link(name, data)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def _camera(lens=50.0):
    data = bpy.data.cameras.new("studio_cam")
    data.lens = lens
    data.sensor_width = 36.0
    cam = _link("studio_cam", data)
    bpy.context.scene.camera = cam
    return cam


def _set_engine(scene, engine):
    for candidate in (engine, "CYCLES", "BLENDER_EEVEE"):
        try:
            scene.render.engine = candidate
            return scene.render.engine
        except TypeError:
            continue
    return scene.render.engine


def setup_studio(samples=64, resolution=(1280, 720), engine="CYCLES"):
    """Build the studio around whatever is already in the scene.

    The subject is left untouched: only the backdrop, the lights, the camera and
    the render settings are added.
    """
    global SUBJECT
    SUBJECT = [o for o in bpy.context.scene.objects if o.type == "MESH"]

    scene = bpy.context.scene
    _floor()
    _world()

    # Key: one hard sun, high and to the front-left, so the top surfaces read.
    _light("studio_key", "SUN", (-9.0, -9.0, 11.0), 3.2, angle=math.radians(0.9))
    # Fill: large soft area opposite the key, tinted cool, so shadows keep detail.
    _light("studio_fill", "AREA", (9.0, -6.0, 5.0), 900.0, colour=(0.82, 0.88, 1.0), size=8.0)
    # Rim: cold and from behind, so the silhouette separates from the backdrop.
    _light("studio_rim", "AREA", (4.0, 10.0, 6.0), 600.0, colour=(0.85, 0.92, 1.0), size=5.0)

    _camera()

    scene.render.engine = _set_engine(scene, engine)
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        pass
    return scene


def render_set(out_dir, prefix, views):
    """Render one frame per view into `<out_dir>/<prefix>_<label>.png`."""
    scene = bpy.context.scene
    cam = scene.camera
    objects = _subject_objects()
    if not objects:
        raise SystemExit("studio_render: no mesh in the scene to frame")
    bpy.context.view_layer.update()

    points = _world_points(objects)
    centre = _centre(points)
    tan_h, tan_v = _tan_half_fovs(cam, scene)

    os.makedirs(out_dir, exist_ok=True)
    for label, azimuth, elevation, distance in views:
        # The authored distance is the floor; the computed fit only pushes the
        # camera out when the subject would not fit at that distance.
        need = _fit_distance(points, centre, azimuth, elevation, tan_h, tan_v) * 1.05
        dist = max(distance, need)
        direction = _direction(azimuth, elevation)
        cam.location = centre + direction * dist
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out_dir, f"{prefix}_{label}.png")
        bpy.ops.render.render(write_still=True)
    return len(views)
