package com.cubebricks.brush;

import java.util.Objects;
import java.util.function.DoubleConsumer;
import java.util.function.DoubleSupplier;

/** A brush-owned numeric input which the shared inspector can render without knowing the brush type. */
public record BrushParameter(String labelKey, DoubleSupplier reader, DoubleConsumer writer) {
    public BrushParameter {
        Objects.requireNonNull(labelKey, "labelKey");
        Objects.requireNonNull(reader, "reader");
        Objects.requireNonNull(writer, "writer");
    }
}
