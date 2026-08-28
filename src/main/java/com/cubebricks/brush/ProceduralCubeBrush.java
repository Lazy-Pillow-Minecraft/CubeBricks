package com.cubebricks.brush;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;

/** A cube-like brush whose internal cube assembly is driven by named parameters. */
public final class ProceduralCubeBrush extends Brush {
    private final Map<String, Double> parameters = new LinkedHashMap<>();
    private Vec3 localCenter = Vec3.ZERO;

    public ProceduralCubeBrush(String name) {
        super(name);
        parameters.put("width", 2.0);
        parameters.put("height", 2.0);
        parameters.put("depth", 2.0);
    }

    public Map<String, Double> parameters() { return Map.copyOf(parameters); }
    public void setParameter(String key, double value) { parameters.put(key, value); }
    public Vec3 localCenter() { return localCenter; }

    /** Extends exactly one local cube face while the opposite face remains in place. */
    public void stretchFace(String axis, int direction, double requestedDelta) {
        String key = switch (axis) { case "X" -> "width"; case "Y" -> "height"; case "Z" -> "depth"; default -> throw new IllegalArgumentException(axis); };
        double oldSize = parameters.get(key);
        double newSize = Math.max(0.05, oldSize + requestedDelta);
        double appliedDelta = newSize - oldSize;
        parameters.put(key, newSize);
        localCenter = switch (axis) {
            case "X" -> new Vec3(localCenter.x() + direction * appliedDelta / 2, localCenter.y(), localCenter.z());
            case "Y" -> new Vec3(localCenter.x(), localCenter.y() + direction * appliedDelta / 2, localCenter.z());
            case "Z" -> new Vec3(localCenter.x(), localCenter.y(), localCenter.z() + direction * appliedDelta / 2);
            default -> localCenter;
        };
    }

    @Override
    public List<BrushParameter> extraParameters() {
        return List.of(
            new BrushParameter("parameter.width", () -> parameters.get("width"), value -> setParameter("width", value)),
            new BrushParameter("parameter.height", () -> parameters.get("height"), value -> setParameter("height", value)),
            new BrushParameter("parameter.depth", () -> parameters.get("depth"), value -> setParameter("depth", value))
        );
    }
}
