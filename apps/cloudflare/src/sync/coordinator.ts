import type { AuthSubject } from "../auth/authorization";

export interface BatchCoordinator {
  begin(subject: AuthSubject, batchId: string): Promise<"new" | "duplicate">;
  complete(subject: AuthSubject, batchId: string, cursor: string): Promise<void>;
  isComplete(subject: AuthSubject, batchId: string): Promise<boolean>;
}

export class MemoryBatchCoordinator implements BatchCoordinator {
  private readonly completed = new Set<string>();
  private readonly inFlight = new Set<string>();

  async begin(subject: AuthSubject, batchId: string): Promise<"new" | "duplicate"> {
    const key = scopedBatchKey(subject, batchId);
    if (this.completed.has(key)) return "duplicate";
    this.inFlight.add(key);
    return "new";
  }

  async complete(subject: AuthSubject, batchId: string, cursor: string): Promise<void> {
    const key = scopedBatchKey(subject, batchId);
    this.inFlight.delete(key);
    this.completed.add(key);
    void cursor;
  }

  async isComplete(subject: AuthSubject, batchId: string): Promise<boolean> {
    return this.completed.has(scopedBatchKey(subject, batchId));
  }
}

function scopedBatchKey(subject: AuthSubject, batchId: string): string {
  return `${subject.userId}:${subject.deviceId}:${batchId}`;
}
