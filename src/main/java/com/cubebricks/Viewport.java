package com.cubebricks;

import com.cubebricks.brush.Brush;
import com.cubebricks.brush.Transform;
import com.cubebricks.brush.Vec3;
import com.cubebricks.brush.ProceduralCubeBrush;
import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.layout.Pane;
import javafx.scene.paint.Color;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Consumer;

/** Event-driven software 3D viewport; independent from brush generation and export. */
public class Viewport extends Pane {
    private static final Color GRID_FINE = Color.web("#3b4353");
    private static final Color GRID_COARSE = Color.web("#657188");
    private static final Color CUBE_COLOR = Color.web("#77a9ff");

    private final GLRenderer renderer = new GLRenderer();
    private final Canvas canvas = new Canvas();
    private double yaw = Math.toRadians(42);
    /** Negative pitch positions the camera above the grid, looking downward. */
    private double pitch = Math.toRadians(-27);
    private double distance = 32;
    private double screenOffsetX;
    private double screenOffsetY;
    private double dragStartX;
    private double dragStartY;
    private double yawAtDragStart;
    private double pitchAtDragStart;
    private double offsetAtDragStartX;
    private double offsetAtDragStartY;
    private boolean shadingEnabled = true;
    private List<Brush> elements = List.of();
    private Brush previewBrush;
    private TransformTool transformTool = TransformTool.MOVE;
    private ViewportTheme theme = ViewportTheme.DEFAULT;
    private SnapSettings snapSettings = SnapSettings.DEFAULT;
    private Consumer<Transform> transformUpdater;
    private Runnable geometryUpdater;
    private Consumer<Brush> selectionUpdater;
    private Axis hoveredAxis;
    private Axis draggingAxis;
    private int hoveredDirection = 1;
    private int draggingDirection = 1;
    private double gizmoStartX;
    private double gizmoStartY;
    private Transform transformAtGizmoStart;

    public Viewport() {
        getStyleClass().add("viewport");
        getChildren().add(canvas);
        widthProperty().addListener((observable, oldWidth, newWidth) -> resize());
        heightProperty().addListener((observable, oldHeight, newHeight) -> resize());
        setOnScroll(event -> {
            distance = Math.clamp(distance * (event.getDeltaY() > 0 ? 0.88 : 1.12), 8, 160);
            draw();
        });
        setOnMousePressed(this::beginDrag);
        setOnMouseDragged(this::drag);
        setOnMouseMoved(event -> updateHoveredAxis(event.getX(), event.getY()));
        setOnMouseReleased(event -> { draggingAxis = null; updateHoveredAxis(event.getX(), event.getY()); });
        setOnContextMenuRequested(javafx.event.Event::consume);
    }

    public void start() {
        renderer.init();
        resize();
    }

    public void setElements(List<Brush> elements) { this.elements = elements; draw(); }
    public void setSelectedBrush(Brush brush) { previewBrush = brush; draw(); }
    public void setShadingEnabled(boolean enabled) { shadingEnabled = enabled; draw(); }
    public void drawNow() { draw(); }
    public void setTransformTool(TransformTool tool) { transformTool = tool; draw(); }
    public void setTransformUpdater(Consumer<Transform> updater) { transformUpdater = updater; }
    public void setTheme(ViewportTheme theme) { this.theme = theme; draw(); }
    public void setSnapSettings(SnapSettings settings) { snapSettings = settings; }
    public void setSelectionUpdater(Consumer<Brush> updater) { selectionUpdater = updater; }
    public void setGeometryUpdater(Runnable updater) { geometryUpdater = updater; }

    private void beginDrag(javafx.scene.input.MouseEvent event) {
        if (event.isPrimaryButtonDown() && hoveredAxis != null && previewBrush != null) {
            draggingAxis = hoveredAxis;
            draggingDirection = hoveredDirection;
            gizmoStartX = event.getX(); gizmoStartY = event.getY();
            transformAtGizmoStart = previewBrush.transform();
            draw();
            return;
        }
        if (event.isPrimaryButtonDown()) {
            Brush hit = pickBrush(event.getX(), event.getY());
            if (hit != null && selectionUpdater != null) selectionUpdater.accept(hit);
            return;
        }
        dragStartX = event.getX();
        dragStartY = event.getY();
        yawAtDragStart = yaw;
        pitchAtDragStart = pitch;
        offsetAtDragStartX = screenOffsetX;
        offsetAtDragStartY = screenOffsetY;
    }

