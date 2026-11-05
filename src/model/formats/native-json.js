import { importJavaJson, exportJavaJson } from './java-json.js';
import { importBedrockJson, exportBedrockJson } from './bedrock-json.js';
import { modelFormatRegistry } from '../../common/config/model-formats.js';

export function nativeExportKind(formatId) {
  const codec = modelFormatRegistry.resolve(formatId)?.nativeExport;
  if (codec === 'java_layer') return 'java';
  if (codec === 'java_block' || codec === 'bedrock_geometry') return 'json';
  return null;
}

export function decodeNativeJson(data, name = '', references = [], formatId) {
  if (data?.format === 'cubebricks-texture-references') throw Error('这是贴图索引，请打开对应的模型文件');
  if (data?.meta?.model_format || data?.projectUuid || data?.formatId || data?.formatVersion || data?.modelType || Array.isArray(data?.textures)) return data;
  if (Array.isArray(data?.['minecraft:geometry']) || Object.keys(data || {}).some(key => key.startsWith('geometry.') && data[key]?.bones))
    return importBedrockJson(data, name, references, formatId);
  if (data && (Array.isArray(data.elements) || typeof data.parent === 'string' || data.textures && !Array.isArray(data.textures)))
    return importJavaJson(data, name, references);
  throw Error('无法识别该 JSON 的原生模型格式');
}

export function encodeNativeJson(bbmodel, locations, formatId, formatData = {}) {
  if (nativeExportKind(formatId) !== 'json') throw Error('该模型格式不支持原生 JSON');
  return modelFormatRegistry.resolve(formatId)?.nativeExport === 'java_block' ? exportJavaJson(bbmodel, locations, formatData) : exportBedrockJson(bbmodel, locations, formatData);
}
