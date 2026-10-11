import { Cube, CubeBricksProject, Group } from '../model.js';

// Compact render-only form of the supplied player reference. It deliberately
// is not stored as a .bbmodel and never joins the editable project hierarchy.
export const DEFAULT_PLAYER_REFERENCE_TEXTURE = 'data:image/png;base64,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';

const faceSet = (east, north, west, south, up, down) => ({
  east: { uv: east, texture: 'player' }, north: { uv: north, texture: 'player' },
  west: { uv: west, texture: 'player' }, south: { uv: south, texture: 'player' },
  up: { uv: up, texture: 'player' }, down: { uv: down, texture: 'player' }
});

const PLAYER_CUBES = Object.freeze([
  ['head', 'Head', [26.07136,22.7476,4.90878], [33.56976,30.246,12.40718], 0,
    faceSet([0,8,8,16],[8,8,16,16],[16,8,24,16],[24,8,32,16],[16,8,8,0],[24,0,16,8])],
  ['hat', 'Hat Layer', [26.10271,22.77895,4.94013], [33.53841,30.21465,12.37583], .5,
    faceSet([32,8,40,16],[40,8,48,16],[48,8,56,16],[56,8,64,16],[48,8,40,0],[56,0,48,8])],
  ['body', 'Body', [26.07136,11.5,6.78338], [33.56976,22.7476,10.53258], 0,
    faceSet([16,20,20,32],[20,20,28,32],[28,20,32,32],[32,20,40,32],[28,20,20,16],[36,16,28,20])],
  ['body_layer', 'Body Layer', [26.08704,11.51568,6.79905], [33.55409,22.73193,10.5169], .25,
    faceSet([16,36,20,48],[20,36,28,48],[28,36,32,48],[32,36,40,48],[28,36,20,32],[36,32,28,36])],
  ['right_arm', 'Right Arm', [33.56976,11.5,6.78338], [37.31896,22.7476,10.53258], 0,
    faceSet([40,20,44,32],[44,20,48,32],[48,20,52,32],[52,20,56,32],[48,20,44,16],[52,16,48,20])],
  ['right_arm_layer', 'Right Arm Layer', [33.58544,11.51568,6.79905], [37.30329,22.73193,10.5169], .25,
    faceSet([40,36,44,48],[44,36,48,48],[48,36,52,48],[52,36,56,48],[48,36,44,32],[52,32,48,36])],
  ['left_arm', 'Left Arm', [22.32216,11.5,6.78338], [26.07136,22.7476,10.53258], 0,
    faceSet([32,52,36,64],[36,52,40,64],[40,52,44,64],[44,52,48,64],[40,52,36,48],[44,48,40,52])],
  ['left_arm_layer', 'Left Arm Layer', [22.33784,11.51568,6.79905], [26.05569,22.73193,10.5169], .25,
    faceSet([48,52,52,64],[52,52,56,64],[56,52,60,64],[60,52,64,64],[56,52,52,48],[60,48,56,52])],
  ['right_leg', 'Right Leg', [29.72683,.2524,6.78338], [33.47603,11.5,10.53258], 0,
    faceSet([0,20,4,32],[4,20,8,32],[8,20,12,32],[12,20,16,32],[8,20,4,16],[12,16,8,20])],
  ['right_leg_layer', 'Right Leg Layer', [29.74251,.26807,6.79905], [33.46036,11.48432,10.5169], .25,
    faceSet([0,36,4,48],[4,36,8,48],[8,36,12,48],[12,36,16,48],[8,36,4,32],[12,32,8,36])],
  ['left_leg', 'Left Leg', [26.16509,.2524,6.78338], [29.91429,11.5,10.53258], 0,
    faceSet([16,52,20,64],[20,52,24,64],[24,52,28,64],[28,52,32,64],[24,52,20,48],[28,48,24,52])],
  ['left_leg_layer', 'Left Leg Layer', [26.18077,.26807,6.79905], [29.89862,11.48432,10.5169], .25,
    faceSet([0,52,4,64],[4,52,8,64],[8,52,12,64],[12,52,16,64],[8,52,4,48],[12,48,8,52])]
]);

export function createPlayerReferenceProject() {
  const elements = PLAYER_CUBES.map(([id, name, from, to, inflate, faces]) => new Cube({
    uid: `player_reference_${id}`,
    name,
    position: from,
    size: to.map((value, axis) => value - from[axis]),
    pivot: [29.82056, .2524, 8.65798],
    inflate,
    uvMode: 'face',
    faces,
    color: '#ffffff',
    autoUv: false,
    exported: false
  }));
  const ids = Object.fromEntries(elements.map(element => [element.uid.replace('player_reference_', ''), element.uid]));
  const groups = [
    new Group({ uid: 'player_reference_head_group', name: 'Head', pivot: [29.82056,22.7476,8.65798], rotation: [0,17.5,0], children: [ids.head, ids.hat], exported: false }),
    new Group({ uid: 'player_reference_body_group', name: 'Body', pivot: [29.82056,22.7476,8.65798], children: [ids.body, ids.body_layer], exported: false }),
    new Group({ uid: 'player_reference_right_arm_group', name: 'Right Arm', pivot: [34.50706,20.873,8.65798], rotation: [0,0,2.5], children: [ids.right_arm, ids.right_arm_layer], exported: false }),
    new Group({ uid: 'player_reference_left_arm_group', name: 'Left Arm', pivot: [25.13406,20.873,8.65798], rotation: [0,0,-5], children: [ids.left_arm, ids.left_arm_layer], exported: false }),
    new Group({ uid: 'player_reference_right_leg_group', name: 'Right Leg', pivot: [31.60143,11.5,8.65798], children: [ids.right_leg, ids.right_leg_layer], exported: false }),
    new Group({ uid: 'player_reference_left_leg_group', name: 'Left Leg', pivot: [28.03969,11.5,8.65798], children: [ids.left_leg, ids.left_leg_layer], exported: false })
  ];
  const group = id => groups.find(entry => entry.uid === id);
  const waist = new Group({
    uid: 'player_reference_waist_group', name: 'Waist', pivot: [29.82056,11.5,8.65798], exported: false,
    children: ['player_reference_head_group', 'player_reference_body_group', 'player_reference_right_arm_group', 'player_reference_left_arm_group']
  });
  const root = new Group({
    uid: 'player_reference_root', name: 'Player Reference', pivot: [28.03969,11.5,8.65798], rotation: [0,20,0], exported: false,
    children: [group('player_reference_left_leg_group').uid, waist.uid, group('player_reference_right_leg_group').uid]
  });
  groups.push(waist, root);
  return new CubeBricksProject({
    name: 'player_reference', modelType: 'free', textureSize: [64, 64], renderType: 'cutout', cullFaces: true,
    elements, groups, outliner: [root.uid]
  });
}
