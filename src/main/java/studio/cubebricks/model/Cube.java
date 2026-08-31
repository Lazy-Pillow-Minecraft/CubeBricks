package studio.cubebricks.model;

/** Editable box data; rendering and file formats deliberately do not live here. */
public final class Cube {
    public String name;
    public double x, y, z, width = 2, height = 2, depth = 2, rotationX, rotationY, rotationZ;

    public Cube(String name) { this.name = name; }

    public Cube copy(String copyName) {
        Cube copy = new Cube(copyName);
        copy.x = x; copy.y = y; copy.z = z;
        copy.width = width; copy.height = height; copy.depth = depth;
        copy.rotationX = rotationX; copy.rotationY = rotationY; copy.rotationZ = rotationZ;
        return copy;
    }

    @Override public String toString() { return name; }
}
