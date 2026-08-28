package com.cubebricks;

/** Editable transform increments; persisted settings can later replace this in-memory default. */
public record SnapSettings(double normal, double shift, double control, double shiftControl) {
    public static final SnapSettings DEFAULT = new SnapSettings(1.0, 0.25, 0.125, 1.0 / 64.0);
    public double step(boolean shiftDown, boolean controlDown) {
        return shiftDown && controlDown ? shiftControl : shiftDown ? shift : controlDown ? control : normal;
    }
}
