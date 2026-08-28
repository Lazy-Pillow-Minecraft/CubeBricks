package com.cubebricks.brush;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Nodes have named roles and a fixed schema, e.g. shoulder, elbow, and wrist. */
public final class FixedNodeBrush extends NodeBrush {
    private final Map<String, BrushNode> nodesByRole;

    public FixedNodeBrush(String name, Map<String, Vec3> nodeSchema) {
        super(name);
        nodesByRole = new LinkedHashMap<>();
        nodeSchema.forEach((role, position) -> nodesByRole.put(role, new BrushNode(position)));
    }

    public static FixedNodeBrush createArm(String name) {
        return new FixedNodeBrush(name, Map.of(
            "shoulder", new Vec3(0, 2, 0),
            "elbow", new Vec3(0, 0, 0),
            "wrist", new Vec3(0, -2, 0)
        ));
    }

    public BrushNode node(String role) {
        BrushNode node = nodesByRole.get(role);
        if (node == null) throw new IllegalArgumentException("Unknown node role: " + role);
        return node;
    }
    public Map<String, BrushNode> nodesByRole() { return Map.copyOf(nodesByRole); }
    @Override public List<BrushNode> nodes() { return List.copyOf(nodesByRole.values()); }
}
