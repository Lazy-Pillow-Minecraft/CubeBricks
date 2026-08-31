package studio.cubebricks;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Loads flat JSON dictionaries so UI language data stays outside source code. */
final class Translations {
    private static final Pattern ENTRY = Pattern.compile("\\\"([^\\\"]+)\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"");
    private final Map<String, String> values = new HashMap<>();

    Translations() {
        String language = Locale.getDefault().getLanguage().equals("zh") ? "zh_cn" : "en_us";
        load("/studio/cubebricks/lang/en_us.json");
        load("/studio/cubebricks/lang/" + language + ".json");
    }

    String get(String key) { return values.getOrDefault(key, key); }

    private void load(String resource) {
        try (InputStream stream = Translations.class.getResourceAsStream(resource)) {
            if (stream == null) return;
            Matcher matcher = ENTRY.matcher(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
            while (matcher.find()) values.put(matcher.group(1), matcher.group(2).replace("\\n", "\n").replace("\\\"", "\"").replace("\\\\", "\\"));
        } catch (IOException ignored) {
            // English source strings remain a safe fallback while developing a language pack.
        }
    }
}
