import { linearRequest } from "./request";
import type { TrackedComment } from "@ralphy/tracker";

export async function addReactionToComment(
  apiKey: string,
  commentId: string,
  emoji: string,
): Promise<void> {
  const mutation = `mutation Reaction($commentId: String!, $emoji: String!) {
    reactionCreate(input: { commentId: $commentId, emoji: $emoji }) { success }
  }`;
  await linearRequest<{ reactionCreate: { success: boolean } }>(apiKey, mutation, {
    commentId,
    emoji,
  });
}

export async function addIssueComment(
  apiKey: string,
  issueId: string,
  body: string,
): Promise<void> {
  const mutation = `mutation Comment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) { success }
  }`;
  await linearRequest<{ commentCreate: { success: boolean } }>(apiKey, mutation, {
    issueId,
    body,
  });
}

export async function createIssueComment(
  apiKey: string,
  issueId: string,
  body: string,
): Promise<string> {
  const mutation = `mutation Comment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment { id }
    }
  }`;
  const data = await linearRequest<{
    commentCreate: { success: boolean; comment: { id: string } | null };
  }>(apiKey, mutation, { issueId, body });
  const id = data.commentCreate.comment?.id;
  if (!id) throw new Error("commentCreate returned no comment id");
  return id;
}

export async function updateIssueComment(
  apiKey: string,
  commentId: string,
  body: string,
): Promise<void> {
  const mutation = `mutation UpdateComment($id: String!, $body: String!) {
    commentUpdate(id: $id, input: { body: $body }) { success }
  }`;
  await linearRequest<{ commentUpdate: { success: boolean } }>(apiKey, mutation, {
    id: commentId,
    body,
  });
}

export async function deleteIssueComment(apiKey: string, commentId: string): Promise<void> {
  const mutation = `mutation DeleteComment($id: String!) {
    commentDelete(id: $id) { success }
  }`;
  await linearRequest<{ commentDelete: { success: boolean } }>(apiKey, mutation, {
    id: commentId,
  });
}

export async function fetchIssueComments(
  apiKey: string,
  issueId: string,
): Promise<TrackedComment[]> {
  const query = `query Comments($id: String!) {
    issue(id: $id) {
      comments(first: 50) {
        nodes { id body createdAt user { name email } }
      }
    }
  }`;
  const data = await linearRequest<{
    issue: { comments: { nodes: TrackedComment[] } } | null;
  }>(apiKey, query, { id: issueId });
  return data.issue?.comments.nodes ?? [];
}