    private void drag(javafx.scene.input.MouseEvent event) {
        if (draggingAxis != null) {
            dragGizmo(event);
            return;
        }
        if (event.isSecondaryButtonDown()) {
            // Right-drag orbits around the target with a bounded vertical angle.
            yaw = yawAtDragStart - (event.getX() - dragStartX) * 0.008;
            pitch = Math.clamp(pitchAtDragStart - (event.getY() - dragStartY) * 0.008, Math.toRadians(-82), Math.toRadians(82));
            draw();
        } else if (event.isMiddleButtonDown()) {
            screenOffsetX = offsetAtDragStartX + event.getX() - dragStartX;
            screenOffsetY = offsetAtDragStartY + event.getY() - dragStartY;
            draw();
        }
    }

    private void resize() {
        canvas.setWidth(getWidth());
        canvas.setHeight(getHeight());
        renderer.resize((int) getWidth(), (int) getHeight());
        draw();
    }

    private void draw() {
        if (canvas.getWidth() <= 0 || canvas.getHeight() <= 0) return;
        GraphicsContext graphics = canvas.getGraphicsContext2D();
        graphics.setFill(Color.web("#17191f"));
        graphics.fillRect(0, 0, canvas.getWidth(), canvas.getHeight());
        drawGrid(graphics);
        for (Brush brush : elements) drawBrushCube(graphics, brush, brush == previewBrush);
        drawNorthMarker(graphics);
    }

    /** 16×16 unit grid at the centre, surrounded by eight 16×16 coarse cells. */
    private void drawGrid(GraphicsContext graphics) {
        graphics.setLineWidth(0.8);
        graphics.setStroke(GRID_FINE);
        for (int line = -8; line <= 8; line++) {
            drawLine(graphics, new Point3(line, 0, -8), new Point3(line, 0, 8));
            drawLine(graphics, new Point3(-8, 0, line), new Point3(8, 0, line));
        }
        graphics.setLineWidth(1.4);
        graphics.setStroke(GRID_COARSE);
        for (int line : new int[] {-24, -8, 8, 24}) {
            drawLine(graphics, new Point3(line, 0, -24), new Point3(line, 0, 24));
            drawLine(graphics, new Point3(-24, 0, line), new Point3(24, 0, line));
        }
    }

    private void drawBrushCube(GraphicsContext graphics, Brush brush, boolean selected) {
        List<Face> faces = transformedFaces(brush);
        faces.sort(Comparator.comparingDouble(this::averageDepth).reversed());
        for (Face face : faces) {
            double[] x = new double[4];
            double[] y = new double[4];
            for (int index = 0; index < 4; index++) {
                ScreenPoint point = project(face.vertices()[index]);
                x[index] = point.x(); y[index] = point.y();
            }
            graphics.setFill(shaded(CUBE_COLOR, face.normal()));
            graphics.fillPolygon(x, y, 4);
            if (selected) {
                graphics.setStroke(Color.web("#ffffff", 0.92));
                graphics.setLineWidth(1.0);
                graphics.strokePolygon(x, y, 4);
            }
        }
        if (selected) drawGizmo(graphics);
    }

    /**
     * Vanilla-style face brightness. Opposite X/Z faces use identical weights:
     * X = 0.6, Z = 0.8, top = 1.0, bottom = 0.5. No positional light is involved.
     */
    private Color shaded(Color base, Point3 normal) {
        if (!shadingEnabled) return base;
        Point3 worldNormal = normal.normalized();
        double brightness = 0.25 * worldNormal.y()
            + 0.75 * Math.abs(worldNormal.y())
            + 0.8 * Math.abs(worldNormal.z())
            + 0.6 * Math.abs(worldNormal.x());
        brightness = Math.clamp(brightness, 0, 1);
        return Color.color(base.getRed() * brightness, base.getGreen() * brightness, base.getBlue() * brightness, base.getOpacity());
    }

    /** North is a line-marking on the world grid, plus an outward-pointing triangle. */
    private void drawNorthMarker(GraphicsContext graphics) {
        graphics.setFill(Color.web("#778091", 0.78));
        graphics.setStroke(Color.web("#778091", 0.78));
        graphics.setLineWidth(1.2);
        drawLine(graphics, new Point3(-0.9, 0.02, -9.5), new Point3(-0.9, 0.02, -11.3));
        drawLine(graphics, new Point3(-0.9, 0.02, -9.5), new Point3(0.9, 0.02, -11.3));
        drawLine(graphics, new Point3(0.9, 0.02, -9.5), new Point3(0.9, 0.02, -11.3));
        drawTriangle(graphics, new Point3(-0.6, 0.02, -12.2), new Point3(0.6, 0.02, -12.2), new Point3(0, 0.02, -13.2));
    }

