import type {
  EncryptedConversationAvailability,
  EncryptedConversationChunk,
  MessageDetail,
  SyncSearchDocument
} from "@recallbase/contracts";

export type ConversationPageState =
  | { state: "loading" }
  | { state: "not_found" }
  | { state: "auth_expired" }
  | { state: "backend_unavailable" }
  | {
      state: "ready";
      document: SyncSearchDocument;
      encryptedConversationChunks?: EncryptedConversationChunk[];
      lockedEncryptedConversationChunks?: EncryptedConversationAvailability[];
      decryptedMessages?: MessageDetail[];
      decryptionError?: string;
    };

export function ConversationPage(props: ConversationPageState) {
  if (props.state === "loading") return <main aria-busy="true">Loading synced conversation...</main>;
  if (props.state === "auth_expired") return <main role="alert">Session expired. Continue with Google.</main>;
  if (props.state === "backend_unavailable") return <main role="alert">Conversation backend is unavailable.</main>;
  if (props.state === "not_found") {
    return (
      <main role="alert">
        Conversation is not synced, no longer synced, or hidden because its sync batch is incomplete.
      </main>
    );
  }

  return (
    <main className="detail-page">
      <article aria-labelledby="conversation-title">
        <a href="/search" className="back-link">Back to search</a>
        <h1 id="conversation-title">{props.document.title}</h1>
        <dl>
          <dt>Source</dt>
          <dd>{props.document.sourceId}</dd>
          <dt>Updated</dt>
          <dd>{props.document.updatedAt}</dd>
        </dl>
        {props.document.optionalSummary ? (
          <section aria-labelledby="summary-heading">
            <h2 id="summary-heading">Summary</h2>
            <p>{props.document.optionalSummary}</p>
          </section>
        ) : null}
        <section aria-labelledby="snippet-heading">
          <h2 id="snippet-heading">Snippet</h2>
          <p>{props.document.snippet}</p>
        </section>
        <ConversationTranscript
          document={props.document}
          encryptedConversationChunks={props.encryptedConversationChunks ?? []}
          lockedEncryptedConversationChunks={props.lockedEncryptedConversationChunks ?? []}
          {...(props.decryptedMessages ? { decryptedMessages: props.decryptedMessages } : {})}
          {...(props.decryptionError ? { decryptionError: props.decryptionError } : {})}
        />
      </article>
    </main>
  );
}

function ConversationTranscript(props: {
  document: SyncSearchDocument;
  encryptedConversationChunks: EncryptedConversationChunk[];
  lockedEncryptedConversationChunks: EncryptedConversationAvailability[];
  decryptedMessages?: MessageDetail[];
  decryptionError?: string;
}) {
  if (props.decryptedMessages) {
    return (
      <section aria-labelledby="messages-heading">
        <h2 id="messages-heading">Messages</h2>
        <ol>
          {props.decryptedMessages.map((message) => (
            <li key={message.id}>
              <p>
                <strong>{message.role}</strong> <time dateTime={message.createdAt}>{message.createdAt}</time>
              </p>
              <p>{message.text}</p>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const locked = props.lockedEncryptedConversationChunks.length > 0
    ? props.lockedEncryptedConversationChunks
    : summarizeChunks(props.encryptedConversationChunks);
  if (locked.length > 0) {
    return (
      <section aria-labelledby="locked-heading">
        <h2 id="locked-heading">Encrypted Messages</h2>
        <p>Full normalized messages are present as locked encrypted chunks. Browser-side unlock is deferred for hosted V1.</p>
        <ul className="locked-list">
          {locked.map((item) => (
            <li key={`${item.deviceId}:${item.keyId}`}>
              <strong>{item.deviceId}</strong>
              <span>{item.chunkCount} chunks</span>
              <span>{item.messageCount} messages</span>
            </li>
          ))}
        </ul>
        {props.decryptionError ? <p role="alert">{props.decryptionError}</p> : null}
      </section>
    );
  }

  return (
    <p>
      Full transcript and raw evidence are not readable on the server in V1. Use local <code>rb open {props.document.conversationId}</code>.
    </p>
  );
}

function summarizeChunks(chunks: EncryptedConversationChunk[]): EncryptedConversationAvailability[] {
  const groups = new Map<string, EncryptedConversationAvailability>();
  for (const chunk of chunks) {
    const deviceId = chunk.objectKey.match(/\/devices\/([^/]+)\//)?.[1] ?? "synced-device";
    const key = `${deviceId}:${chunk.keyId}`;
    const existing = groups.get(key);
    groups.set(key, {
      deviceId,
      keyId: chunk.keyId,
      chunkCount: (existing?.chunkCount ?? 0) + 1,
      messageCount: (existing?.messageCount ?? 0) + chunk.messageCount,
      encryptedAt: !existing || Date.parse(chunk.encryptedAt) > Date.parse(existing.encryptedAt) ? chunk.encryptedAt : existing.encryptedAt
    });
  }
  return [...groups.values()];
}
