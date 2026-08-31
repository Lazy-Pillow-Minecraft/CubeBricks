package studio.cubebricks.render;

import javafx.scene.DepthTest;
import javafx.scene.Group;
import javafx.scene.Node;
import javafx.scene.paint.Color;
import javafx.scene.paint.PhongMaterial;
import javafx.scene.shape.Box;

/** Generates the editor floor separately from model content. */
public final class GridFactory {
    private GridFactory() { }

    public static Node createFloor(int radius) {
        Group grid = new Group();
        PhongMaterial minor = new PhongMaterial(Color.web("#364158"));
        PhongMaterial major = new PhongMaterial(Color.web("#667692"));
        for (int value = -radius; value <= radius; value++) {
            boolean majorLine = value % 4 == 0;
            PhongMaterial material = majorLine ? major : minor;
            double thickness = majorLine ? .035 : .015;
            grid.getChildren().add(line(radius * 2, thickness, thickness, 0, -1.02, value, material));
            grid.getChildren().add(line(thickness, thickness, radius * 2, value, -1.02, 0, material));
        }
        grid.setDepthTest(DepthTest.ENABLE);
        return grid;
    }

    private static Box line(double width, double height, double depth, double x, double y, double z, PhongMaterial material) {
        Box line = new Box(width, height, depth);
        line.setTranslateX(x); line.setTranslateY(y); line.setTranslateZ(z); line.setMaterial(material);
        return line;
    }
}
