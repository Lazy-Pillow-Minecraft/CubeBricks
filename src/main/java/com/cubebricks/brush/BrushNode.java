package com.cubebricks.brush;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Stable node identity keeps cube edit overrides attached after regeneration. */
public final class BrushNode {
    private final UUID id = UUID.randomUUID();
    private Vec3 position;
    private final Map<String, Double> parameters = new LinkedHashMap<>();

    public BrushNode(Vec3 position) { this.position = position; }
    public UUID id() { return id; }
    public Vec3 position() { return position; }
    public void setPosition(Vec3 position) { this.position = position; }
    public Map<String, Double> parameters() { return Map.copyOf(parameters); }
    public void setParameter(String key, double value) { parameters.put(key, value); }
}
