# Prompt templates

Text prompts that work well for generating game and 3D-production art through
the image Spaces: model sheets for modellers and image-to-3D, concept art for a
setting, and prop sheets for environment artists. They are plain text with
`{PLACEHOLDERS}`; fill them in, or let the `model_sheet` tool do it for a model
sheet.

Everything here is under the MIT licence of the repository.

---

## 1. The 4-in-1 model sheet (turnaround sheet)

One image with four consistent angles of one and the same object. It is the best
reference for a modeller and the best input for image-to-3D models (TRELLIS,
Hunyuan3D-2): a clean 3/4 view on a plain background gives a usable shape.

### Base template

```text
Model sheet and turnaround presentation of {NAME}, {SUBJECT}. Clean studio presentation board displaying four distinct angles of the exact same object on a single image:
1) Straight front orthographic view: {FRONT_DESCRIPTION}.
2) Straight rear orthographic view: {REAR_DESCRIPTION}.
3) Side profile orthographic view: {SIDE_DESCRIPTION}.
4) Dynamic 3/4 front perspective view: {PERSPECTIVE_DESCRIPTION}.
Design reference: {REFERENCE}.
Finish: {FINISH}, neutral light gray studio cyclorama, crisp technical studio lighting, 8k turnaround sheet, no logos, no emblems, no text, no watermark.
```

### The fields

| Field | Purpose | Example |
| :--- | :--- | :--- |
| `{NAME}` | A fictional name for the object | `Ember Lantern`, `Warden Mk II`, `Harbor Tug 7` |
| `{SUBJECT}` | What it is, in a few words | `a hand-forged iron street lantern`, `a bipedal maintenance robot`, `a mid-engine sports coupe` |
| `{FRONT_DESCRIPTION}` | Main face: the features that identify the object | `a glass cage with a brass door and a ring handle on top` |
| `{REAR_DESCRIPTION}` | Back: construction, openings, attachments | `a riveted iron back plate with a hinged maintenance hatch` |
| `{SIDE_DESCRIPTION}` | Silhouette: proportions, depth, how parts fit together | `a tapering post with a curled bracket arm, wide base flange` |
| `{PERSPECTIVE_DESCRIPTION}` | The 3/4 view: volume, materials, stance | `showing the sculptural volume and the weathered metal` |
| `{REFERENCE}` | The design it is based on or inspired by | `Victorian gas street lamps crossed with industrial work lights` |
| `{FINISH}` | Colour, material and surface | `dark bronze with a worn patina`, `matte white ceramic` |

### Composition rules

1. **No real logos or text.** Always add `no logos, no emblems, no text, no
   watermark` so the model does not draw distorted brand marks, crests or
   gibberish lettering. Models still sneak an emblem onto a nose or a hood now
   and then, so look at every take for one.
2. **Neutral background.** `neutral light gray studio cyclorama, crisp technical
   lighting` gives a clean background with no artefacts baked in when the image
   goes into an image-to-3D model.
3. **One object, four angles.** Say `the exact same object` and keep the four
   descriptions consistent, or the views drift apart.
4. **Rule out what you do not want.** If the reference may drag in a foreign
   detail, say so: `strictly no ornamental filigree`, `no cables`.

### Worked examples

```text
Model sheet and turnaround presentation of Ember Lantern, a hand-forged iron street lantern. Clean studio presentation board displaying four distinct angles of the exact same object on a single image:
1) Straight front orthographic view: a glass cage with a brass door and a ring handle on top.
2) Straight rear orthographic view: a riveted iron back plate with a hinged maintenance hatch.
3) Side profile orthographic view: a tapering post with a curled bracket arm and a wide base flange.
4) Dynamic 3/4 front perspective view: showing the sculptural volume and the weathered metal.
Design reference: Victorian gas street lamps crossed with industrial work lights.
Finish: dark bronze with a worn patina, neutral light gray studio cyclorama, crisp technical studio lighting, 8k turnaround sheet, no logos, no emblems, no text, no watermark.
```

```text
Model sheet and turnaround presentation of Warden Mk II, a bipedal maintenance robot. Clean studio presentation board displaying four distinct angles of the exact same object on a single image:
1) Straight front orthographic view: a rounded visor, a chest panel with three round indicator lamps, and broad shoulder plates.
2) Straight rear orthographic view: a power pack with cooling fins and a cable reel on the lower back.
3) Side profile orthographic view: a slight forward lean, digitigrade legs and thick forearm tool mounts.
4) Dynamic 3/4 front perspective view: showing the chunky industrial volume and a neutral standing pose.
Design reference: 1970s industrial design and heavy-duty power tools.
Finish: matte safety yellow with dark grey joints, neutral light gray studio cyclorama, crisp technical studio lighting, 8k turnaround sheet, no logos, no emblems, no text, no watermark.
```

