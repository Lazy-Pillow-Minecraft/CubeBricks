package com.cubebricks.brush;

/** Transform in editor units; all node coordinates remain local to their brush. */
public record Transform(Vec3 position, Vec3 rotation, Vec3 scale, Vec3 pivot) {
    public static final Transform IDENTITY = new Transform(Vec3.ZERO, Vec3.ZERO, Vec3.ONE, Vec3.ZERO);
}
