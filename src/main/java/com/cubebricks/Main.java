package com.cubebricks;

import com.cubebricks.brush.Brush;
import com.cubebricks.brush.BrushParameter;
import com.cubebricks.brush.FixedNodeBrush;
import com.cubebricks.brush.FreeformNodeBrush;
import com.cubebricks.brush.ProceduralCubeBrush;
import com.cubebricks.brush.Transform;
import com.cubebricks.brush.Vec3;
import com.cubebricks.i18n.I18n;
import javafx.application.Application;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.geometry.Insets;
import javafx.scene.Scene;
import javafx.scene.control.Button;
import javafx.scene.control.CheckBox;
import javafx.scene.control.ComboBox;
import javafx.scene.control.Label;
import javafx.scene.control.ListView;
import javafx.scene.control.ScrollPane;
import javafx.scene.control.TextField;
import javafx.scene.control.ToggleButton;
import javafx.scene.control.ToggleGroup;
import javafx.scene.control.ToolBar;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;

import java.util.function.DoubleConsumer;
import java.util.function.DoubleSupplier;
import java.util.function.Supplier;

public class Main extends Application {
    private final ObservableList<Brush> brushes = FXCollections.observableArrayList();
    private Stage stage;
    private Viewport viewport;
    private VBox inspectorContent;
    private ListView<Brush> elementList;
    private Brush selectedBrush;

    @Override
    public void start(Stage stage) {
        this.stage = stage;
        buildEditor();
        stage.show();
    }

    private void buildEditor() {
        BorderPane root = new BorderPane();
        root.getStyleClass().add("editor-root");

        viewport = new Viewport();
        viewport.setElements(brushes);
        viewport.setSelectedBrush(selectedBrush);
        viewport.setTransformUpdater(this::setTransform);
        viewport.setGeometryUpdater(this::refreshInspector);
        viewport.setSelectionUpdater(brush -> { elementList.getSelectionModel().select(brush); selectBrush(brush); });
        elementList = new ListView<>(brushes);
        elementList.getStyleClass().add("element-list");
        elementList.setPlaceholder(new Label(I18n.tr("elements.empty")));
        elementList.getSelectionModel().selectedItemProperty().addListener((observable, oldElement, newElement) -> selectBrush(newElement));
        if (selectedBrush != null) elementList.getSelectionModel().select(selectedBrush);

        ToolBar tools = new ToolBar(
            createAddButton(I18n.tr("toolbar.add_cube"), () -> new ProceduralCubeBrush(I18n.tr("brush.default_cube")), elementList),
            createAddButton(I18n.tr("toolbar.add_path"), () -> new FreeformNodeBrush(I18n.tr("brush.default_path")), elementList),
            createAddButton(I18n.tr("toolbar.add_arm"), () -> FixedNodeBrush.createArm(I18n.tr("brush.default_arm")), elementList),
            createTransformTools(), createShadingToggle(), createLanguageSelector()
        );
        tools.getStyleClass().add("editor-toolbar");

        VBox rightPanel = createRightPanel(elementList);
        Label status = new Label(I18n.tr("status.viewport_help"));
        status.getStyleClass().add("status-bar");
        root.setCenter(viewport);
        root.setTop(tools);
        root.setRight(rightPanel);
        root.setBottom(status);

        Scene scene = new Scene(root, 1200, 800);
        scene.getStylesheets().add(Main.class.getResource("/theme.css").toExternalForm());
        stage.setTitle(I18n.tr("app.title"));
        stage.setScene(scene);
        viewport.start();
    }

    private VBox createRightPanel(ListView<Brush> elementList) {
        Label inspectorTitle = new Label(I18n.tr("inspector.title"));
        inspectorTitle.getStyleClass().add("panel-title");
        inspectorContent = new VBox(8);
        inspectorContent.getStyleClass().add("inspector-content");
        ScrollPane inspector = new ScrollPane(inspectorContent);
        inspector.setFitToWidth(true);
        inspector.setPrefViewportHeight(320);
        inspector.getStyleClass().add("inspector-scroll");
        refreshInspector();

        Label elementsTitle = new Label(I18n.tr("elements.title"));
        elementsTitle.getStyleClass().add("panel-title");
        VBox panel = new VBox(10, inspectorTitle, inspector, elementsTitle, elementList);
        panel.getStyleClass().add("inspector-panel");
        panel.setPadding(new Insets(14));
        panel.setPrefWidth(280);
        VBox.setVgrow(elementList, Priority.ALWAYS);
        return panel;
    }

