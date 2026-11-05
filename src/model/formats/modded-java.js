import { exportedHierarchy, vector, fileStem, cleanNumber } from './native-common.js';

const bytesToBase64 = bytes => typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
const base64ToBytes = text => typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(text, 'base64')) : Uint8Array.from(atob(text), char => char.charCodeAt(0));
async function sha256(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('');
}
export function javaClassName(filename) {
  const name = fileStem(filename).replace(/[^a-zA-Z0-9_$]/g, '_');
  const reserved = new Set(['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', 'record', 'var', 'yield']);
  return /^[a-zA-Z_$]/.test(name) && !reserved.has(name) && name !== '_' ? name : `Model_${name}`;
}
const float = n => `${Number.isInteger(cleanNumber(n)) ? cleanNumber(n) + '.0' : cleanNumber(n)}F`;

export async function exportModdedJava(bb, filename, locations) {
  const className = javaClassName(filename || bb.name), lines = [], groups = new Map(); let serial = 0;
  if (filename && fileStem(filename) !== className) throw Error('Java 文件名必须是合法的类名，请使用字母、数字或下划线');
  const add = (group, parents, cubes) => {
    const parent = parents.at(-1), parentOrigin = vector(parent?.origin), origin = vector(group.origin);
    const offset = origin.map((n, i) => i === 2 ? n - parentOrigin[i] : parentOrigin[i] - n);
    if (!parent) offset[1] += 24;
    const name = `part${++serial}`, parentVariable = parent ? groups.get(parent.uuid) : 'root'; groups.set(group.uuid, name);
    const pathName = `${group.name || 'part'}_${serial}`;
    let builder = 'CubeListBuilder.create()';
    for (const cube of cubes) {
      if (!cube.box_uv) throw Error('Java 模组实体导出需要箱型 UV');
      if (vector(cube.rotation).some(n => Math.abs(n) > 1e-6)) throw Error('Java 模组实体的 Cube 不能旋转，请使用组旋转');
      const [u, v] = cube.uv_offset || [0, 0], size = cube.to.map((n, i) => n - cube.from[i]);
      const local = [origin[0] - cube.to[0], origin[1] - cube.to[1], cube.from[2] - origin[2]];
      builder += `\n                .texOffs(${Math.round(u)}, ${Math.round(v)})${cube.mirror_uv ? '.mirror()' : ''}.addBox(${[...local, ...size].map(float).join(', ')}, new CubeDeformation(${float(cube.inflate || 0)}))${cube.mirror_uv ? '.mirror(false)' : ''}`;
    }
    const rotation = vector(group.rotation).map((n, i) => (i < 2 ? -n : n) * Math.PI / 180);
    const pose = rotation.some(n => Math.abs(n) > 1e-8) ? `PartPose.offsetAndRotation(${[...offset, ...rotation].map(float).join(', ')})` : `PartPose.offset(${offset.map(float).join(', ')})`;
    lines.push(`        PartDefinition ${name} = ${parentVariable}.addOrReplaceChild(${JSON.stringify(pathName)}, ${builder}, ${pose});`);
  };
  const elements = new Map(bb.elements.map(cube => [cube.uuid, cube]));
  const top = (bb.outliner || []).filter(item => typeof item === 'string').map(uid => elements.get(uid)).filter(cube => cube?.from && cube.export !== false);
  if (top.length) add({ uuid: '_root', name: 'model', origin: [0, 0, 0] }, [], top);
  exportedHierarchy(bb, (node, parents) => {
    if (!Array.isArray(node.children)) return;
    add(node, parents, node.children.filter(item => typeof item === 'string').map(uid => elements.get(uid)).filter(cube => cube?.from && cube.export !== false));
  });
  const restore = structuredClone(bb);
  restore.textures = restore.textures.map((texture, index) => ({ ...texture, source: undefined,
    path: locations[index]?.filePath || '', relative_path: undefined, resource: locations[index]?.resource }));
  restore._cubebricksNativeJava = true;
  const payload = bytesToBase64(new TextEncoder().encode(JSON.stringify(restore)));
  const body = `// CubeBricks Java model layer; Minecraft 1.17+ Mojang mappings.\n// Texture: ${JSON.stringify(locations[0]?.resource || '')}\nimport net.minecraft.client.model.geom.PartPose;\nimport net.minecraft.client.model.geom.builders.CubeDeformation;\nimport net.minecraft.client.model.geom.builders.CubeListBuilder;\nimport net.minecraft.client.model.geom.builders.LayerDefinition;\nimport net.minecraft.client.model.geom.builders.MeshDefinition;\nimport net.minecraft.client.model.geom.builders.PartDefinition;\n\npublic final class ${className} {\n    private ${className}() {}\n\n    public static LayerDefinition createBodyLayer() {\n        MeshDefinition mesh = new MeshDefinition();\n        PartDefinition root = mesh.getRoot();\n${lines.join('\n')}\n        return LayerDefinition.create(mesh, ${bb.resolution.width}, ${bb.resolution.height});\n    }\n}\n\n/* CubeBricks-Restore-v1\n${payload}\n*/\n`;
  return `// CubeBricks-SHA256: ${await sha256(body)}\n${body}`;
}

export async function importModdedJava(content) {
  const match = /^\/\/ CubeBricks-SHA256: ([a-f0-9]{64})\r?\n([\s\S]*)$/.exec(content);
  if (!match) throw Error('只能导回 CubeBricks 导出且未经修改的 Java 文件');
  if (await sha256(match[2]) !== match[1]) throw Error('Java 文件已被修改，无法安全导回模型');
  const payload = /\/\* CubeBricks-Restore-v1\n([A-Za-z0-9+/=]+)\n\*\/\n$/.exec(match[2]);
  if (!payload || payload[1].length > 32 * 1024 * 1024) throw Error('Java 文件的还原信息无效');
  const bb = JSON.parse(new TextDecoder().decode(base64ToBytes(payload[1])));
  if (bb?.meta?.model_format !== 'modded_entity' || !Array.isArray(bb.elements) || !Array.isArray(bb.textures)) throw Error('Java 文件的还原信息无效');
  return bb;
}
