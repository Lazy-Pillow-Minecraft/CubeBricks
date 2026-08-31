package studio.cubebricks;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javafx.application.Application;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.scene.AmbientLight;
import javafx.scene.DepthTest;
import javafx.scene.Group;
import javafx.scene.Node;
import javafx.scene.PerspectiveCamera;
import javafx.scene.PointLight;
import javafx.scene.Scene;
import javafx.scene.SceneAntialiasing;
import javafx.scene.SubScene;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.Menu;
import javafx.scene.control.MenuBar;
import javafx.scene.control.MenuItem;
import javafx.scene.control.Separator;
import javafx.scene.control.SeparatorMenuItem;
import javafx.scene.control.TextField;
import javafx.scene.control.ToggleButton;
import javafx.scene.control.ToggleGroup;
import javafx.scene.control.ToolBar;
import javafx.scene.control.TreeItem;
import javafx.scene.control.TreeView;
import javafx.scene.input.KeyCode;
import javafx.scene.input.MouseButton;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.Priority;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import javafx.scene.paint.Color;
import javafx.scene.paint.PhongMaterial;
import javafx.scene.shape.Box;
import javafx.scene.shape.DrawMode;
import javafx.scene.transform.Rotate;
import javafx.stage.Stage;
import javafx.stage.FileChooser;

/** A deliberately independent, compact low-poly modelling workspace. */
public final class App extends Application {
    private static final PhongMaterial CUBE_MATERIAL = new PhongMaterial(Color.web("#719def"));
    private static final PhongMaterial GRID_MATERIAL = new PhongMaterial(Color.web("#364158"));
    private static final PhongMaterial MAJOR_GRID_MATERIAL = new PhongMaterial(Color.web("#667692"));
    private static final PhongMaterial OUTLINE_MATERIAL = new PhongMaterial(Color.web("#e9f2ff"));

    private final ObservableList<Cube> cubes = FXCollections.observableArrayList();
    private final Map<Cube, CubeNodes> nodes = new LinkedHashMap<>();
    private final Group world = new Group();
    private TreeView<Cube> outliner;
    private GridPane inspector;
    private Cube selected;
    private boolean syncingTree;
    private Stage stage;
    private Path projectFile;

    @Override
    public void start(Stage stage) {
        this.stage = stage;
        BorderPane root = new BorderPane();
        root.getStyleClass().add("app");
        root.setTop(toolbar());
        root.setLeft(outlinerPanel());
        root.setRight(inspectorPanel());
        root.setCenter(viewport());
        root.setBottom(new Label("Wheel zoom · Right drag orbit · Click a cube to select · Ctrl+D duplicate · Delete remove"));

        Scene scene = new Scene(root, 1280, 820);
        scene.getStylesheets().add(App.class.getResource("/studio/cubebricks/editor.css").toExternalForm());
        scene.setOnKeyPressed(event -> {
            if (event.getCode() == KeyCode.DELETE || event.getCode() == KeyCode.BACK_SPACE) removeSelected();
            else if (event.isControlDown() && event.getCode() == KeyCode.D) duplicateSelected();
        });
        updateTitle();
        stage.setScene(scene);
        stage.show();
        addCube();
    }

    private Node toolbar() {
        Button add = new Button("Add Cube"); add.setOnAction(event -> addCube());
        Button duplicate = new Button("Duplicate"); duplicate.setOnAction(event -> duplicateSelected());
        Button remove = new Button("Delete"); remove.setOnAction(event -> removeSelected());
        ToggleGroup tools = new ToggleGroup();
        Menu file = new Menu("File");
        MenuItem create = new MenuItem("New Project"); create.setOnAction(event -> newProject());
        MenuItem open = new MenuItem("Open…"); open.setOnAction(event -> openProject());
        MenuItem save = new MenuItem("Save"); save.setOnAction(event -> saveProject(false));
        MenuItem saveAs = new MenuItem("Save As…"); saveAs.setOnAction(event -> saveProject(true));
        file.getItems().addAll(create, open, new SeparatorMenuItem(), save, saveAs);
        return new VBox(new MenuBar(file, new Menu("Edit"), new Menu("View")), new ToolBar(add, duplicate, remove, new Separator(), tool("Move", tools, true), tool("Resize", tools, false), tool("Rotate", tools, false)));
    }

    private ToggleButton tool(String label, ToggleGroup group, boolean selectedTool) {
        ToggleButton button = new ToggleButton(label); button.setToggleGroup(group); button.setSelected(selectedTool); return button;
    }

