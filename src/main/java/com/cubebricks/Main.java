
package com.cubebricks;

import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.layout.BorderPane;
import javafx.stage.Stage;

public class Main extends Application {

    @Override
    public void start(Stage stage) {

        BorderPane root = new BorderPane();

        Viewport viewport = new Viewport();

        root.setCenter(viewport);

        Scene scene = new Scene(root, 1200, 800);

        stage.setTitle("CubeBricks");
        stage.setScene(scene);
        stage.show();

        viewport.start();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
