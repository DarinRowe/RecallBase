import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

describe("SQLite FTS smoke", () => {
  test("development runtime can create and query an FTS table", () => {
    const db = new Database(":memory:");
    db.run("CREATE VIRTUAL TABLE conversation_fts USING fts5(id, content)");
    db.run("INSERT INTO conversation_fts (id, content) VALUES (?, ?)", ["c1", "recallbase sync notes"]);
    const row = db.query("SELECT id FROM conversation_fts WHERE conversation_fts MATCH ?").get("sync") as {
      id: string;
    };

    expect(row.id).toBe("c1");
  });
});