    private Node outlinerPanel() {
        outliner = new TreeView<>(); outliner.setShowRoot(true);
        outliner.getSelectionModel().selectedItemProperty().addListener((observable, oldItem, newItem) -> { if (!syncingTree) select(newItem == null || newItem.getParent() == null ? null : newItem.getValue()); });
        VBox panel = new VBox(new Label("Outliner"), outliner); panel.getStyleClass().add("panel"); panel.setPrefWidth(220); VBox.setVgrow(outliner, Priority.ALWAYS); return panel;
    }

    private Node inspectorPanel() {
        inspector = new GridPane(); inspector.setHgap(8); inspector.setVgap(8);
        VBox panel = new VBox(new Label("Inspector"), inspector); panel.getStyleClass().add("panel"); panel.setPrefWidth(255); return panel;
    }

    private void addCube() {
        Cube cube = new Cube("Cube " + (cubes.size() + 1)); cube.x = cubes.size() * 2.5; cubes.add(cube);
        addVisual(cube); rebuildOutliner(); select(cube);
    }

    private void addVisual(Cube cube) {
        CubeNodes visual = new CubeNodes();
        visual.solid.setOnMouseClicked(event -> { if (event.getButton() == MouseButton.PRIMARY) { select(cube); event.consume(); } });
        nodes.put(cube, visual); world.getChildren().addAll(visual.solid, visual.outline); updateNode(cube);
    }

    private void duplicateSelected() {
        if (selected == null) return;
        Cube copy = selected.copy("Cube " + (cubes.size() + 1)); copy.x += 1; copy.y += 1; cubes.add(copy); addVisual(copy); rebuildOutliner(); select(copy);
    }

    private void removeSelected() {
        if (selected == null) return;
        CubeNodes removed = nodes.remove(selected); world.getChildren().removeAll(removed.solid, removed.outline); cubes.remove(selected); selected = null; rebuildOutliner(); inspector.getChildren().clear(); if (!cubes.isEmpty()) select(cubes.getLast());
    }

    private void newProject() {
        for (CubeNodes visual : nodes.values()) world.getChildren().removeAll(visual.solid, visual.outline);
        cubes.clear(); nodes.clear(); selected = null; projectFile = null;
        rebuildOutliner(); inspector.getChildren().clear(); updateTitle(); addCube();
    }

    private void saveProject(boolean chooseFile) {
        if (projectFile == null || chooseFile) {
            FileChooser chooser = projectChooser();
            chooser.setInitialFileName(projectFile == null ? "untitled.cbricks.json" : projectFile.getFileName().toString());
            java.io.File selectedFile = chooser.showSaveDialog(stage);
            if (selectedFile == null) return;
            projectFile = selectedFile.toPath();
        }
        try {
            Files.writeString(projectFile, projectJson(), StandardCharsets.UTF_8);
            updateTitle();
        } catch (IOException exception) {
            showError("Could not save project", exception.getMessage());
        }
    }

    private void openProject() {
        java.io.File selectedFile = projectChooser().showOpenDialog(stage);
        if (selectedFile == null) return;
        try {
            loadProject(Files.readString(selectedFile.toPath(), StandardCharsets.UTF_8));
            projectFile = selectedFile.toPath(); updateTitle();
        } catch (IOException | IllegalArgumentException exception) {
            showError("Could not open project", exception.getMessage());
        }
    }

    private FileChooser projectChooser() {
        FileChooser chooser = new FileChooser(); chooser.setTitle("CubeBricks Project");
        chooser.getExtensionFilters().add(new FileChooser.ExtensionFilter("CubeBricks project", "*.cbricks.json"));
        return chooser;
    }

    private String projectJson() {
        StringBuilder json = new StringBuilder("{\n  \"format\": \"cubebricks\",\n  \"version\": 1,\n  \"cubes\": [");
        for (int index = 0; index < cubes.size(); index++) {
            Cube cube = cubes.get(index);
            if (index > 0) json.append(',');
            json.append("\n    {\"name\":\"").append(escape(cube.name)).append("\",\"x\":").append(cube.x).append(",\"y\":").append(cube.y).append(",\"z\":").append(cube.z).append(",\"width\":").append(cube.w).append(",\"height\":").append(cube.h).append(",\"depth\":").append(cube.d).append(",\"rotationX\":").append(cube.rx).append(",\"rotationY\":").append(cube.ry).append(",\"rotationZ\":").append(cube.rz).append('}');
        }
        return json.append("\n  ]\n}\n").toString();
    }

