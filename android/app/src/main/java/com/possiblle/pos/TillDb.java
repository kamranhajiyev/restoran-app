package com.possiblle.pos;

// The Android till's SQLite file: what lib/android-till.ts turns into the
// node:sqlite handle the exe's till code expects (lib/till-store/).
//
// Three calls and nothing else — run a statement, read rows, write rows — and
// each answers at once, as JSON: {rows}, {changes}, or {error}. An error is
// returned rather than thrown so the page gets the message, not a crash.
//
// The tables are made by the page (lib/till-store/db.ts), so a change to them
// is one change for both apps.

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteCursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteProgram;
import android.database.sqlite.SQLiteStatement;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

class TillDb {
    private final SQLiteDatabase db;

    TillDb(Context context) {
        File file = new File(context.getFilesDir(), "till.db");
        db = SQLiteDatabase.openOrCreateDatabase(file, null);
        // One connection, so a transaction the page opens is the one its next
        // statement runs in. A restaurant loses power; that is usually *why*
        // the line went down — a real fsync at each commit keeps the file.
        db.disableWriteAheadLogging();
        db.execSQL("pragma synchronous = full");
        db.execSQL("pragma foreign_keys = on");
    }

    synchronized String exec(String sql) {
        try {
            // The page's transact() sends these as plain statements, as it does
            // to node:sqlite. Android keeps its own transaction state, so they
            // go through its calls rather than past them.
            String word = sql.trim().split("\\s+")[0].toLowerCase();
            if (word.equals("begin")) db.beginTransaction();
            else if (word.equals("commit")) { db.setTransactionSuccessful(); db.endTransaction(); }
            else if (word.equals("rollback")) db.endTransaction();
            else db.execSQL(sql);
            return "{}";
        } catch (Exception e) {
            return error(e);
        }
    }

    synchronized String query(String sql, String params) {
        try {
            final JSONArray args = new JSONArray(params);
            // Bound with their types, as node:sqlite does: Android's usual
            // String[] arguments would make every number text.
            try (Cursor c = db.rawQueryWithFactory((database, driver, table, query) -> {
                try {
                    bind(query, args);
                } catch (Exception e) {
                    throw new IllegalArgumentException(e.getMessage());
                }
                return new SQLiteCursor(driver, table, query);
            }, sql, null, null)) {
                JSONArray rows = new JSONArray();
                String[] names = c.getColumnNames();
                while (c.moveToNext()) {
                    JSONObject row = new JSONObject();
                    for (int i = 0; i < names.length; i++) {
                        switch (c.getType(i)) {
                            case Cursor.FIELD_TYPE_NULL: row.put(names[i], JSONObject.NULL); break;
                            case Cursor.FIELD_TYPE_INTEGER: row.put(names[i], c.getLong(i)); break;
                            case Cursor.FIELD_TYPE_FLOAT: row.put(names[i], c.getDouble(i)); break;
                            default: row.put(names[i], c.getString(i));
                        }
                    }
                    rows.put(row);
                }
                return new JSONObject().put("rows", rows).toString();
            }
        } catch (Exception e) {
            return error(e);
        }
    }

    synchronized String run(String sql, String params) {
        try (SQLiteStatement statement = db.compileStatement(sql)) {
            bind(statement, new JSONArray(params));
            int changes = statement.executeUpdateDelete();
            return new JSONObject().put("changes", changes).toString();
        } catch (Exception e) {
            return error(e);
        }
    }

    private static void bind(SQLiteProgram program, JSONArray args) throws Exception {
        for (int i = 0; i < args.length(); i++) {
            Object v = args.get(i);
            int at = i + 1;
            if (v == JSONObject.NULL) program.bindNull(at);
            else if (v instanceof Integer || v instanceof Long) program.bindLong(at, ((Number) v).longValue());
            else if (v instanceof Number) {
                double d = ((Number) v).doubleValue();
                if (d == Math.rint(d) && Math.abs(d) < 9.0E15) program.bindLong(at, (long) d);
                else program.bindDouble(at, d);
            } else program.bindString(at, String.valueOf(v));
        }
    }

    private static String error(Exception e) {
        try {
            return new JSONObject().put("error", String.valueOf(e.getMessage())).toString();
        } catch (Exception ignored) {
            return "{\"error\":\"sql\"}";
        }
    }
}
