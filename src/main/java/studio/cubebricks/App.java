package studio.cubebricks;

import javafx.application.Application;
import javafx.scene.*;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.paint.PhongMaterial;
import javafx.scene.shape.Box;
import javafx.scene.transform.Rotate;
import javafx.stage.Stage;

public final class App extends Application {
  @Override public void start(Stage stage) {
    BorderPane root = new BorderPane(); root.getStyleClass().add("app");
    MenuBar menu = new MenuBar(new Menu("File"), new Menu("Edit"), new Menu("View"), new Menu("Help"));
    ToolBar tools = new ToolBar(new Button("Add Cube"), new Separator(), new ToggleButton("Move"), new ToggleButton("Resize"), new ToggleButton("Rotate"));
    VBox top = new VBox(menu, tools); root.setTop(top);
    TreeItem<String> sceneRoot = new TreeItem<>("Scene"); sceneRoot.setExpanded(true); sceneRoot.getChildren().add(new TreeItem<>("Cube"));
    TreeView<String> outliner = new TreeView<>(sceneRoot); outliner.setShowRoot(true);
    VBox left = new VBox(new Label("Outliner"), outliner); left.getStyleClass().add("panel"); left.setPrefWidth(220); VBox.setVgrow(outliner, Priority.ALWAYS); root.setLeft(left);
    GridPane properties = new GridPane(); properties.setHgap(8); properties.setVgap(8); properties.add(new Label("Transform"),0,0); String[] labels={"X","Y","Z","Width","Height","Depth"}; for(int i=0;i<labels.length;i++){properties.add(new Label(labels[i]),0,i+1);properties.add(new TextField(i<3?"0":"2"),1,i+1);} VBox right=new VBox(new Label("Inspector"),properties);right.getStyleClass().add("panel");right.setPrefWidth(250);root.setRight(right);
    root.setCenter(viewport()); root.setBottom(new Label("Ready · Wheel zoom · Right drag orbit · Middle drag pan"));
    Scene scene = new Scene(root, 1280, 820); scene.getStylesheets().add(App.class.getResource("/editor.css").toExternalForm()); stage.setTitle("CubeBricks Studio"); stage.setScene(scene); stage.show();
  }
  private Node viewport(){ Group sceneRoot=new Group(); Box cube=new Box(2,2,2);cube.setMaterial(new PhongMaterial(Color.web("#6fa7ff")));sceneRoot.getChildren().add(cube); PerspectiveCamera camera=new PerspectiveCamera(true);camera.setTranslateZ(-12); SubScene view=new SubScene(sceneRoot,600,600,true,SceneAntialiasing.BALANCED);view.setCamera(camera); view.widthProperty(); StackPane host=new StackPane(view);host.getStyleClass().add("viewport");host.widthProperty().addListener((o,a,b)->view.setWidth(b.doubleValue()));host.heightProperty().addListener((o,a,b)->view.setHeight(b.doubleValue())); Rotate yaw=new Rotate(-28,Rotate.Y_AXIS),pitch=new Rotate(-18,Rotate.X_AXIS);sceneRoot.getTransforms().addAll(yaw,pitch); final double[] start=new double[4];view.setOnMousePressed(e->{start[0]=e.getSceneX();start[1]=e.getSceneY();start[2]=yaw.getAngle();start[3]=pitch.getAngle();});view.setOnMouseDragged(e->{if(e.isSecondaryButtonDown()){yaw.setAngle(start[2]+(e.getSceneX()-start[0])*.35);pitch.setAngle(Math.clamp(start[3]-(e.getSceneY()-start[1])*.35,-80,80));}});view.setOnScroll(e->camera.setTranslateZ(Math.clamp(camera.getTranslateZ()+(e.getDeltaY()>0?1:-1),-40,-4)));return host; }
  public static void main(String[] args){launch(args);}
}
