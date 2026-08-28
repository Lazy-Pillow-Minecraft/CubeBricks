
package com.cubebricks;

import javafx.scene.layout.Pane;

public class Viewport extends Pane {

    private GLRenderer renderer;

    public Viewport() {
        renderer = new GLRenderer();
    }

    public void start() {
        renderer.init();

        this.widthProperty().addListener(e -> resize());
        this.heightProperty().addListener(e -> resize());
    }

    private void resize() {
        renderer.resize(
            (int)getWidth(),
            (int)getHeight()
        );
    }
}
