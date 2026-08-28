package com.cubebricks.brush;

import java.util.ArrayList;
import java.util.List;

/** Homogeneous nodes may be added and removed freely, e.g. paths or chains. */
public final class FreeformNodeBrush extends NodeBrush {
    private final List<BrushNode> nodes = new ArrayList<>();

    public FreeformNodeBrush(String name) { super(name); }
    public BrushNode addNode(Vec3 position) {
        BrushNode node = new BrushNode(position);
        nodes.add(node);
        return node;
    }
    public boolean removeNode(BrushNode node) { return nodes.remove(node); }
    @Override public List<BrushNode> nodes() { return List.copyOf(nodes); }
}