    private void loadProject(String json) {
        Pattern cubePattern = Pattern.compile("\\{\\\"name\\\":\\\"((?:\\\\.|[^\\\"])*)\\\",\\\"x\\\":([-+.0-9Ee]+),\\\"y\\\":([-+.0-9Ee]+),\\\"z\\\":([-+.0-9Ee]+),\\\"width\\\":([-+.0-9Ee]+),\\\"height\\\":([-+.0-9Ee]+),\\\"depth\\\":([-+.0-9Ee]+),\\\"rotationX\\\":([-+.0-9Ee]+),\\\"rotationY\\\":([-+.0-9Ee]+),\\\"rotationZ\\\":([-+.0-9Ee]+)\\}");
        Matcher matcher = cubePattern.matcher(json); Map<Cube, CubeNodes> loaded = new LinkedHashMap<>();
        while (matcher.find()) {
            Cube cube = new Cube(unescape(matcher.group(1))); cube.x=Double.parseDouble(matcher.group(2)); cube.y=Double.parseDouble(matcher.group(3)); cube.z=Double.parseDouble(matcher.group(4)); cube.w=positive(matcher.group(5), 2); cube.h=positive(matcher.group(6), 2); cube.d=positive(matcher.group(7), 2); cube.rx=Double.parseDouble(matcher.group(8)); cube.ry=Double.parseDouble(matcher.group(9)); cube.rz=Double.parseDouble(matcher.group(10));
            loaded.put(cube, new CubeNodes());
        }
        if (!json.contains("\"format\": \"cubebricks\"")) throw new IllegalArgumentException("Not a CubeBricks project file.");
        for (CubeNodes visual : nodes.values()) world.getChildren().removeAll(visual.solid, visual.outline);
        cubes.clear(); nodes.clear();
        for (Cube cube : loaded.keySet()) { cubes.add(cube); addVisual(cube); }
        rebuildOutliner(); inspector.getChildren().clear(); selected = null; if (!cubes.isEmpty()) select(cubes.getFirst());
    }

    private void updateTitle() { if (stage != null) stage.setTitle("CubeBricks Studio — " + (projectFile == null ? "Untitled" : projectFile.getFileName())); }
    private String escape(String value) { return value.replace("\\", "\\\\").replace("\"", "\\\""); }
    private String unescape(String value) { return value.replace("\\\"", "\"").replace("\\\\", "\\"); }
    private void showError(String title, String details) { new javafx.scene.control.Alert(javafx.scene.control.Alert.AlertType.ERROR, details, javafx.scene.control.ButtonType.OK) {{ setTitle(title); setHeaderText(title); }}.show(); }

    private void rebuildOutliner() {
        TreeItem<Cube> root = new TreeItem<>(new Cube("Scene")); root.setExpanded(true);
        for (Cube cube : cubes) root.getChildren().add(new TreeItem<>(cube));
        syncingTree = true; outliner.setRoot(root); syncingTree = false;
    }

    private void select(Cube cube) {
        selected = cube; nodes.forEach((model, visual) -> visual.outline.setVisible(model == cube)); refreshInspector(); if (cube != null) selectInOutliner(cube);
    }

    private void selectInOutliner(Cube cube) {
        TreeItem<Cube> root = outliner.getRoot(); if (root == null) return; syncingTree = true;
        for (TreeItem<Cube> item : root.getChildren()) if (item.getValue() == cube) outliner.getSelectionModel().select(item);
        syncingTree = false;
    }

    private void refreshInspector() {
        inspector.getChildren().clear(); if (selected == null) return;
        addField("Name", selected.name, value -> { selected.name = value; rebuildOutliner(); selectInOutliner(selected); });
        addField("X", selected.x, value -> selected.x = number(value, selected.x)); addField("Y", selected.y, value -> selected.y = number(value, selected.y)); addField("Z", selected.z, value -> selected.z = number(value, selected.z));
        addField("Width", selected.w, value -> selected.w = positive(value, selected.w)); addField("Height", selected.h, value -> selected.h = positive(value, selected.h)); addField("Depth", selected.d, value -> selected.d = positive(value, selected.d));
        addField("Rotation X", selected.rx, value -> selected.rx = number(value, selected.rx)); addField("Rotation Y", selected.ry, value -> selected.ry = number(value, selected.ry)); addField("Rotation Z", selected.rz, value -> selected.rz = number(value, selected.rz));
    }

    private void addField(String label, Object current, ValueSetter setter) {
        int row = inspector.getRowCount(); TextField field = new TextField(String.valueOf(current));
        field.setOnAction(event -> applyField(field, setter)); field.focusedProperty().addListener((observable, wasFocused, focused) -> { if (!focused) applyField(field, setter); });
        inspector.add(new Label(label), 0, row); inspector.add(field, 1, row);
    }

