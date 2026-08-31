package studio.cubebricks.model;

/** Immutable transform/name snapshot used by the editor history layer. */
public record CubeState(String name, double x, double y, double z, double width, double height, double depth, double rotationX, double rotationY, double rotationZ) {
    public static CubeState capture(Cube cube) {
        return new CubeState(cube.name, cube.x, cube.y, cube.z, cube.width, cube.height, cube.depth, cube.rotationX, cube.rotationY, cube.rotationZ);
    }

    public void applyTo(Cube cube) {
        cube.name=name; cube.x=x; cube.y=y; cube.z=z; cube.width=width; cube.height=height; cube.depth=depth;
        cube.rotationX=rotationX; cube.rotationY=rotationY; cube.rotationZ=rotationZ;
    }
}