    private void drawTriangle(GraphicsContext graphics, Point3 first, Point3 second, Point3 third) {
        ScreenPoint a = project(first), b = project(second), c = project(third);
        graphics.fillPolygon(new double[] {a.x(), b.x(), c.x()}, new double[] {a.y(), b.y(), c.y()}, 3);
    }

    private void drawLine(GraphicsContext graphics, Point3 from, Point3 to) {
        CameraPoint first = cameraSpace(from), second = cameraSpace(to);
        final double nearPlane = 0.2;
        if (first.depth() <= nearPlane && second.depth() <= nearPlane) return;
        if (first.depth() <= nearPlane || second.depth() <= nearPlane) {
            double progress = (nearPlane - first.depth()) / (second.depth() - first.depth());
            CameraPoint clipped = new CameraPoint(first.x() + (second.x() - first.x()) * progress, first.y() + (second.y() - first.y()) * progress, nearPlane);
            if (first.depth() <= nearPlane) first = clipped; else second = clipped;
        }
        ScreenPoint a = project(first), b = project(second);
        graphics.strokeLine(a.x(), a.y(), b.x(), b.y());
    }

    private ScreenPoint project(Point3 point) {
        return project(cameraSpace(point));
    }

    private CameraPoint cameraSpace(Point3 point) {
        double yawCos = Math.cos(yaw), yawSin = Math.sin(yaw);
        double xAfterYaw = yawCos * point.x() + yawSin * point.z();
        double zAfterYaw = -yawSin * point.x() + yawCos * point.z();
        double pitchCos = Math.cos(pitch), pitchSin = Math.sin(pitch);
        double yAfterPitch = pitchCos * point.y() - pitchSin * zAfterYaw;
        double zAfterPitch = pitchSin * point.y() + pitchCos * zAfterYaw;
        double depth = distance + zAfterPitch;
        return new CameraPoint(xAfterYaw, yAfterPitch, depth);
    }

    private ScreenPoint project(CameraPoint point) {
        double scale = Math.min(canvas.getWidth(), canvas.getHeight()) * 1.05 / Math.max(0.1, point.depth());
        return new ScreenPoint(canvas.getWidth() / 2 + screenOffsetX + point.x() * scale,
            canvas.getHeight() / 2 + screenOffsetY - point.y() * scale, point.depth());
    }

    private double averageDepth(Face face) {
        return java.util.Arrays.stream(face.vertices()).mapToDouble(point -> project(point).depth()).average().orElse(0);
    }

    private Point3 previewMin(Brush brush) {
        if (!(brush instanceof ProceduralCubeBrush cube)) return new Point3(-1, 0, -1);
        double width = cube.parameters().getOrDefault("width", 4.0);
        double depth = cube.parameters().getOrDefault("depth", 4.0);
        Vec3 center = cube.localCenter();
        double height = cube.parameters().getOrDefault("height", 2.0);
        return new Point3(center.x() - width / 2, center.y() - height / 2, center.z() - depth / 2);
    }

    private Point3 previewMax(Brush brush) {
        if (!(brush instanceof ProceduralCubeBrush cube)) return new Point3(1, 2, 1);
        double width = cube.parameters().getOrDefault("width", 4.0);
        double height = cube.parameters().getOrDefault("height", 5.0);
        double depth = cube.parameters().getOrDefault("depth", 4.0);
        Vec3 center = cube.localCenter();
        return new Point3(center.x() + width / 2, center.y() + height / 2, center.z() + depth / 2);
    }

    private void drawGizmo(GraphicsContext graphics) {
        Point3 origin = gizmoOrigin();
        for (Axis axis : Axis.values()) {
            Point3 endpoint = add(origin, axis.vector().multiply(3));
            ScreenPoint a = project(origin), b = project(endpoint);
            graphics.setStroke(axisColor(axis));
            graphics.setLineWidth(axis == draggingAxis ? 3.4 : 2.4);
            graphics.strokeLine(a.x(), a.y(), b.x(), b.y());
            graphics.setFill(axisColor(axis));
            if (transformTool == TransformTool.MOVE || transformTool == TransformTool.PIVOT) drawArrowHead(graphics, a, b);
            else if (transformTool == TransformTool.SCALE) drawScaleHandles(graphics, origin, axis, a, b);
        }
        if (transformTool == TransformTool.ROTATE) drawRotationRings(graphics, project(origin));
    }

