package studio.cubebricks.history;

import java.util.ArrayDeque;
import java.util.Deque;

/** Bounded command history; commands hold behaviour, not UI or model ownership. */
public final class UndoHistory {
    private static final int MAX_ENTRIES = 200;
    private final Deque<Entry> undo = new ArrayDeque<>();
    private final Deque<Entry> redo = new ArrayDeque<>();

    public void record(Runnable undoAction, Runnable redoAction) {
        undo.push(new Entry(undoAction, redoAction)); redo.clear();
        while (undo.size() > MAX_ENTRIES) undo.removeLast();
    }

    public boolean undo() {
        if (undo.isEmpty()) return false;
        Entry entry = undo.pop(); entry.undo.run(); redo.push(entry); return true;
    }

    public boolean redo() {
        if (redo.isEmpty()) return false;
        Entry entry = redo.pop(); entry.redo.run(); undo.push(entry); return true;
    }

    private record Entry(Runnable undo, Runnable redo) { }
}
