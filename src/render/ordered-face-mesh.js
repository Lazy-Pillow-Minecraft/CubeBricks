// Camera sorting changes only element indices. Geometry stays in its existing
// vertex buffer until its source meshes or active membership change.
export class OrderedFaceMesh {
  constructor(gl, vertexBuffer, unsignedInt) {
    this.gl = gl; this.vertexBuffer = vertexBuffer; this.unsignedInt = unsignedInt;
    this.indexBuffer = gl.createBuffer(); this.ranges = null;
  }
  reset() { this.ranges = null; this.indices = null; }
  update(faces, reusable) {
    const gl = this.gl;
    if (!reusable || !this.ranges) {
      const count = faces.reduce((sum, face) => sum + face.vertices.length / 12, 0);
      if (count > 65535 && !this.unsignedInt) { this.ranges = null; return null; }
      const vertices = new Float32Array(count * 12), ranges = new Map();
      let offset = 0;
      for (const face of faces) {
        ranges.set(face, { start: offset / 12, count: face.vertices.length / 12 });
        vertices.set(face.vertices, offset); offset += face.vertices.length;
      }
      this.ranges = ranges;
      this.indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
      this.type = count > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices.byteLength, gl.DYNAMIC_DRAW);
    }
    let offset = 0;
    for (const face of faces) {
      const range = this.ranges.get(face);
      for (let i = 0; i < range.count; i++) this.indices[offset++] = range.start + i;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.indices);
    return { buffer: this.indexBuffer, type: this.type };
  }
}