    private void drawArrowHead(GraphicsContext graphics, ScreenPoint from, ScreenPoint to) {
        double dx = to.x() - from.x(), dy = to.y() - from.y(), length = Math.max(1, Math.hypot(dx, dy));
        double nx = dx / length, ny = dy / length, sideX = -ny * 5, sideY = nx * 5;
        graphics.fillPolygon(new double[] {to.x(), to.x() - nx * 12 + sideX, to.x() - nx * 12 - sideX}, new double[] {to.y(), to.y() - ny * 12 + sideY, to.y() - ny * 12 - sideY}, 3);
    }

    private void drawScaleHandles(GraphicsContext graphics, Point3 origin, Axis axis, ScreenPoint from, ScreenPoint to) {
        graphics.fillRect(to.x() - 5, to.y() - 5, 10, 10);
        ScreenPoint opposite = project(add(origin, axis.vector().multiply(-3)));
        graphics.setStroke(axisColor(axis));
        graphics.strokeLine(from.x(), from.y(), opposite.x(), opposite.y());
        graphics.fillRect(opposite.x() - 5, opposite.y() - 5, 10, 10);
    }

    private void drawRotationRings(GraphicsContext graphics, ScreenPoint origin) {
        double[] radii = {36, 44, 52};
        for (int index = 0; index < Axis.values().length; index++) {
            graphics.setStroke(axisColor(Axis.values()[index]));
            graphics.setLineWidth(1.4);
            double radius = radii[index];
            graphics.strokeOval(origin.x() - radius, origin.y() - radius, radius * 2, radius * 2);
        }
    }

    private void updateHoveredAxis(double mouseX, double mouseY) {
        Axis previous = hoveredAxis;
        hoveredAxis = null;
        if (previewBrush != null && draggingAxis == null) {
            Point3 origin = gizmoOrigin();
            for (Axis axis : Axis.values()) {
                ScreenPoint a = project(origin);
                for (int direction : transformTool == TransformTool.SCALE ? new int[] {-1, 1} : new int[] {1}) {
                    ScreenPoint b = project(add(origin, axis.vector().multiply(3 * direction)));
                    if (distanceToSegment(mouseX, mouseY, a.x(), a.y(), b.x(), b.y()) <= 8) { hoveredAxis = axis; hoveredDirection = direction; break; }
                }
                if (hoveredAxis != null) break;
            }
        }
        if (previous != hoveredAxis) draw();
    }

    private void dragGizmo(javafx.scene.input.MouseEvent event) {
        double mouseX = event.getX(), mouseY = event.getY();
        Point3 origin = gizmoOrigin(transformAtGizmoStart);
        Axis axis = draggingAxis;
        ScreenPoint start = project(origin), end = project(add(origin, axis.vector().multiply(3)));
        double directionX = end.x() - start.x(), directionY = end.y() - start.y();
        double screenLength = Math.max(1, Math.hypot(directionX, directionY));
        double projectedPixels = ((mouseX - gizmoStartX) * directionX + (mouseY - gizmoStartY) * directionY) / screenLength;
        double worldPixels = Math.max(1, Math.hypot(project(add(origin, axis.vector())).x() - start.x(), project(add(origin, axis.vector())).y() - start.y()));
        double delta = snap(projectedPixels / worldPixels * draggingDirection, event.isShiftDown(), event.isControlDown());
        if (transformTool == TransformTool.SCALE && previewBrush instanceof ProceduralCubeBrush cube) {
            cube.stretchFace(axis.name(), draggingDirection, delta);
            if (geometryUpdater != null) geometryUpdater.run();
            draw();
            return;
        }
        Transform updated = switch (transformTool) {
            case MOVE -> withPosition(transformAtGizmoStart, addAxis(transformAtGizmoStart.position(), axis, delta));
            case SCALE -> withScale(transformAtGizmoStart, addAxis(transformAtGizmoStart.scale(), axis, delta));
            case ROTATE -> withRotation(transformAtGizmoStart, addAxis(transformAtGizmoStart.rotation(), axis, delta * 60));
            case PIVOT -> preserveGeometryPivot(transformAtGizmoStart, addAxis(transformAtGizmoStart.pivot(), axis, delta));
        };
        if (transformTool == TransformTool.SCALE) updated = withScale(updated, clampScale(updated.scale()));
        if (transformUpdater != null) transformUpdater.accept(updated);
        draw();
    }

