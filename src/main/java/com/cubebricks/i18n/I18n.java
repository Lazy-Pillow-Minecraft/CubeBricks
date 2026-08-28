package com.cubebricks.i18n;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.MessageFormat;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Loads the editor's flat JSON language bundles without tying the core to a UI toolkit. */
public final class I18n {
    private static final String FALLBACK_LOCALE = "en_us";
    private static final Pattern ENTRY = Pattern.compile("\\\"((?:\\\\.|[^\\\"])*)\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"");
    private static String locale = resolveInitialLocale();
    private static Map<String, String> translations = load(locale);

    private I18n() { }

    public static String locale() { return locale; }

    public static void setLocale(String requestedLocale) {
        locale = requestedLocale;
        translations = load(requestedLocale);
    }

    public static String tr(String key, Object... arguments) {
        String template = translations.getOrDefault(key, load(FALLBACK_LOCALE).getOrDefault(key, key));
        return arguments.length == 0 ? template : MessageFormat.format(template, arguments);
    }

    private static String resolveInitialLocale() {
        return Locale.getDefault().getLanguage().equals("zh") ? "zh_cn" : FALLBACK_LOCALE;
    }

    private static Map<String, String> load(String requestedLocale) {
        String resource = "/lang/" + requestedLocale + ".json";
        try (InputStream stream = I18n.class.getResourceAsStream(resource)) {
            if (stream == null) return requestedLocale.equals(FALLBACK_LOCALE) ? Map.of() : load(FALLBACK_LOCALE);
            String json = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            Map<String, String> values = new HashMap<>();
            Matcher matcher = ENTRY.matcher(json);
            while (matcher.find()) values.put(unescape(matcher.group(1)), unescape(matcher.group(2)));
            return Map.copyOf(values);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to load language bundle: " + resource, exception);
        }
    }

    private static String unescape(String value) {
        return value.replace("\\\"", "\"").replace("\\\\", "\\");
    }
}
