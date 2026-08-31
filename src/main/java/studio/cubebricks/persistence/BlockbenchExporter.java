package studio.cubebricks.persistence;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import studio.cubebricks.model.Cube;

/** Produces a plain generic-model .bbmodel file from CubeBricks cube data. */
public final class BlockbenchExporter {
    private BlockbenchExporter() { }

    public static String export(List<Cube> cubes, String modelName) {
        List<String> ids = new ArrayList<>();
        StringBuilder json = new StringBuilder("{\n  \"meta\": {\"format_version\": \"5.0\", \"model_format\": \"free\", \"box_uv\": false},\n  \"name\": \"")
                .append(escape(modelName)).append("\",\n  \"resolution\": {\"width\": 16, \"height\": 16},\n  \"elements\": [");
        for (int index = 0; index < cubes.size(); index++) {
            Cube cube = cubes.get(index);
            String id = UUID.randomUUID().toString(); ids.add(id);
            if (index > 0) json.append(',');
            double minX = cube.x - cube.width / 2, minY = cube.y - cube.height / 2, minZ = cube.z - cube.depth / 2;
            double maxX = cube.x + cube.width / 2, maxY = cube.y + cube.height / 2, maxZ = cube.z + cube.depth / 2;
            json.append("\n    {\"name\":\"").append(escape(cube.name)).append("\",\"box_uv\":false,\"from\":")
                    .append(vector(minX, minY, minZ)).append(",\"to\":").append(vector(maxX, maxY, maxZ))
                    .append(",\"origin\":").append(vector(cube.x, cube.y, cube.z)).append(",\"rotation\":")
                    .append(vector(cube.rotationX, cube.rotationY, cube.rotationZ)).append(",\"autouv\":1,\"color\":3,\"type\":\"cube\",\"uuid\":\"").append(id).append("\"}");
        }
        json.append("\n  ],\n  \"outliner\": [");
        for (int index = 0; index < ids.size(); index++) { if (index > 0) json.append(','); json.append('\"').append(ids.get(index)).append('\"'); }
        return json.append("],\n  \"textures\": []\n}\n").toString();
    }

    private static String vector(double x, double y, double z) { return "[" + x + "," + y + "," + z + "]"; }
    private static String escape(String value) { return value.replace("\\", "\\\\").replace("\"", "\\\""); }
}