    private double snap(double value, boolean shift, boolean control) { double step = snapSettings.step(shift, control); return Math.round(value / step) * step; }

    private Brush pickBrush(double mouseX, double mouseY) {
        for (int index = elements.size() - 1; index >= 0; index--) {
            Brush brush = elements.get(index);
            for (Face face : transformedFaces(brush)) {
                double[] x = new double[4], y = new double[4];
                for (int vertex = 0; vertex < 4; vertex++) { ScreenPoint point = project(face.vertices()[vertex]); x[vertex] = point.x(); y[vertex] = point.y(); }
                if (insidePolygon(mouseX, mouseY, x, y)) return brush;
            }
        }
        return null;
    }

    private List<Face> transformedFaces(Brush brush) { List<Face> faces = cubeFaces(previewMin(brush), previewMax(brush)); faces.replaceAll(face -> transformed(face, brush.transform())); return faces; }
    private static boolean insidePolygon(double px, double py, double[] x, double[] y) {
        boolean inside = false;
        for (int i = 0, j = x.length - 1; i < x.length; j = i++) if ((y[i] > py) != (y[j] > py) && px < (x[j] - x[i]) * (py - y[i]) / (y[j] - y[i]) + x[i]) inside = !inside;
        return inside;
    }

    private Point3 gizmoOrigin() { return gizmoOrigin(previewBrush, previewBrush.transform()); }
    private Point3 gizmoOrigin(Transform transform) { return gizmoOrigin(previewBrush, transform); }
    private Point3 gizmoOrigin(Brush brush, Transform transform) {
        if ((transformTool == TransformTool.MOVE || transformTool == TransformTool.SCALE) && brush instanceof ProceduralCubeBrush) {
            Point3 min = previewMin(brush), max = previewMax(brush);
            return transformPoint(new Point3((min.x() + max.x()) / 2, (min.y() + max.y()) / 2, (min.z() + max.z()) / 2), transform);
        }
        Vec3 position = transform.position(), pivot = transform.pivot();
        return new Point3(position.x() + pivot.x(), position.y() + pivot.y(), position.z() + pivot.z());
    }
    private Color axisColor(Axis axis) {
        if (axis == draggingAxis) return theme.gizmoActive();
        if (axis == hoveredAxis) return theme.gizmoHover();
        return switch (axis) { case X -> theme.axisX(); case Y -> theme.axisY(); case Z -> theme.axisZ(); };
    }
    private static Vec3 addAxis(Vec3 value, Axis axis, double amount) { return new Vec3(value.x() + axis.vector().x() * amount, value.y() + axis.vector().y() * amount, value.z() + axis.vector().z() * amount); }
    private static Vec3 clampScale(Vec3 value) { return new Vec3(Math.max(0.05, value.x()), Math.max(0.05, value.y()), Math.max(0.05, value.z())); }
    private static Transform withPosition(Transform t, Vec3 value) { return new Transform(value, t.rotation(), t.scale(), t.pivot()); }
    private static Transform withRotation(Transform t, Vec3 value) { return new Transform(t.position(), value, t.scale(), t.pivot()); }
    private static Transform withScale(Transform t, Vec3 value) { return new Transform(t.position(), t.rotation(), value, t.pivot()); }
    private static Transform withPivot(Transform t, Vec3 value) { return new Transform(t.position(), t.rotation(), t.scale(), value); }
    private static Transform preserveGeometryPivot(Transform t, Vec3 pivot) {
        Point3 oldTerm = rotatedScaled(t.pivot(), t), newTerm = rotatedScaled(pivot, t);
        Vec3 p = t.position();
        return new Transform(new Vec3(p.x() + t.pivot().x() - oldTerm.x() - pivot.x() + newTerm.x(), p.y() + t.pivot().y() - oldTerm.y() - pivot.y() + newTerm.y(), p.z() + t.pivot().z() - oldTerm.z() - pivot.z() + newTerm.z()), t.rotation(), t.scale(), pivot);
    }
    private static Point3 rotatedScaled(Vec3 value, Transform t) { return rotate(new Point3(value.x() * t.scale().x(), value.y() * t.scale().y(), value.z() * t.scale().z()), t.rotation()); }
    private static Point3 add(Point3 a, Point3 b) { return new Point3(a.x() + b.x(), a.y() + b.y(), a.z() + b.z()); }
    private static double distanceToSegment(double px, double py, double ax, double ay, double bx, double by) {
        double dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
        double progress = lengthSquared == 0 ? 0 : Math.clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
        return Math.hypot(px - (ax + progress * dx), py - (ay + progress * dy));
    }

