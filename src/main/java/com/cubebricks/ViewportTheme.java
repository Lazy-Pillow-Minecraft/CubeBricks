package com.cubebricks;

import javafx.scene.paint.Color;

/** Theme tokens used by the viewport; a future theme pack can supply another instance. */
public record ViewportTheme(Color axisX, Color axisY, Color axisZ, Color gizmoHover, Color gizmoActive) {
    public static final ViewportTheme DEFAULT = new ViewportTheme(
        Color.web("#e85d65"), Color.web("#6ecb7b"), Color.web("#5c95ed"), Color.web("#f2cf68"), Color.web("#f0a75d")
    );
}
