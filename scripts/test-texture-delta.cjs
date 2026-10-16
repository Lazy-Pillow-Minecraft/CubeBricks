const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodePng, encodePng, createTextureDelta, applyTextureDelta, textureSourceFingerprint } = require('../electron/texture-delta.cjs');

function chunk(type, data) {
  const kind = Buffer.from(type);
  let checksum = 0xffffffff;
  for (const byte of Buffer.concat([kind, data])) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = checksum & 1 ? 0xedb88320 ^ checksum >>> 1 : checksum >>> 1;
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  kind.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, data.length + 8);
  return result;
}

function png({ width = 1, height = 1, colorType = 6, bitDepth = 8, samples = [40, 70, 90, 255], transparency, level = 0 }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  return `data:image/png;base64,${Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    ...(transparency ? [chunk('tRNS', Buffer.from(transparency))] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, ...samples]), { level })), chunk('IEND', Buffer.alloc(0))
  ]).toString('base64')}`;
}

test('equivalent PNG encodings have the same fingerprint and produce no pixel delta', () => {
  const original = png({});
  const canonical = encodePng(decodePng(original));
  assert.notEqual(original, canonical);
  assert.equal(textureSourceFingerprint(original), textureSourceFingerprint(canonical));
  const delta = createTextureDelta(original, canonical);
  assert.equal(delta.kind, 'unchanged');
  assert.equal(applyTextureDelta(original, delta), original);
  assert.equal(applyTextureDelta(original, { kind: 'tiles', width: 1, height: 1, tiles: [] }), original);
});

test('tile undo accepts equivalent encodings and restores pixels in both directions', () => {
  const original = png({});
  const painted = png({ samples: [180, 70, 90, 128] });
  const delta = createTextureDelta(original, painted);
  assert.equal(delta.kind, 'tiles');
  const restored = applyTextureDelta(encodePng(decodePng(painted)), delta, 'before');
  assert.equal(textureSourceFingerprint(restored), textureSourceFingerprint(original));
  assert.equal(textureSourceFingerprint(applyTextureDelta(restored, delta, 'after')), textureSourceFingerprint(painted));
});

test('unsupported and malformed PNG sources remain losslessly reversible replace deltas', () => {
  const valid = png({});
  const unsupported = png({ colorType: 0, bitDepth: 16, samples: [20, 0] });
  const malformed = valid.slice(0, -12);
  for (const source of [unsupported, malformed, 'data:image/jpeg;base64,test']) {
    const delta = createTextureDelta(source, valid);
    assert.equal(delta.kind, 'replace');
    assert.equal(applyTextureDelta(valid, delta, 'before'), source);
    assert.equal(applyTextureDelta(source, delta, 'after'), valid);
    assert.doesNotThrow(() => textureSourceFingerprint(source));
  }
});

test('grayscale and RGB transparent keys stay transparent after tile undo', () => {
  for (const [colorType, samples, transparency] of [[0, [40], [0, 40]], [2, [40, 70, 90], [0, 40, 0, 70, 0, 90]]]) {
    const original = png({ colorType, samples, transparency });
    assert.equal(decodePng(original).rgba[3], 0);
    const changed = png({ samples: [40, 70, 90, 255] });
    const restored = applyTextureDelta(changed, createTextureDelta(original, changed), 'before');
    assert.deepEqual(decodePng(restored).rgba, decodePng(original).rgba);
  }
});

test('wrong tile basis and malformed tile bounds are rejected instead of changing unrelated pixels', () => {
  const original = png({});
  const painted = png({ samples: [180, 70, 90, 128] });
  const delta = createTextureDelta(original, painted);
  assert.throws(() => applyTextureDelta(painted, delta, 'after'), /原始像素/);
  assert.throws(() => applyTextureDelta(original, { ...delta, tiles: [{ ...delta.tiles[0], x: 1 }] }), /範圍/);
  assert.throws(() => applyTextureDelta(original, { ...delta, tiles: [...delta.tiles, ...delta.tiles] }), /範圍/);
  assert.throws(() => applyTextureDelta(original, { ...delta, kind: 'unknown' }), /類型/);
});
