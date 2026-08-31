package studio.cubebricks.persistence;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import studio.cubebricks.model.Cube;

/** Owns the current compact CubeBricks JSON project format. */
public final class ProjectCodec {
    private static final Pattern CUBE = Pattern.compile("\\{\\\"name\\\":\\\"((?:\\\\.|[^\\\"])*)\\\",\\\"x\\\":([-+.0-9Ee]+),\\\"y\\\":([-+.0-9Ee]+),\\\"z\\\":([-+.0-9Ee]+),\\\"width\\\":([-+.0-9Ee]+),\\\"height\\\":([-+.0-9Ee]+),\\\"depth\\\":([-+.0-9Ee]+),\\\"rotationX\\\":([-+.0-9Ee]+),\\\"rotationY\\\":([-+.0-9Ee]+),\\\"rotationZ\\\":([-+.0-9Ee]+)\\}");

    private ProjectCodec() { }

    public static String encode(List<Cube> cubes) {
        StringBuilder json = new StringBuilder("{\n  \"format\": \"cubebricks\",\n  \"version\": 1,\n  \"cubes\": [");
        for (int index = 0; index < cubes.size(); index++) {
            Cube cube = cubes.get(index);
            if (index > 0) json.append(',');
            json.append("\n    {\"name\":\"").append(escape(cube.name)).append("\",\"x\":").append(cube.x).append(",\"y\":").append(cube.y).append(",\"z\":").append(cube.z).append(",\"width\":").append(cube.width).append(",\"height\":").append(cube.height).append(",\"depth\":").append(cube.depth).append(",\"rotationX\":").append(cube.rotationX).append(",\"rotationY\":").append(cube.rotationY).append(",\"rotationZ\":").append(cube.rotationZ).append('}');
        }
        return json.append("\n  ]\n}\n").toString();
    }

    public static List<Cube> decode(String json) {
        if (!json.contains("\"format\": \"cubebricks\"")) throw new IllegalArgumentException("Not a CubeBricks project file.");
        Matcher matcher = CUBE.matcher(json);
        List<Cube> cubes = new ArrayList<>();
        while (matcher.find()) {
            Cube cube = new Cube(unescape(matcher.group(1)));
            cube.x=number(matcher.group(2)); cube.y=number(matcher.group(3)); cube.z=number(matcher.group(4));
            cube.width=positive(matcher.group(5)); cube.height=positive(matcher.group(6)); cube.depth=positive(matcher.group(7));
            cube.rotationX=number(matcher.group(8)); cube.rotationY=number(matcher.group(9)); cube.rotationZ=number(matcher.group(10));
            cubes.add(cube);
        }
        return cubes;
    }

    private static double number(String text) { return Double.parseDouble(text); }
    private static double positive(String text) { return Math.max(.05, number(text)); }
    private static String escape(String value) { return value.replace("\\", "\\\\").replace("\"", "\\\""); }
    private static String unescape(String value) { return value.replace("\\\"", "\"").replace("\\\\", "\\"); }
}