    private static Face transformed(Face source, Transform transform) {
        Point3[] vertices = java.util.Arrays.stream(source.vertices()).map(point -> transformPoint(point, transform)).toArray(Point3[]::new);
        Point3 normal = rotate(new Point3(source.normal().x(), source.normal().y(), source.normal().z()), transform.rotation()).normalized();
        return new Face(normal, vertices);
    }

    private static Point3 transformPoint(Point3 point, Transform transform) {
        Vec3 pivot = transform.pivot();
        Vec3 scale = transform.scale();
        Point3 relative = new Point3((point.x() - pivot.x()) * scale.x(), (point.y() - pivot.y()) * scale.y(), (point.z() - pivot.z()) * scale.z());
        Point3 rotated = rotate(relative, transform.rotation());
        Vec3 position = transform.position();
        return new Point3(rotated.x() + pivot.x() + position.x(), rotated.y() + pivot.y() + position.y(), rotated.z() + pivot.z() + position.z());
    }

    private static Point3 rotate(Point3 point, Vec3 degrees) {
        double xAngle = Math.toRadians(degrees.x()), yAngle = Math.toRadians(degrees.y()), zAngle = Math.toRadians(degrees.z());
        double x1 = point.x(), y1 = point.y() * Math.cos(xAngle) - point.z() * Math.sin(xAngle), z1 = point.y() * Math.sin(xAngle) + point.z() * Math.cos(xAngle);
        double x2 = x1 * Math.cos(yAngle) + z1 * Math.sin(yAngle), y2 = y1, z2 = -x1 * Math.sin(yAngle) + z1 * Math.cos(yAngle);
        return new Point3(x2 * Math.cos(zAngle) - y2 * Math.sin(zAngle), x2 * Math.sin(zAngle) + y2 * Math.cos(zAngle), z2);
    }

    private static List<Face> cubeFaces(Point3 min, Point3 max) {
        Point3 a = new Point3(min.x(), min.y(), min.z()), b = new Point3(max.x(), min.y(), min.z());
        Point3 c = new Point3(max.x(), max.y(), min.z()), d = new Point3(min.x(), max.y(), min.z());
        Point3 e = new Point3(min.x(), min.y(), max.z()), f = new Point3(max.x(), min.y(), max.z());
        Point3 g = new Point3(max.x(), max.y(), max.z()), h = new Point3(min.x(), max.y(), max.z());
        return new ArrayList<>(List.of(
            new Face(new Point3(0, 0, -1), new Point3[] {a, b, c, d}), new Face(new Point3(0, 0, 1), new Point3[] {f, e, h, g}),
            new Face(new Point3(-1, 0, 0), new Point3[] {e, a, d, h}), new Face(new Point3(1, 0, 0), new Point3[] {b, f, g, c}),
            new Face(new Point3(0, 1, 0), new Point3[] {d, c, g, h}), new Face(new Point3(0, -1, 0), new Point3[] {e, f, b, a})
        ));
    }

    private record Face(Point3 normal, Point3[] vertices) { }
    private record ScreenPoint(double x, double y, double depth) { }
    private record CameraPoint(double x, double y, double depth) { }
    private record Point3(double x, double y, double z) {
        Point3 multiply(double amount) { return new Point3(x * amount, y * amount, z * amount); }
        Point3 normalized() { double length = Math.sqrt(x * x + y * y + z * z); return length == 0 ? this : new Point3(x / length, y / length, z / length); }
        double dot(Point3 other) { return x * other.x + y * other.y + z * other.z; }
    }
    private enum Axis {
        X(new Point3(-1, 0, 0)), Y(new Point3(0, 1, 0)), Z(new Point3(0, 0, 1));
        private final Point3 vector;
        Axis(Point3 vector) { this.vector = vector; }
        Point3 vector() { return vector; }
    }
}
