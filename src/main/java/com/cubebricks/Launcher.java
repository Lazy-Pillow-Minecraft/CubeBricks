package com.cubebricks;

import javafx.application.Application;

/**
 * Plain Java entry point for IDEs. Running an Application subclass directly can
 * make newer JDK launchers look for JavaFX modules before the IDE classpath is used.
 */
public final class Launcher {
    private Launcher() { }

    public static void main(String[] args) {
        Application.launch(Main.class, args);
    }
}
