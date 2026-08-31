package studio.cubebricks.render;

import javafx.scene.paint.Color;
import javafx.scene.paint.PhongMaterial;
import javafx.scene.shape.Box;
import javafx.scene.shape.DrawMode;

/** JavaFX representation of one model cube. */
public final class CubeNodes {
    public final Box solid = new Box();
    public final Box outline = new Box();

    public CubeNodes() {
        solid.setMaterial(new PhongMaterial(Color.web("#719def")));
        outline.setMaterial(new PhongMaterial(Color.web("#e9f2ff")));
        outline.setDrawMode(DrawMode.LINE);
        outline.setMouseTransparent(true);
        outline.setVisible(false);
    }
}