### Vehicles

For a car, a bike or any other vehicle, use the `vehicle` preset of `model_sheet`.
It keeps the same four views and adds wording that holds the design in factory
trim, so the model does not invent body kits, sponsor decals or tuning:

```text
Design model sheet and blueprint turnaround presentation of Aurora GT, a mid-engine sports coupe, pristine factory stock condition. Clean studio presentation board displaying four distinct angles of the exact same vehicle on a single image:
1) Straight front orthographic view: low aerodynamic nose, sculpted intake, slim modern lamps and a lower splitter.
2) Straight rear orthographic view: integrated spoiler, a horizontal lamp signature and clean exhaust outlets.
3) Side profile orthographic view: low-slung silhouette, sculpted side ducts, factory ride height and alloy wheels.
4) Dynamic 3/4 front perspective view: showing the sculptural 3D body volume and the factory stance.
Design reference: classic and modern performance heritage.
Finish: pearl white metallic, neutral light gray studio cyclorama, crisp technical studio lighting, 8k turnaround sheet, a plain unbadged body with no logos, no badges, no emblems or crests, fictional design.
```

Keep real marque names out of the prompt: the model will copy their badges, and
the result may not be usable in a shipped game.

---

## 2. Concept art for a setting

A single establishing image of a place, for the mood and the colour script of a
level before anything is modelled.

```text
Create a AAA video game concept art, wide establishing shot:
'{LOCATION_TITLE}'
Setting: {SCENIC_SETTING}. {KEY_LANDMARKS}. A clear focal point and a readable path through the frame.
Action: {ACTION_OR_LIFE_IN_THE_SCENE}.
Atmosphere & Lighting: {LIGHTING_AND_WEATHER}, cinematic wide-angle lens, photorealistic environment, {STYLE_REFERENCE}, 8k resolution, strong sense of scale and depth, no text, no watermark.
```

| Field | Example |
| :--- | :--- |
| `{LOCATION_TITLE}` | `Saltmarsh Lighthouse` |
| `{SCENIC_SETTING}` | `a tidal flat at dawn with a lone stone lighthouse on a causeway` |
| `{KEY_LANDMARKS}` | `a rusted tide gate, a half-sunk fishing boat and a line of timber posts leading to the tower` |
| `{ACTION_OR_LIFE_IN_THE_SCENE}` | `a keeper carries a lantern along the causeway as gulls lift off the flats` |
| `{LIGHTING_AND_WEATHER}` | `low golden sun through thin sea mist, wet sand reflecting the sky` |
| `{STYLE_REFERENCE}` | `a painterly adventure-game look with a muted, cool palette` |

Tips:

- Put the gameplay constraint in the prompt, not only the mood: `a clear flat
  walkable path`, `the player route in the foreground`, `no dead-end clutter`.
- Name what must **not** appear (`no modern buildings`, `no people`) — the model
  adds elements to fill a frame.

---

## 3. Prop sheets (environment kits)

Isolated collections of objects for modellers and environment artists.

### Formatting rules

1. **Neutral studio background.** Always `neutral light gray studio background` —
   no environment behind the objects.
2. **Isolation.** Every object stands alone with a crisp silhouette (ambient
   occlusion, soft drop shadow), convenient for cut-out and modelling.
3. **One theme per sheet.** A set of objects that belong together reads better
   than a mixed bag: `harbour clutter`, `ruined temple pieces`, `street furniture`.

### Template

```text
Create a 3D environment prop collage / asset kit sheet for a video game 3D artist:
'{KIT_TITLE} Asset Sheet'
Format: Clean studio presentation board with a neutral light gray background, displaying an organized collection of distinct, isolated 3D environment assets for {DESCRIPTION_OF_THEME}. Each model is cleanly isolated with sharp silhouettes and clear PBR materials for 3D modelers and texture artists.
Included Assets (neatly arranged):
1. {ASSET_CATEGORY_1}: {ASSET_1_DETAILS}
2. {ASSET_CATEGORY_2}: {ASSET_2_DETAILS}
3. {ASSET_CATEGORY_3}: {ASSET_3_DETAILS}
4. {ASSET_CATEGORY_4}: {ASSET_4_DETAILS}
5. {ASSET_CATEGORY_5}: {ASSET_5_DETAILS}
Style: Crisp ambient occlusion, soft studio neutral lighting, sharp technical PBR materials ({MATERIALS_LIST}), high readability for 3D asset production, no text, no watermark.
```

Example theme: `Harbour Clutter` — crates, rope coils, mooring bollards, barrels, a
weathered fishing net on a frame; materials `weathered timber, rusted iron, wet
rope, tarred canvas`.
