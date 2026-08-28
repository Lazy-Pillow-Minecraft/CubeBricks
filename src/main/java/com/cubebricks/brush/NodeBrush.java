package com.cubebricks.brush;

import java.util.List;

/** Base for brushes whose cube output is controlled by local-space nodes. */
public abstract class NodeBrush extends Brush {
    protected NodeBrush(String name) { super(name); }
    public abstract List<BrushNode> nodes();
}