    private void applyField(TextField field, ValueSetter setter) { if (selected == null) return; setter.set(field.getText()); updateNode(selected); field.setText(field.getText().trim()); }
    private double number(String value, double fallback) { try { return Double.parseDouble(value.trim()); } catch (NumberFormatException ignored) { return fallback; } }
    private double positive(String value, double fallback) { return Math.max(0.05, number(value, fallback)); }

    private void updateNode(Cube cube) {
        CubeNodes visual = nodes.get(cube); visual.solid.setWidth(cube.w); visual.solid.setHeight(cube.h); visual.solid.setDepth(cube.d);
        visual.outline.setWidth(cube.w + 0.025); visual.outline.setHeight(cube.h + 0.025); visual.outline.setDepth(cube.d + 0.025);
        for (Box box : new Box[] {visual.solid, visual.outline}) { box.setTranslateX(cube.x); box.setTranslateY(cube.y); box.setTranslateZ(cube.z); box.getTransforms().setAll(new Rotate(cube.rx, Rotate.X_AXIS), new Rotate(cube.ry, Rotate.Y_AXIS), new Rotate(cube.rz, Rotate.Z_AXIS)); }
    }

    private Node viewport() {
        world.getChildren().add(grid()); world.getChildren().addAll(new AmbientLight(Color.web("#9caed2")), pointLight());
        PerspectiveCamera camera = new PerspectiveCamera(true); camera.setTranslateZ(-24);
        SubScene scene = new SubScene(world, 600, 600, true, SceneAntialiasing.BALANCED); scene.setCamera(camera);
        StackPane host = new StackPane(scene); host.getStyleClass().add("viewport"); host.widthProperty().addListener((observable, oldWidth, width) -> scene.setWidth(width.doubleValue())); host.heightProperty().addListener((observable, oldHeight, height) -> scene.setHeight(height.doubleValue()));
        Rotate yaw = new Rotate(-36, Rotate.Y_AXIS), pitch = new Rotate(-28, Rotate.X_AXIS); world.getTransforms().addAll(yaw, pitch); double[] start = new double[4];
        scene.setOnMousePressed(event -> { start[0] = event.getSceneX(); start[1] = event.getSceneY(); start[2] = yaw.getAngle(); start[3] = pitch.getAngle(); });
        scene.setOnMouseDragged(event -> { if (event.isSecondaryButtonDown()) { yaw.setAngle(start[2] + (event.getSceneX() - start[0]) * .35); pitch.setAngle(Math.clamp(start[3] - (event.getSceneY() - start[1]) * .35, -82, 82)); } });
        scene.setOnScroll(event -> camera.setTranslateZ(Math.clamp(camera.getTranslateZ() + (event.getDeltaY() > 0 ? 1.4 : -1.4), -70, -5)));
        return host;
    }

    private Node grid() {
        Group grid = new Group();
        for (int value = -16; value <= 16; value++) { boolean major = value % 4 == 0; PhongMaterial material = major ? MAJOR_GRID_MATERIAL : GRID_MATERIAL; double thickness = major ? .035 : .015; grid.getChildren().add(line(32, thickness, thickness, 0, -1.02, value, material)); grid.getChildren().add(line(thickness, thickness, 32, value, -1.02, 0, material)); }
        grid.setDepthTest(DepthTest.ENABLE); return grid;
    }

    private Box line(double width, double height, double depth, double x, double y, double z, PhongMaterial material) { Box line = new Box(width, height, depth); line.setTranslateX(x); line.setTranslateY(y); line.setTranslateZ(z); line.setMaterial(material); return line; }
    private PointLight pointLight() { PointLight light = new PointLight(Color.WHITE); light.setTranslateX(-8); light.setTranslateY(-12); light.setTranslateZ(-10); return light; }
    private interface ValueSetter { void set(String value); }

    private static final class CubeNodes {
        final Box solid = new Box(); final Box outline = new Box();
        CubeNodes() { solid.setMaterial(CUBE_MATERIAL); outline.setMaterial(OUTLINE_MATERIAL); outline.setDrawMode(DrawMode.LINE); outline.setMouseTransparent(true); outline.setVisible(false); }
    }

    private static final class Cube {
        String name; double x, y, z, w = 2, h = 2, d = 2, rx, ry, rz;
        Cube(String name) { this.name = name; }
        Cube copy(String copyName) { Cube copy = new Cube(copyName); copy.x=x; copy.y=y; copy.z=z; copy.w=w; copy.h=h; copy.d=d; copy.rx=rx; copy.ry=ry; copy.rz=rz; return copy; }
        @Override public String toString() { return name; }
    }

    public static void main(String[] args) { launch(args); }
}