    private ToolBar createTransformTools() {
        ToggleGroup group = new ToggleGroup();
        ToggleButton move = transformTool("toolbar.move", TransformTool.MOVE, group, true);
        ToggleButton scale = transformTool("toolbar.scale", TransformTool.SCALE, group, false);
        ToggleButton rotate = transformTool("toolbar.rotate", TransformTool.ROTATE, group, false);
        ToggleButton pivot = transformTool("toolbar.pivot", TransformTool.PIVOT, group, false);
        return new ToolBar(move, scale, rotate, pivot);
    }

    private ToggleButton transformTool(String labelKey, TransformTool tool, ToggleGroup group, boolean selected) {
        ToggleButton button = new ToggleButton(I18n.tr(labelKey));
        button.setToggleGroup(group);
        button.setSelected(selected);
        button.setOnAction(event -> viewport.setTransformTool(tool));
        return button;
    }

    private void selectBrush(Brush brush) {
        selectedBrush = brush;
        if (viewport != null) viewport.setSelectedBrush(brush);
        refreshInspector();
    }

    private void refreshInspector() {
        if (inspectorContent == null) return;
        inspectorContent.getChildren().clear();
        if (selectedBrush == null) {
            inspectorContent.getChildren().add(new Label(I18n.tr("inspector.empty")));
            return;
        }
        addTextField(I18n.tr("element.name"), selectedBrush.name(), selectedBrush::setName);
        addTransformSection(I18n.tr("transform.position"), selectedBrush.transform().position(), this::setPosition);
        addTransformSection(I18n.tr("transform.rotation"), selectedBrush.transform().rotation(), this::setRotation);
        addTransformSection(I18n.tr("transform.scale"), selectedBrush.transform().scale(), this::setScale);
        addTransformSection(I18n.tr("transform.pivot"), selectedBrush.transform().pivot(), this::setPivot);
        if (!selectedBrush.extraParameters().isEmpty()) {
            inspectorContent.getChildren().add(sectionTitle(I18n.tr("inspector.brush_parameters")));
            for (BrushParameter parameter : selectedBrush.extraParameters()) addNumberField(I18n.tr(parameter.labelKey()), parameter.reader(), parameter.writer());
        }
    }

    private void addTransformSection(String title, Vec3 value, java.util.function.Consumer<Vec3> writer) {
        inspectorContent.getChildren().add(sectionTitle(title));
        GridPane grid = new GridPane();
        grid.setHgap(6); grid.setVgap(5);
        addAxisField(grid, 0, "axis.x", value.x(), number -> writer.accept(new Vec3(number, value.y(), value.z())));
        addAxisField(grid, 1, "axis.y", value.y(), number -> writer.accept(new Vec3(value.x(), number, value.z())));
        addAxisField(grid, 2, "axis.z", value.z(), number -> writer.accept(new Vec3(value.x(), value.y(), number)));
        inspectorContent.getChildren().add(grid);
    }

    private void addAxisField(GridPane grid, int row, String labelKey, double value, DoubleConsumer writer) {
        Label label = new Label(I18n.tr(labelKey));
        TextField field = numericField(value, writer);
        grid.add(label, 0, row); grid.add(field, 1, row);
    }

    private void addNumberField(String title, DoubleSupplier reader, DoubleConsumer writer) {
        GridPane grid = new GridPane();
        grid.setHgap(6);
        grid.add(new Label(title), 0, 0);
        grid.add(numericField(reader.getAsDouble(), writer), 1, 0);
        inspectorContent.getChildren().add(grid);
    }

