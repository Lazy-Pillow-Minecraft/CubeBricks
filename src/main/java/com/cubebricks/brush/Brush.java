package com.cubebricks.brush;

import java.util.Objects;
import java.util.UUID;
import java.util.List;

/** A persistent procedural element in the editor document. */
public abstract class Brush {
    private final UUID id = UUID.randomUUID();
    private String name;
    private Transform transform = Transform.IDENTITY;

    protected Brush(String name) {
        this.name = Objects.requireNonNull(name, "name");
    }

    public UUID id() { return id; }
    public String name() { return name; }
    public void setName(String name) { this.name = Objects.requireNonNull(name, "name"); }
    public Transform transform() { return transform; }
    public void setTransform(Transform transform) { this.transform = Objects.requireNonNull(transform, "transform"); }

    /** Subclasses add their own inputs here; the editor renders them generically. */
    public List<BrushParameter> extraParameters() { return List.of(); }

    @Override
    public String toString() { return name; }
}