    private void addTextField(String title, String value, java.util.function.Consumer<String> writer) {
        GridPane grid = new GridPane();
        grid.setHgap(6);
        TextField field = new TextField(value);
        Runnable commit = () -> { writer.accept(field.getText()); if (elementList != null) elementList.refresh(); };
        field.setOnAction(event -> commit.run());
        field.focusedProperty().addListener((observable, wasFocused, focused) -> { if (!focused) commit.run(); });
        grid.add(new Label(title), 0, 0); grid.add(field, 1, 0);
        inspectorContent.getChildren().add(grid);
    }

    private TextField numericField(double value, DoubleConsumer writer) {
        TextField field = new TextField(Double.toString(value));
        field.getStyleClass().add("number-field");
        Runnable commit = () -> {
            try { writer.accept(Double.parseDouble(field.getText())); }
            catch (NumberFormatException ignored) { field.setText(Double.toString(value)); }
        };
        field.setOnAction(event -> commit.run());
        field.focusedProperty().addListener((observable, wasFocused, focused) -> { if (!focused) commit.run(); });
        return field;
    }

    private Label sectionTitle(String title) { Label label = new Label(title); label.getStyleClass().add("section-title"); return label; }
    private void setPosition(Vec3 value) { setTransform(new Transform(value, selectedBrush.transform().rotation(), selectedBrush.transform().scale(), selectedBrush.transform().pivot())); }
    private void setRotation(Vec3 value) { setTransform(new Transform(selectedBrush.transform().position(), value, selectedBrush.transform().scale(), selectedBrush.transform().pivot())); }
    private void setScale(Vec3 value) { setTransform(new Transform(selectedBrush.transform().position(), selectedBrush.transform().rotation(), value, selectedBrush.transform().pivot())); }
    private void setPivot(Vec3 value) { setTransform(preserveGeometryWhileChangingPivot(selectedBrush.transform(), value)); }
    private void setTransform(Transform value) {
        selectedBrush.setTransform(value);
        if (viewport != null) viewport.drawNow();
        if (elementList != null) elementList.refresh();
        refreshInspector();
    }

    /** Changing an origin must not move the already placed element in world space. */
    private Transform preserveGeometryWhileChangingPivot(Transform current, Vec3 newPivot) {
        Vec3 oldTerm = pivotOffset(current.pivot(), current);
        Vec3 newTerm = pivotOffset(newPivot, current);
        Vec3 position = current.position();
        return new Transform(new Vec3(position.x() + oldTerm.x() - newTerm.x(), position.y() + oldTerm.y() - newTerm.y(), position.z() + oldTerm.z() - newTerm.z()), current.rotation(), current.scale(), newPivot);
    }

    private Vec3 pivotOffset(Vec3 pivot, Transform transform) {
        double x = pivot.x() * transform.scale().x(), y = pivot.y() * transform.scale().y(), z = pivot.z() * transform.scale().z();
        double rx = Math.toRadians(transform.rotation().x()), ry = Math.toRadians(transform.rotation().y()), rz = Math.toRadians(transform.rotation().z());
        double y1 = y * Math.cos(rx) - z * Math.sin(rx), z1 = y * Math.sin(rx) + z * Math.cos(rx);
        double x2 = x * Math.cos(ry) + z1 * Math.sin(ry), z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
        double x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz), y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
        return new Vec3(pivot.x() - x3, pivot.y() - y3, pivot.z() - z2);
    }

    private ComboBox<String> createLanguageSelector() {
        ComboBox<String> languages = new ComboBox<>(FXCollections.observableArrayList("zh_cn", "en_us"));
        languages.setValue(I18n.locale());
        languages.setOnAction(event -> { String locale = languages.getValue(); if (locale != null && !locale.equals(I18n.locale())) { I18n.setLocale(locale); buildEditor(); } });
        return languages;
    }

    private CheckBox createShadingToggle() {
        CheckBox shading = new CheckBox(I18n.tr("toolbar.shade"));
        shading.setSelected(true);
        shading.setOnAction(event -> viewport.setShadingEnabled(shading.isSelected()));
        return shading;
    }

    private Button createAddButton(String label, Supplier<Brush> factory, ListView<Brush> list) {
        Button button = new Button(label);
        button.setOnAction(event -> { Brush brush = factory.get(); brushes.add(brush); list.getSelectionModel().select(brush); selectBrush(brush); });
        return button;
    }

    public static void main(String[] args) { launch(args); }
}
